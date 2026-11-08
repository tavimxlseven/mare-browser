// Pointer + keyboard sorting shared by the native shell and the PWA.
(function (root) {
  root.attachMusicSort = function (
    container,
    { item = "[data-sort-key]", onCommit, onStart = () => {} },
  ) {
    let drag = null,
      frame = 0,
      suppressClick = false;
    const reduced = () =>
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !!container.closest(".music-still");
    const rows = () => [...container.querySelectorAll(item)];
    const key = (row) => row.dataset.sortKey;
    const boxes = () =>
      new Map(rows().map((row) => [key(row), row.getBoundingClientRect()]));
    const animate = (before) => {
      if (reduced()) return;
      for (const row of rows()) {
        const old = before.get(key(row));
        if (!old || row === drag?.row) continue;
        const after = row.getBoundingClientRect();
        const dy = old.top - after.top;
        if (Math.abs(dy) > 1) {
          row.getAnimations().forEach((animation) => animation.cancel());
          row.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
            { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" },
          );
        }
      }
    };
    const order = () => rows().map(key);
    function move(clientY) {
      if (!drag) return;
      drag.ghost.style.transform = `translate3d(0,${clientY - drag.y}px,0) scale(1.025)`;
      const target = rows()
        .filter((row) => row !== drag.row)
        .find((row) => {
          const rect = row.getBoundingClientRect();
          return clientY < rect.top + rect.height / 2;
        });
      if (
        target === drag.row.nextElementSibling ||
        (!target && drag.row === container.lastElementChild)
      )
        return;
      const before = boxes();
      container.insertBefore(drag.row, target || null);
      animate(before);
    }
    function scrollFrame() {
      if (!drag) return;
      const rect =
        drag.scroller === document.scrollingElement
          ? { top: 0, bottom: innerHeight }
          : drag.scroller.getBoundingClientRect();
      const delta =
        drag.clientY < rect.top + 44
          ? -9
          : drag.clientY > rect.bottom - 44
            ? 9
            : 0;
      if (delta) {
        drag.scroller.scrollTop += delta;
        move(drag.clientY);
      }
      frame = requestAnimationFrame(scrollFrame);
    }
    function finish(cancel = false) {
      if (!drag) return;
      const ended = drag;
      drag = null;
      cancelAnimationFrame(frame);
      if (cancel) for (const row of ended.original) container.append(row);
      ended.row.classList.remove("is-drag-source");
      container.classList.remove("is-sorting");
      ended.handle.setAttribute("aria-pressed", "false");
      if (reduced()) ended.ghost.remove();
      else {
        const destination =
          ended.row.getBoundingClientRect().top -
          parseFloat(ended.ghost.style.top);
        ended.ghost
          .animate(
            [
              { transform: ended.ghost.style.transform },
              {
                transform: `translate3d(0,${destination}px,0) scale(1)`,
                opacity: 0,
              },
            ],
            { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
          )
          .finished.finally(() => ended.ghost.remove())
          .catch(() => {});
      }
      try {
        container.releasePointerCapture(ended.pointer);
      } catch {}
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
      if (
        !cancel &&
        JSON.stringify(ended.original.map(key)) !== JSON.stringify(order())
      )
        Promise.resolve(onCommit(order())).catch(() => {});
    }
    container.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest("[data-sort-handle]");
      const row = handle?.closest(item);
      if (
        !row ||
        !container.contains(row) ||
        event.button !== 0 ||
        handle.disabled
      )
        return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      onStart();
      const rect = row.getBoundingClientRect();
      const ghost = row.cloneNode(true);
      ghost.removeAttribute("id");
      ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      ghost.classList.add("music-drag-ghost");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      Object.assign(ghost.style, {
        position: "fixed",
        top: rect.top + "px",
        left: rect.left + "px",
        width: rect.width + "px",
        height: rect.height + "px",
        margin: "0",
        zIndex: "2147483000",
        pointerEvents: "none",
      });
      // Keep native app color tokens and type inherited by the floating row.
      (container.closest(".spotify-app") || document.body).append(ghost);
      let scroller = container;
      while (
        scroller.parentElement &&
        !(
          scroller.scrollHeight > scroller.clientHeight &&
          /auto|scroll/.test(getComputedStyle(scroller).overflowY)
        )
      )
        scroller = scroller.parentElement;
      if (!scroller.parentElement) scroller = document.scrollingElement;
      drag = {
        row,
        handle,
        ghost,
        original: rows(),
        y: event.clientY,
        clientY: event.clientY,
        pointer: event.pointerId,
        scroller,
      };
      // The row moves in the DOM while sorting; capture on the stable list.
      container.setPointerCapture(event.pointerId);
      handle.setAttribute("aria-pressed", "true");
      row.classList.add("is-drag-source");
      container.classList.add("is-sorting");
      frame = requestAnimationFrame(scrollFrame);
    });
    container.addEventListener("pointermove", (event) => {
      if (drag && event.pointerId === drag.pointer) {
        event.preventDefault();
        drag.clientY = event.clientY;
        move(event.clientY);
      }
    });
    container.addEventListener("pointerup", (event) => {
      if (drag?.pointer === event.pointerId) finish();
    });
    container.addEventListener("pointercancel", (event) => {
      if (drag?.pointer === event.pointerId) finish(true);
    });
    container.addEventListener("lostpointercapture", () => finish(true));
    container.addEventListener(
      "click",
      (event) => {
        if (suppressClick || event.target.closest("[data-sort-handle]")) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
    container.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        finish(true);
        return;
      }
      const handle = event.target.closest("[data-sort-handle]");
      const row = handle?.closest(item);
      if (!row || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      onStart();
      const list = rows(),
        from = list.indexOf(row);
      const to =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? list.length - 1
            : Math.max(
                0,
                Math.min(
                  list.length - 1,
                  from + (event.key === "ArrowUp" ? -1 : 1),
                ),
              );
      if (from === to) return;
      const before = boxes();
      list.splice(to, 0, list.splice(from, 1)[0]);
      for (const next of list) container.append(next);
      handle.focus();
      animate(before);
      Promise.resolve(onCommit(order()))
        .finally(() =>
          rows()
            [to]?.querySelector("[data-sort-handle]")
            ?.focus({ preventScroll: true }),
        )
        .catch(() => {});
    });
    return {
      get dragging() {
        return !!drag;
      },
      cancel: () => finish(true),
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
