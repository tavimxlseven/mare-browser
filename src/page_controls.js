/* Presentation only: this script has no bridge to privileged browser commands. */
(() => {
  "use strict";
  let open = null;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  function close(focus = false) {
    if (!open) return;
    const { host, select, cleanup } = open;
    open = null;
    cleanup();
    host.remove();
    if (focus && select.isConnected) select.focus({ preventScroll: true });
  }
  function present(select) {
    close();
    const host = document.createElement("mare-select-surface");
    const shadow = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    const dark =
      getComputedStyle(select).colorScheme.includes("dark") ||
      (getComputedStyle(select).colorScheme === "normal" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    sheet.replaceSync(`
      :host { all:initial; position:fixed; inset:0; z-index:2147483647; pointer-events:none; }
      .menu { position:absolute; box-sizing:border-box; min-width:160px; max-width:calc(100vw - 16px);
        max-height:min(360px,60vh); overflow:auto; padding:6px; border-radius:14px;
        pointer-events:auto; background:${dark ? "#29292ef7" : "#fafafcf7"};
        color:${dark ? "#f5f5f7" : "#222228"}; border:1px solid ${dark ? "#ffffff25" : "#00000018"};
        box-shadow:0 14px 42px #0004,0 2px 8px #0002; font:14px/1.35 system-ui,sans-serif; }
      button { font:inherit; border:0; color:inherit; width:100%; background:none; text-align:left;
        padding:10px 12px; min-height:38px; border-radius:8px; display:flex; gap:10px; align-items:center; cursor:pointer; }
      button:focus { outline:none; background:#007aff; color:white; }
      button:disabled { opacity:.4; cursor:default; }
      .check { width:16px; flex:none; } .label { overflow-wrap:anywhere; }
      .group { padding:8px 12px 5px; opacity:.6; font-size:12px; font-weight:600; }
      @media(pointer:coarse) { button { min-height:44px; } }
    `);
    shadow.adoptedStyleSheets = [sheet];
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "listbox");
    menu.ariaLabel =
      select.labels?.[0]?.textContent ||
      select.ariaLabel ||
      "Escolha uma opção";
    const options = Array.from(select.options);
    let group = null;
    options.forEach((option, index) => {
      const parent = option.parentElement;
      if (parent?.tagName === "OPTGROUP" && parent !== group) {
        const title = document.createElement("div");
        title.className = "group";
        title.textContent = parent.label;
        menu.append(title);
      }
      group = parent;
      if (option.hidden || parent?.hidden) return;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(index);
      button.role = "option";
      button.ariaSelected = String(index === select.selectedIndex);
      button.disabled =
        option.disabled || (parent?.tagName === "OPTGROUP" && parent.disabled);
      const check = document.createElement("span");
      check.className = "check";
      check.ariaHidden = "true";
      check.textContent = index === select.selectedIndex ? "✓" : "";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = option.label;
      button.append(check, label);
      button.onclick = () => {
        if (!select.isConnected || select.disabled || option.disabled)
          return close();
        const changed = select.selectedIndex !== index;
        select.selectedIndex = index;
        if (changed) {
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        close(true);
      };
      menu.append(button);
    });
    shadow.append(menu);
    document.documentElement.append(host);
    const rect = select.getBoundingClientRect();
    menu.style.minWidth =
      Math.min(Math.max(rect.width, 160), innerWidth - 16) + "px";
    const box = menu.getBoundingClientRect();
    menu.style.left =
      Math.max(8, Math.min(rect.left, innerWidth - box.width - 8)) + "px";
    menu.style.top =
      Math.max(
        8,
        rect.bottom + box.height + 8 < innerHeight
          ? rect.bottom + 5
          : Math.min(rect.top - box.height - 5, innerHeight - box.height - 8),
      ) + "px";
    const choices = Array.from(menu.querySelectorAll("button:not(:disabled)"));
    let prefix = "",
      typed = 0;
    const keys = (event) => {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        close(true);
        return;
      }
      let index = choices.indexOf(shadow.activeElement);
      if (
        ["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(
          event.key,
        )
      ) {
        event.preventDefault();
        if (!choices.length) return;
        index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? choices.length - 1
              : Math.max(
                  0,
                  Math.min(
                    choices.length - 1,
                    index +
                      (event.key === "ArrowDown"
                        ? 1
                        : event.key === "ArrowUp"
                          ? -1
                          : event.key === "PageDown"
                            ? 5
                            : -5),
                  ),
                );
        choices[index]?.focus({ preventScroll: true });
        choices[index]?.scrollIntoView({ block: "nearest" });
      } else if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key !== " "
      ) {
        event.preventDefault();
        prefix =
          (Date.now() - typed > 700 ? "" : prefix) +
          event.key.toLocaleLowerCase();
        typed = Date.now();
        choices
          .find((button) =>
            options[Number(button.dataset.index)].label
              .toLocaleLowerCase()
              .startsWith(prefix),
          )
          ?.focus();
      }
    };
    const outside = (event) => {
      if (!event.composedPath().includes(host)) close();
    };
    const scrolled = (event) => {
      if (!event.composedPath().includes(host)) close();
    };
    const resized = () => close();
    const blurred = () => close();
    const observer = new MutationObserver(() => close(true));
    observer.observe(select, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    shadow.addEventListener("keydown", keys);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    window.addEventListener("blur", blurred);
    open = {
      host,
      select,
      cleanup() {
        observer.disconnect();
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("scroll", scrolled, true);
        window.removeEventListener("resize", resized);
        window.removeEventListener("blur", blurred);
      },
    };
    (
      choices.find((button) => button.ariaSelected === "true") || choices[0]
    )?.focus({ preventScroll: true });
    shadow.activeElement?.scrollIntoView({ block: "nearest" });
    if (!motion.matches)
      menu.animate(
        [
          { opacity: 0, transform: "translateY(-4px) scale(.97)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 160, easing: "cubic-bezier(.2,.7,.25,1)" },
      );
  }
  function eligible(event) {
    const select = event
      .composedPath()
      .find((node) => node instanceof HTMLSelectElement);
    return event.isTrusted &&
      select &&
      !select.disabled &&
      !select.multiple &&
      select.size <= 1 &&
      select.options.length <= 1000 &&
      typeof CSSStyleSheet.prototype.replaceSync === "function"
      ? select
      : null;
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      const select = eligible(event);
      if (!select || event.button !== 0 || event.defaultPrevented) return;
      event.preventDefault();
      present(select);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const select = eligible(event);
      if (
        !select ||
        ![" ", "Enter", "ArrowDown", "ArrowUp"].includes(event.key) ||
        event.defaultPrevented
      )
        return;
      event.preventDefault();
      present(select);
    },
    true,
  );
})();
