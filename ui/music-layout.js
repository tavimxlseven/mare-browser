window.attachMusicLayout = function (element) {
  const key = "mare.music.layout.v1";
  let config = {
    library: 260,
    queue: 300,
    radius: 12,
    compact: false,
    queueHidden: false,
  };
  try {
    config = { ...config, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {}
  let frame = 0,
    active = null;
  const clamp = (n, low, high) =>
    Math.max(low, Math.min(high, Number(n) || low));
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(config));
    } catch {}
  };
  function apply() {
    const width = element.clientWidth;
    element.classList.toggle("music-narrow", width < 1050);
    element.classList.toggle("music-compact", !!config.compact);
    element.classList.toggle("queue-hidden", !!config.queueHidden);
    element.classList.toggle(
      "queue-expanded",
      width < 1050 && !!config.openNarrow && !config.queueHidden,
    );
    const library = clamp(
      config.library,
      180,
      Math.max(180, Math.min(480, width - 340)),
    );
    const queue = clamp(config.queue, 240, 480);
    element.style.setProperty("--music-library-width", library + "px");
    element.style.setProperty("--music-queue-width", queue + "px");
    element.style.setProperty(
      "--music-radius",
      clamp(config.radius, 0, 24) + "px",
    );
    for (const grip of element.querySelectorAll("[data-music-resize]")) {
      grip.setAttribute(
        "aria-valuenow",
        String(
          Math.round(grip.dataset.musicResize === "library" ? library : queue),
        ),
      );
    }
  }
  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
  }
  const grips = [];
  for (const part of ["library", "queue"]) {
    const grip = document.createElement("div");
    grip.className = "music-resizer music-resizer-" + part;
    grip.dataset.musicResize = part;
    grip.tabIndex = 0;
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-orientation", "vertical");
    grip.setAttribute(
      "aria-label",
      part === "library" ? "Largura da biblioteca" : "Largura da fila",
    );
    grip.setAttribute("aria-valuemin", part === "library" ? "180" : "240");
    grip.setAttribute("aria-valuemax", "480");
    grip.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      active = { part, x: event.clientX, size: config[part] };
      grip.setPointerCapture(event.pointerId);
      element.classList.add("music-resizing");
    };
    grip.onpointermove = (event) => {
      if (active?.part !== part) return;
      const delta = (event.clientX - active.x) * (part === "queue" ? -1 : 1);
      const max =
        part === "library"
          ? Math.max(
              180,
              Math.min(
                480,
                element.clientWidth -
                  340 -
                  (element.clientWidth >= 1050 && !config.queueHidden
                    ? config.queue + 16
                    : 0),
              ),
            )
          : Math.min(
              480,
              Math.max(240, element.clientWidth - config.library - 340),
            );
      config[part] = clamp(
        active.size + delta,
        part === "library" ? 180 : 240,
        max,
      );
      schedule();
    };
    const finish = () => {
      active = null;
      element.classList.remove("music-resizing");
      save();
    };
    grip.onpointerup = finish;
    grip.onpointercancel = finish;
    grip.onlostpointercapture = finish;
    grip.ondblclick = () => {
      config[part] = part === "library" ? 260 : 300;
      apply();
      save();
    };
    grip.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") config[part] = part === "library" ? 260 : 300;
      else
        config[part] = clamp(
          config[part] +
            (event.key === "ArrowRight" ? 16 : -16) *
              (part === "queue" ? -1 : 1),
          part === "library" ? 180 : 240,
          480,
        );
      apply();
      save();
    };
    element.append(grip);
    grips.push(grip);
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  apply();
  return {
    config,
    update(values) {
      Object.assign(config, values);
      apply();
      save();
    },
    toggleQueue() {
      if (element.clientWidth < 1050) {
        config.openNarrow = !config.openNarrow;
        config.queueHidden = false;
      } else config.queueHidden = !config.queueHidden;
      apply();
      save();
    },
    dispose() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      grips.forEach((g) => g.remove());
    },
  };
};
