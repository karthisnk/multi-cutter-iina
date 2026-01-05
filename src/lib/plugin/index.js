const {
  core,
  mpv,
  utils,
  overlay,
  event,
} = iina;

export function handlePreviewMessage(window) {
  let previewListener = null;

  window.onMessage("previewClip", ({ start, end }) => {
    // 1. Convert start (HH:MM:SS) to seconds
    const [h, m, s] = start.split(':').map(Number);
    const startSeconds = h * 3600 + m * 60 + s;

    // 2. Convert end (HH:MM:SS) to seconds
    const [eh, em, es] = end.split(':').map(Number);
    const endSeconds = eh * 3600 + em * 60 + es;

    // 3. Seek to start
    mpv.set("time-pos", startSeconds);
    core.resume(); // Ensure playing

    // 4. Remove existing listener if any
    if (previewListener) {
      event.off("mpv.time-pos.changed", previewListener);
      previewListener = null;
    }

    // 5. Add listener to stop at end
    previewListener = (time) => {
      if (time >= endSeconds) {
        core.pause();
        event.off("mpv.time-pos.changed", previewListener);
        previewListener = null;
      }
    };
    event.on("mpv.time-pos.changed", previewListener);
  });
}

// DISPLAY UI FUNCTION
export function displaySimpleOverlay(message, size = "15px", isError = false, duration = 3000) {
  overlay.simpleMode();
  overlay.setContent(`<p>${message}</p>`);
  overlay.setStyle(`p { color: ${isError ? "red" : "green"}; font-size: ${size}; margin-top: 40px;}`);
  overlay.show();

  setTimeout(() => {
    overlay.hide();
  }, duration);
}

// ACTION LISTENERS FOR UI
export function postEndTimeMessage(window) {
  window.onMessage("getEndTime", () => {
    let time = mpv.getNumber("time-pos");
    window.postMessage("endTime", {
      time: time,
    });
    core.pause();
  })
}

export function postStartTimeMessage(window) {
  window.onMessage("getStartTime", () => {
    let time = mpv.getNumber("time-pos");
    window.postMessage("startTime", {
      time: time,
    });
    core.pause();
  })
}

export function processVideoClip(window) {
  window.onMessage("processVideoClip", async ({ clips, hwaccel, verticalCrop, cropMode, format }) => {
    // Sequential processing
    for (const clip of clips) {
      if (clip.status !== "COMPLETED") {
        // 1. Notify UI: WAITING -> PROCESSING
        window.postMessage("clip-status-update", { id: clip.id, status: "PROCESSING" });

        // 2. Execute
        await ffmpegExecFn(clip.start, clip.end, hwaccel, verticalCrop, cropMode, format, window, clip.id);
      }
    }
    // 3. Notify Global Done
    window.postMessage("batch-complete", {});
  });
}

export function closeWindow(window) {
  window.onMessage("closeWindow", () => {
    window.hide();
  });
}

export function postCurrentTimeOnce(window) {
  let time = mpv.getNumber("time-pos");
  window.postMessage("currentTime", {
    time: time,
  });
}

export function isFfmpegInstalled(window) {
  let bool = utils.fileInPath("/opt/homebrew/bin/ffmpeg");
  if (!bool) bool = utils.fileInPath("/usr/local/bin/ffmpeg");
  window.postMessage("is-ffmpeg-installed", {
    isInstalled: bool,
  });
}

function postFfmpegStatus(window, status = false) {
  window.postMessage("ffmpeg-status-out", {
    status: status,
  });
}

// LOCAL PLUGIN FUNCTION
async function ffmpegExecFn(start, finish, hwaccel = false, verticalCrop = false, cropMode = "default", format = "original", window, id, ffmpegPath = "/opt/homebrew/bin/ffmpeg") {
  let isFfmpegRunning = false;

  // Resolve valid ffmpeg path
  let finalFfmpegPath = ffmpegPath;
  if (!utils.fileInPath(finalFfmpegPath)) {
    if (utils.fileInPath("/usr/local/bin/ffmpeg")) {
      finalFfmpegPath = "/usr/local/bin/ffmpeg";
    }
  }

  if (utils.fileInPath(finalFfmpegPath)) {
    displaySimpleOverlay(`Processing Clip ${id}...`, "18px");
    try {
      isFfmpegRunning = true;
      postFfmpegStatus(window, isFfmpegRunning);

      // Determine extension
      const originalPath = mpv.getString("path");
      const filename = mpv.getString("filename");
      const directory = originalPath.substring(0, originalPath.lastIndexOf("/"));
      const nameNoExt = filename.substring(0, filename.lastIndexOf("."));

      let extension = "mov";
      if (format === "mp4") extension = "mp4";
      if (format === "original") extension = filename.split('.').pop();

      // Sanitize timestamp for filename
      const sanitizedStart = start.replace(/:/g, "-");

      // Calculate Video Filter String
      let videoFilter = null;
      let cropFilter = 'crop=w=ih*(9/16):h=ih:x=(iw-ow)/2:y=0'; // Default Legacy

      if (verticalCrop) {
        switch (cropMode) {
          case 'left-3': cropFilter = 'crop=iw/3:ih:0:0'; break;
          case 'center-3': cropFilter = 'crop=iw/3:ih:iw/3:0'; break;
          case 'right-3': cropFilter = 'crop=iw/3:ih:2*iw/3:0'; break;
          case 'left-2': cropFilter = 'crop=iw/2:ih:0:0'; break;
          case 'right-2': cropFilter = 'crop=iw/2:ih:iw/2:0'; break;
          default: break; // Keep default
        }
        // Force yuv420p for compatibility
        cropFilter += ",format=yuv420p";
        videoFilter = cropFilter;
      } else {
        // Even without crop, ensure compatible pixel format
        videoFilter = "format=yuv420p";
      }

      // HELPER: Run FFmpeg with specific HW Accel setting
      // Returns { status, stdout, stderr } via utils.exec (ASYNC)
      const runFfmpeg = async (enableHwAccel) => {
        const args = [
          '-y', // Force overwrite
          '-ss', start,
          '-to', finish,
          '-i', originalPath,
          '-vf', videoFilter, // Always apply filter (crop or format)
          enableHwAccel && '-c:v', enableHwAccel && 'h264_videotoolbox',
          enableHwAccel && '-q:v', enableHwAccel && '70',
          !enableHwAccel && '-c:v', !enableHwAccel && 'libx264',
          !enableHwAccel && '-crf', !enableHwAccel && '23',
          '-c:a', 'copy',
          '-movflags', '+faststart',
          `${directory}/${nameNoExt}_clip_${sanitizedStart}.${extension}`,
        ].filter(Boolean);
        return await utils.exec(finalFfmpegPath, args);
      };

      // 1. Initial Attempt
      let result = await runFfmpeg(hwaccel);
      let status = result.status;

      // 2. Retry Logic: If HW Accel failed, try Software
      if (status !== 0 && hwaccel) {
        displaySimpleOverlay(`HW Accel failed (Err ${status}). Retrying on CPU...`, "16px");
        result = await runFfmpeg(false);
        status = result.status;
      }

      if (status === 0) {
        isFfmpegRunning = false;
        postFfmpegStatus(window, isFfmpegRunning);
        window.postMessage("clip-status-update", { id: id, status: "COMPLETED" });
        displaySimpleOverlay("Clip saved", "18px");
      } else {
        isFfmpegRunning = false;
        postFfmpegStatus(window, isFfmpegRunning);
        window.postMessage("clip-status-update", { id: id, status: "ERROR" });
        // Try to show error from stderr if available/safe
        displaySimpleOverlay(`Error: FFmpeg exited with code ${status}.`, "18px", true, 8000);
      }
    } catch (error) {
      isFfmpegRunning = false;
      postFfmpegStatus(window, isFfmpegRunning);
      window.postMessage("clip-status-update", { id: id, status: "ERROR" });
      displaySimpleOverlay(`Exception: ${error}`, "18px", true, 8000);
    }
  } else {
    window.postMessage("clip-status-update", { id: id, status: "ERROR" });
    displaySimpleOverlay("Error: ffmpeg binary not found.", "18px", true, 8000);
  }
}

export function handleUiReady(window) {
  window.onMessage("ui-ready", () => {
    isFfmpegInstalled(window);
    postCurrentTimeOnce(window);
  });
}