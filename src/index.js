const {
  console,
  menu,
  core
} = iina;

// load the react file
const window = iina.standaloneWindow;

// functions
function postCurrentTimeMessage() {
  window.postMessage("currentTime", {
    time: core.status.position
  });
}


window.setFrame(400, 200);
window.loadFile("dist/ui/window/index.html");
postCurrentTimeMessage();


// start recording menu item
const startRecorderMenuItem = menu.item("Start Recording", () => {
  window.open();
}, {
  keyBinding: "Alt+Shift+r",
})
menu.addItem(startRecorderMenuItem);