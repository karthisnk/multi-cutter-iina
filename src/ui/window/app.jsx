import React, { use, useEffect, useState } from "react";

const loadCurrentTime = () => {
  return new Promise ((resolve, reject) => {
    iina.onMessage("currentTime", ({time}) => resolve(time));
  })
}
export default App = () => {
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    async function load () {
      const time = await loadCurrentTime();
      setCurrentTime(Math.floor(time / 60));
    }
    load();
  }, []);

  return (
  <div>
    <p>Current Time: { currentTime }</p>
  </div>
);
}