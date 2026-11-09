window.attachMusicLayout = function (element) {
  const key = "mare.music.layout.v1";
  let config = {
    library: 260,
    queue: 300,
    radius: 18,
    compact: false,
    queueHidden: false,
    theme: "dark",
    accent: "green",
    textSize: 13,
    artworkSize: 160,
    coverRadius: 12,
    motion: true,
    showArtwork: true,
    wallpaper: "none",
    wallpaperFit: "cover",
    panelOpacity: 94,
  };
  try {
    config = { ...config, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {}
  const wallpaperKey = "mare.music.wallpaper.v1";
  let customWallpaper = "";
  let appliedWallpaper = null;
  try {
    const stored = localStorage.getItem(wallpaperKey) || "";
    if (
      stored.length <= 786432 &&
      /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(stored)
    )
      customWallpaper = stored;
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
    const paper = ["none", "mist", "sunset", "ocean", "custom"].includes(
      config.wallpaper,
    )
      ? config.wallpaper
      : "none";
    element.dataset.musicWallpaper = paper;
    element.classList.toggle(
      "music-has-wallpaper",
      paper !== "none" && (paper !== "custom" || !!customWallpaper),
    );
    if (appliedWallpaper !== customWallpaper) {
      element.style.setProperty(
        "--music-custom-wallpaper",
        customWallpaper ? `url("${customWallpaper}")` : "none",
      );
      appliedWallpaper = customWallpaper;
    }
    element.style.setProperty(
      "--music-wallpaper-fit",
      config.wallpaperFit === "contain" ? "contain" : "cover",
    );
    element.style.setProperty(
      "--music-panel-opacity",
      clamp(config.panelOpacity, 85, 100) + "%",
    );
    element.dataset.musicTheme = ["light", "dark", "system"].includes(
      config.theme,
    )
      ? config.theme
      : "light";
    element.dataset.musicAccent = ["rose", "blue", "green", "violet"].includes(
      config.accent,
    )
      ? config.accent
      : "rose";
    element.classList.toggle("music-still", config.motion === false);
    element.classList.toggle("music-no-artwork", config.showArtwork === false);
    element.style.setProperty(
      "--music-text-size",
      clamp(config.textSize, 12, 16) + "px",
    );
    element.style.setProperty(
      "--music-artwork-size",
      clamp(config.artworkSize, 120, 220) + "px",
    );
    element.style.setProperty(
      "--music-cover-radius",
      clamp(config.coverRadius, 0, 24) + "px",
    );
    element.classList.toggle("music-narrow", width < 1050);
    element.classList.toggle("music-tight", width < 880);
    element.classList.toggle("music-compact", !!config.compact);
    element.classList.toggle("queue-hidden", !!config.queueHidden);
    element.classList.toggle(
      "queue-expanded",
      width < 1050 && !!config.openNarrow && !config.queueHidden,
    );
    const library = clamp(
      config.library,
      180,
      Math.max(
        180,
        Math.min(
          480,
          width -
            340 -
            (width >= 1050 && !config.queueHidden
              ? clamp(config.queue, 240, 480) + 8
              : 0),
        ),
      ),
    );
    const queue = clamp(
      config.queue,
      240,
      Math.max(240, Math.min(480, width - library - 340)),
    );
    element.style.setProperty("--music-library-width", library + "px");
    element.style.setProperty("--music-queue-width", queue + "px");
    element.style.setProperty(
      "--music-radius",
      clamp(config.radius, 0, 24) + "px",
    );
    for (const grip of element.querySelectorAll("[data-music-resize]")) {
      const now = Math.round(
        grip.dataset.musicResize === "library" ? library : queue,
      );
      grip.setAttribute("aria-valuenow", String(now));
      grip.setAttribute("aria-valuetext", now + " px");
    }
    // Lets the view keep its queue toggle in step with narrow/wide changes.
    element.dispatchEvent(new CustomEvent("music-layout"));
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
  // Narrow windows show the queue as an overlay: Escape or a press outside of
  // it (other than on the player, which owns the toggle) closes it again.
  const overlayOpen = () => element.classList.contains("queue-expanded");
  const closeOverlay = () => {
    config.openNarrow = false;
    apply();
    save();
  };
  const onKey = (event) => {
    if (
      event.key !== "Escape" ||
      !overlayOpen() ||
      event.defaultPrevented ||
      element.querySelector("dialog[open], .music-context")
    )
      return;
    closeOverlay();
    element.querySelector(".spotify-player [data-action=queue]")?.focus();
  };
  const onPointer = (event) => {
    if (
      overlayOpen() &&
      !event.target.closest(
        ".music-queue, .spotify-player, dialog, .music-context",
      )
    )
      closeOverlay();
  };
  element.addEventListener("keydown", onKey);
  element.addEventListener("pointerdown", onPointer);
  apply();
  return {
    config,
    get hasCustomWallpaper() {
      return !!customWallpaper;
    },
    async importWallpaper(file) {
      if (
        !file ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw Error("Escolha uma imagem PNG, JPEG ou WebP.");
      if (file.size > 12 * 1024 * 1024)
        throw Error("Escolha uma imagem de até 12 MB.");
      let bitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        throw Error(
          "Não foi possível abrir a imagem. Escolha outro PNG, JPEG ou WebP.",
        );
      }
      try {
        if (bitmap.width * bitmap.height > 40000000)
          throw Error("A imagem é muito grande. Use até 40 megapixels.");
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas
          .getContext("2d")
          .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        let image = canvas.toDataURL("image/webp", 0.82);
        if (image.length > 786432) image = canvas.toDataURL("image/webp", 0.55);
        if (
          image.length > 786432 ||
          !/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(image)
        )
          throw Error(
            "Não foi possível preparar essa imagem. Tente outra menor.",
          );
        try {
          localStorage.setItem(wallpaperKey, image);
        } catch {
          throw Error(
            "Sem espaço para salvar o fundo. Escolha uma imagem menor.",
          );
        }
        customWallpaper = image;
        config.wallpaper = "custom";
        apply();
        save();
      } finally {
        bitmap.close();
      }
    },
    clearWallpaper() {
      try {
        localStorage.removeItem(wallpaperKey);
      } catch {}
      customWallpaper = "";
      config.wallpaper = "none";
      apply();
      save();
    },
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
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("pointerdown", onPointer);
      observer.disconnect();
      cancelAnimationFrame(frame);
      grips.forEach((g) => g.remove());
    },
  };
};
