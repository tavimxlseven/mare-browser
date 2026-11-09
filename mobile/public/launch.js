"use strict";
(() => {
  const launch = document.getElementById("music-launch");
  if (!launch) return;
  const started = performance.now();
  let finished = false;
  const slow = setTimeout(() => {
    document.getElementById("launch-message").textContent =
      "Sua biblioteca está demorando para responder.";
    document.getElementById("launch-retry").hidden = false;
  }, 12000);
  document.getElementById("launch-retry").onclick = () => location.reload();
  window.finishMusicLaunch = () => {
    if (finished) return;
    finished = true;
    clearTimeout(slow);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      const surface = ["app", "login", "install"]
        .map((id) => document.getElementById(id))
        .find((el) => el && !el.hidden);
      if (!reduced) surface?.classList.add("music-entry-reveal");
      launch.classList.add("launch-leaving");
      setTimeout(
        () => {
          launch.remove();
          surface?.classList.remove("music-entry-reveal");
        },
        reduced ? 0 : 600,
      );
    };
    setTimeout(
      finish,
      reduced ? 0 : Math.max(0, 320 - (performance.now() - started)),
    );
  };
})();
