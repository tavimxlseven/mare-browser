/* The chrome has the only privileged IPC connection. Remote pages are separate
 * native child webviews and never receive this document or its commands. */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const paths = {
    sidebar:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 8h1M5.5 11h1M5.5 14h1"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    forward: '<path d="m9 5 7 7-7 7"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    lock: '<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    reload: '<path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 15v5h14v-5"/>',
    share: '<path d="M12 15V3m-4 4 4-4 4 4M7 9H5v12h14V9h-2"/>',
    overview:
      '<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    compass:
      '<circle cx="12" cy="12" r="9"/><path d="m16.8 7.2-3 6.6-6.6 3 3-6.6 6.6-3Z"/><path d="m10.2 10.2 3.6 3.6M12 3v1M12 20v1M3 12h1M20 12h1"/>',
    home: '<path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-7h6v7"/>',
    book: '<path d="M12 6C8 3 4 4 2.5 5v14c3-1.5 6-1.5 9.5 1 3.5-2.5 6.5-2.5 9.5-1V5c-1.5-1-5.5-2-9.5 1Zm0 0v14"/>',
    glasses:
      '<circle cx="6.5" cy="14.5" r="4.5"/><circle cx="17.5" cy="14.5" r="4.5"/><path d="M11 14c.7-.7 1.3-.7 2 0M2 14l2-9h3m15 9-2-9h-3"/>',
    history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v6l4 2"/>',
    settings:
      '<path d="m9 3-.7 2.4-2 .9L4 5.5 2 9l1.8 1.6v2.8L2 15l2 3.5 2.3-.8 2 .9L9 21h4l.7-2.4 2-.9 2.3.8 2-3.5-1.8-1.6v-2.8L20 9l-2-3.5-2.3.8-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    private:
      '<path d="M3 9h18l-2 9-5-2-2-3-2 3-5 2-2-9Z"/><path d="M6 12h3m6 0h3M6 9l2-5h8l2 5"/>',
    sliders:
      '<path d="M3 6h8m4 0h6M3 12h2m4 0h12M3 18h11m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L2.8 9.7l6.4-.9L12 3Z"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
    printer:
      '<path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 13h10v8H7Z"/><path d="M17 10h1"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    folder: '<path d="M3 6h7l2 2h9v12H3V6Z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    pin: '<path d="m15 3 6 6-4 1-4 6-2-2-6 6m6-6-3-3 6-4 1-4Z"/>',
    tab: '<path d="M3 8V5h7l2 3h9v12H3V8Z"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-5 2 2-16"/>',
    performance:
      '<path d="M3 17a9 9 0 1 1 18 0M12 12l5-5M5 18h14"/><circle cx="12" cy="12" r="2"/>',
    extension:
      '<path d="M9 3h6v4a3 3 0 1 1 4 4h2v10h-8v-3a3 3 0 1 0-6 0v3H3v-8h3a3 3 0 1 0 0-6H3V3h6Z"/>',
    shield:
      '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    zoom: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M6 10h8M10 6v8"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    reader: '<path d="M5 4h14M5 8h14M5 12h14M5 16h10M5 20h10"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
    notes:
      '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    calculator:
      '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>',
    music:
      '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
    spotify:
      '<circle cx="12" cy="12" r="11" fill="#1ed760" stroke="none"/><g stroke="#092317" stroke-width="1.7"><path d="M5.6 9.2c4.6-1.4 8.6-1 12.8 1.1M6.6 12.3c3.8-1.1 7.2-.8 10.8 1M7.7 15.2c3-.8 5.7-.5 8.6.8"/></g>',
    discord:
      '<path d="M7 4.5 9 4l.6 1.3a17 17 0 0 1 4.8 0L15 4l2 .5c2.4 3.2 3.6 7.2 3.8 11.4-1.7 1.4-3.5 2.2-5.4 2.6L14.3 17a13 13 0 0 0 2.1-1.1 13 13 0 0 1-8.8 0L9.7 17l-1.1 1.5a16 16 0 0 1-5.4-2.6C3.4 11.7 4.6 7.7 7 4.5Z" fill="#8993ff" stroke="none"/><ellipse cx="8.6" cy="11.8" rx="1.5" ry="1.8" fill="#202441" stroke="none"/><ellipse cx="15.4" cy="11.8" rx="1.5" ry="1.8" fill="#202441" stroke="none"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.globe}</svg>`;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const hostname = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url === "mare://start" ? "Página inicial" : String(url || "");
    }
  };
  const isStart = (tab) =>
    !tab || tab.url === "mare://start" || tab.url === "about:blank";
  const active = () =>
    state.tabs.find((t) => t.id === state.active_id) || state.tabs[0];
  const isNative = !!window.ipc?.postMessage;
  let state = {
    tabs: [
      {
        id: 1,
        title: "Página inicial",
        url: "mare://start",
        loading: false,
        private: false,
        pinned: false,
        can_go_back: false,
        can_go_forward: false,
      },
    ],
    active_id: 1,
    bookmarks: [
      { id: 10, title: "Wikipedia", url: "https://pt.wikipedia.org" },
      { id: 11, title: "GitHub", url: "https://github.com" },
      { id: 12, title: "Apple", url: "https://www.apple.com" },
      { id: 13, title: "Rust", url: "https://www.rust-lang.org" },
      { id: 14, title: "YouTube", url: "https://www.youtube.com" },
    ],
    history: [],
    reading_list: [],
    downloads: [],
    settings: {
      theme: "system",
      search_engine: "duckduckgo",
      restore_session: true,
      home_background: "aurora",
      shield_enabled: true,
    },
    version: "0.1.0",
    protection: null,
    apps: { catalog: [], active_id: null, running: [], process_count: 0 },
  };
  const ui = {
    sidebar: false,
    section: "bookmarks",
    query: "",
    popup: null,
    overlay: null,
    find: false,
    zoom: 1,
    suggestion: 0,
    dragId: null,
    editing: null,
    motion: false,
  };
  let layoutFrame,
    lastLayout = "",
    toastTimer,
    suggestionTimer,
    findTimer,
    lastActiveId,
    lastLocationKey;
  const previouslyClosed = [];
  const media = matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const rendered = new Map();
  const appData = {
    notes: [],
    selected_id: null,
    noteOpenedId: null,
    calculator: null,
    instance: null,
    dirty: false,
    draft: null,
  };
  const appEventsSeen = new Set();
  const appRequests = new Map();
  const appViews = new Map();
  const appInstances = new Map();
  let transitionEpoch = 0,
    sidebarEpoch = 0,
    requestSequence = Date.now(),
    noteSaveTimer,
    noteRevision = 0;
  const motion = { popup: 130, panel: 190, sidebar: 180 };
  function animate(element, keyframes, duration) {
    element.getAnimations().forEach((animation) => animation.cancel());
    if (reducedMotion.matches) return Promise.resolve();
    return element
      .animate(keyframes, { duration, easing: "cubic-bezier(.2,.7,.25,1)" })
      .finished.catch(() => {});
  }
  function cached(key, value, renderFn) {
    const signature = JSON.stringify(value);
    if (rendered.get(key) !== signature) {
      rendered.set(key, signature);
      renderFn();
    }
  }
  async function leaveApp(nextCommand) {
    if (ui.leavingApp) return;
    ui.leavingApp = true;
    try {
      await flushNote();
      sendRaw(nextCommand || { cmd: "apps_background" });
    } catch {
      notify(
        "A nota ainda não foi salva. Tente salvar novamente antes de sair.",
      );
    } finally {
      ui.leavingApp = false;
    }
  }
  async function closeAppTab(id) {
    if (!id) return;
    try {
      if (id === "notes") await flushNote();
      sendRaw({ cmd: "apps_close", id });
    } catch {
      notify(
        "A nota ainda não foi salva. Tente salvar novamente antes de fechar a aba.",
      );
    }
  }
  async function requestClose() {
    if (ui.closeRequested) return;
    ui.closeRequested = true;
    try {
      await flushNote();
      sendRaw({ cmd: "window", action: "close" });
    } catch {
      notify(
        "A nota ainda não foi salva. Tente salvar novamente antes de fechar o Maré.",
      );
    } finally {
      ui.closeRequested = false;
    }
  }
  const dateFormat = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  function hydrateIcons(root = document) {
    $$("[data-icon]", root).forEach((el) => {
      el.innerHTML = icon(el.dataset.icon);
    });
  }
  function send(command) {
    if (command.cmd === "apps_close") {
      closeAppTab(command.id || state.apps?.active_id);
      return;
    }
    if (
      (state.apps?.active_id || appData.dirty) &&
      [
        "activate",
        "navigate",
        "new_tab",
        "back",
        "forward",
        "apps_open",
        "apps_background",
      ].includes(command.cmd)
    ) {
      leaveApp(command);
      return;
    }
    sendRaw(command);
  }
  function sendRaw(command) {
    if (isNative) {
      window.ipc.postMessage(JSON.stringify(command));
    } else {
      preview(command);
    }
  }
  function notify(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = String(message);
    $("#toast").hidden = false;
    animate(
      $("#toast"),
      [
        { opacity: 0, transform: "translate(-50%, 5px)" },
        { opacity: 1, transform: "translate(-50%, 0)" },
      ],
      130,
    );
    toastTimer = setTimeout(() => {
      animate($("#toast"), [{ opacity: 1 }, { opacity: 0 }], 100).then(() => {
        $("#toast").hidden = true;
      });
    }, 4300);
  }
  function updateLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      const r = $("#viewport").getBoundingClientRect();
      const data = {
        cmd: "layout",
        window_width: innerWidth,
        window_height: innerHeight,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        app_bounds:
          state.apps?.active_id === "discord" && $("#native-app-body")
            ? (() => {
                const b = $("#native-app-body").getBoundingClientRect();
                return [b.x, b.y, b.width, b.height];
              })()
            : null,
        panels: ["#popup", "#suggestions", "#toast"]
          .map((selector) => $(selector))
          .filter((el) => !el.hidden)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return [rect.x, rect.y, rect.width, rect.height];
          }),
        overlay:
          !!document.querySelector(".native-app-launch") ||
          (!!state.apps?.active_id && state.apps.active_id !== "discord") ||
          !$("#overlay").hidden ||
          (ui.sidebar && innerWidth <= 520),
      };
      const encoded = JSON.stringify(data);
      if (encoded !== lastLayout) {
        lastLayout = encoded;
        send(data);
      }
    });
  }
  function applyTheme() {
    const theme =
      state.settings.theme === "system"
        ? media.matches
          ? "dark"
          : "light"
        : state.settings.theme;
    if (document.documentElement.dataset.theme !== theme)
      document.documentElement.dataset.theme = theme;
    const wallpaper = `wallpaper ${["aurora", "ocean", "dusk", "minimal"].includes(state.settings.home_background) ? state.settings.home_background : "aurora"}`;
    if ($("#startpage").className !== wallpaper)
      $("#startpage").className = wallpaper;
  }
  function receive(incoming) {
    try {
      const next =
        typeof incoming === "string" ? JSON.parse(incoming) : incoming;
      if (!next || (next.tabs && !Array.isArray(next.tabs))) return;
      state = {
        ...state,
        ...next,
        settings: { ...state.settings, ...next.settings },
      };
      render();
    } catch (error) {
      notify("Não foi possível atualizar a interface.");
    }
  }
  function render() {
    const tab = active();
    if (!tab) return;
    const foregroundApp = state.apps?.active_id;
    const locationKey = foregroundApp
      ? `app:${foregroundApp}`
      : `web:${state.active_id}`;
    applyTheme();
    document.title = `${tab.title || hostname(tab.url)} — Maré`;
    document.body.classList.toggle("private-mode", !!tab.private);
    $("#back").disabled = !!foregroundApp || !tab.can_go_back;
    $("#forward").disabled = !!foregroundApp || !tab.can_go_forward;
    $("#reload").disabled = !!foregroundApp;
    $("#address-form").classList.toggle("loading", !!tab.loading);
    if (
      document.activeElement !== $("#address") ||
      lastLocationKey !== locationKey
    )
      $("#address").value = foregroundApp
        ? `mare://apps/${foregroundApp}`
        : isStart(tab)
          ? ""
          : tab.url;
    $("#reload").innerHTML = icon(tab.loading ? "close" : "reload");
    $("#reload").title = tab.loading
      ? "Parar carregamento (Esc)"
      : "Recarregar (Ctrl+R)";
    $("#reload").setAttribute(
      "aria-label",
      tab.loading ? "Parar carregamento" : "Recarregar página",
    );
    $("#site-info").innerHTML = icon(
      isStart(tab)
        ? tab.private
          ? "private"
          : "search"
        : tab.url.startsWith("https:")
          ? "lock"
          : "globe",
    );
    $("#reader-button").hidden = !!foregroundApp || isStart(tab);
    if (foregroundApp)
      $("#site-info").innerHTML = icon(appIcon({ id: foregroundApp }));
    $("#startpage").hidden = !isStart(tab);
    $("#remote-placeholder").hidden = isStart(tab) || isNative;
    document.documentElement.dataset.remote = String(
      isNative &&
        ((!isStart(tab) && !foregroundApp) || foregroundApp === "discord"),
    );
    document.documentElement.dataset.external = String(
      foregroundApp === "discord",
    );
    $("#remote-domain").textContent = hostname(tab.url);
    if (!isNative && !isStart(tab)) {
      $("#remote-placeholder p").textContent = "Prévia da interface";
      $("#remote-domain").textContent =
        `${tab.url} — abra o aplicativo Maré para navegar.`;
      $(".remote-spinner").style.animation = "none";
    }
    $(".private-note").hidden = !tab.private;
    $("#welcome-label").textContent = tab.private
      ? "Navegação privada"
      : "Página inicial";
    $(".welcome-subtitle").textContent = tab.private
      ? "O histórico desta aba não será salvo."
      : "Favoritos, leituras e páginas recentes.";
    $("#version-label").textContent = state.version ? `v${state.version}` : "";
    cached(
      "tabs",
      [state.tabs, state.active_id, openAppTabs(), state.apps?.active_id],
      renderTabs,
    );
    cached(
      "home",
      [
        state.bookmarks,
        state.reading_list,
        state.history.slice(0, 8),
        state.site_icons,
      ],
      renderHome,
    );
    cached(
      "sidebar",
      [
        ui.sidebar,
        ui.section,
        ui.query,
        state.bookmarks,
        state.reading_list,
        state.history,
        state.site_icons,
      ],
      renderSidebar,
    );
    if (ui.overlay === "overview")
      cached(
        "overview",
        [state.tabs, state.active_id, openAppTabs(), state.apps?.active_id],
        renderOverview,
      );
    if (ui.popup === "downloads")
      cached("downloads", state.downloads, renderDownloads);
    renderProtection();
    renderApps();
    lastActiveId = state.active_id;
    lastLocationKey = locationKey;
    updateLayout();
  }
  function openAppTabs() {
    if (Array.isArray(state.apps?.open)) return state.apps.open;
    const running = (state.apps?.catalog || []).filter((app) => app.running);
    const activeId = state.apps?.active_id;
    if (activeId && !running.some((app) => app.id === activeId)) {
      const activeApp = (state.apps?.catalog || []).find(
        (app) => app.id === activeId,
      );
      if (activeApp) running.push(activeApp);
    }
    return running;
  }
  function combinedTabs() {
    return [
      ...state.tabs.map((tab) => ({ ...tab, kind: "web" })),
      ...openAppTabs().map((app) => ({ ...app, kind: "app" })),
    ];
  }
  let lastAnimatedTab;
  function renderTabs() {
    const target = $("#tabs");
    const scroll = target.scrollLeft;
    target.innerHTML =
      state.tabs
        .map(
          (tab) =>
            `<div class="tab${tab.private ? " private" : ""}${tab.pinned ? " pinned" : ""}${tab.loading ? " loading" : ""}" role="tab" aria-selected="${!state.apps?.active_id && tab.id === state.active_id}" tabindex="${!state.apps?.active_id && tab.id === state.active_id ? 0 : -1}" data-tab="${tab.id}" draggable="true" title="${esc(tab.title || hostname(tab.url))}${tab.private ? " (privada)" : ""}\n${esc(tab.url)}"><span class="tab-icon">${tab.loading ? icon("reload") : tab.private ? icon("private") : isStart(tab) ? icon("compass") : siteImage(tab)}</span><span class="tab-title">${esc(tab.title || hostname(tab.url))}</span>${tab.pinned ? "" : `<button class="tab-close" data-close-tab="${tab.id}" aria-label="Fechar ${esc(tab.title || "aba")}" tabindex="-1">${icon("close")}</button>`}</div>`,
        )
        .join("") +
      openAppTabs()
        .map(
          (app) =>
            `<div class="tab native-app-tab" role="tab" aria-selected="${state.apps?.active_id === app.id}" tabindex="${state.apps?.active_id === app.id ? 0 : -1}" data-app-tab="${esc(app.id)}" title="${esc(app.name)} · Aplicativo Rust"><span class="tab-icon">${icon(appIcon(app))}</span><span class="tab-title">${esc(app.name)}</span><button class="tab-close" data-close-app="${esc(app.id)}" aria-label="Fechar ${esc(app.name)}" tabindex="-1">${icon("close")}</button></div>`,
        )
        .join("");
    target.scrollLeft = scroll;
    const animatedTab = state.apps?.active_id || String(state.active_id);
    if (animatedTab !== lastAnimatedTab) {
      const selected = target.querySelector('[aria-selected="true"]');
      if (selected)
        animate(
          selected,
          [
            { opacity: 0.65, transform: "translateY(3px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          200,
        );
      lastAnimatedTab = animatedTab;
    }
    $$("[data-tab]", target).forEach((el) => {
      el.addEventListener("click", (e) => {
        if (!e.target.closest("[data-close-tab]")) {
          closeTransient();
          send({ cmd: "activate", id: Number(el.dataset.tab) });
        }
      });
      el.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          send({ cmd: "close_tab", id: Number(el.dataset.tab) });
        }
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showTabMenu(Number(el.dataset.tab), e.clientX, e.clientY);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          send({ cmd: "activate", id: Number(el.dataset.tab) });
        }
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          cycleTabs(e.key === "ArrowLeft" ? -1 : 1);
        }
        if (e.key === "Delete") {
          send({ cmd: "close_tab", id: Number(el.dataset.tab) });
        }
      });
      el.addEventListener("dragstart", (e) => {
        ui.dragId = Number(el.dataset.tab);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", el.dataset.tab);
      });
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        el.classList.add("drag-over");
        e.dataTransfer.dropEffect = "move";
      });
      el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("drag-over");
        const ids = state.tabs.map((t) => t.id),
          from = ids.indexOf(ui.dragId),
          to = ids.indexOf(Number(el.dataset.tab));
        if (from >= 0 && to >= 0) {
          ids.splice(to, 0, ...ids.splice(from, 1));
          send({ cmd: "reorder_tabs", ids });
        }
      });
      el.addEventListener("dragend", () => {
        ui.dragId = null;
        $$(".drag-over").forEach((item) => item.classList.remove("drag-over"));
      });
    });
    $$("[data-close-tab]", target).forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        send({ cmd: "close_tab", id: Number(el.dataset.closeTab) });
      }),
    );
    $$("[data-app-tab]", target).forEach((element) => {
      const id = element.dataset.appTab;
      element.onclick = (event) => {
        if (!event.target.closest("[data-close-app]")) {
          closeTransient();
          send({ cmd: "apps_open", id });
        }
      };
      element.onauxclick = (event) => {
        if (event.button === 1) {
          event.preventDefault();
          closeAppTab(id);
        }
      };
      element.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          send({ cmd: "apps_open", id });
        } else if (event.key === "Delete") {
          event.preventDefault();
          closeAppTab(id);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          cycleTabs(event.key === "ArrowLeft" ? -1 : 1);
        }
      };
      element.oncontextmenu = (event) => {
        event.preventDefault();
        showPopup(
          menuItem("close", "Fechar aplicativo", "close-app", "", id),
          null,
          "app-tab",
          { x: event.clientX + 260, y: event.clientY },
        );
      };
    });
    $$("[data-close-app]", target).forEach(
      (button) =>
        (button.onclick = (event) => {
          event.stopPropagation();
          closeAppTab(button.dataset.closeApp);
        }),
    );
  }
  const tileColor = (url) => {
    const h = hostname(url);
    return h.includes("youtube")
      ? "#cf3544"
      : h.includes("rust")
        ? "#874c36"
        : h.includes("wikipedia")
          ? "#3c3c48"
          : h.includes("github")
            ? "#5a4b74"
            : h.includes("apple")
              ? "#6d7180"
              : "#4b72a6";
  };
  const failedSiteIcons = new Set();
  function siteImage(item) {
    let src = "";
    try {
      const url = new URL(item.url);
      if (["https:", "http:"].includes(url.protocol))
        src =
          item.favicon ||
          state.site_icons?.[url.origin] ||
          url.origin + "/favicon.ico";
    } catch {}
    const fallback = `<span class="site-fallback">${esc(letter(item))}</span>`;
    return !src || failedSiteIcons.has(src)
      ? fallback
      : `${fallback}<img class="site-image" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }
  document.addEventListener(
    "error",
    (event) => {
      if (event.target.matches?.("img.site-image")) {
        failedSiteIcons.add(event.target.src);
        event.target.remove();
      }
    },
    true,
  );
  document.addEventListener(
    "load",
    (event) => {
      if (event.target.matches?.("img.site-image"))
        event.target.parentElement.classList.add("site-loaded");
    },
    true,
  );
  const letter = (item) =>
    (item.title || hostname(item.url))
      .trim()
      .slice(0, 1)
      .toLocaleUpperCase("pt-BR");
  const emptyCard = (glyph, title, text) =>
    `<div class="home-empty"><div class="empty-glyph">${icon(glyph)}</div><div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></div>`;
  function homeRow(item) {
    return `<button class="home-row" data-go="${esc(item.url)}" title="${esc(item.url)}"><div class="library-icon">${siteImage(item)}</div><div><span class="item-title">${esc(item.title || hostname(item.url))}</span><span class="item-subtitle">${esc(hostname(item.url))}</span></div></button>`;
  }
  function renderHome() {
    $("#favorites").innerHTML = state.bookmarks.length
      ? state.bookmarks
          .slice(0, 16)
          .map(
            (item) =>
              `<div class="favorite-wrap" style="position:relative;min-width:0"><button class="favorite" data-go="${esc(item.url)}" title="${esc(item.url)}" style="width:100%"><span class="favorite-tile" style="--tile-color:${tileColor(item.url)}">${siteImage(item)}</span><span class="favorite-name">${esc(item.title || hostname(item.url))}</span></button></div>`,
          )
          .join("")
      : '<div class="favorites-empty">Seus sites favoritos ficam aqui. Use + para adicionar o primeiro.</div>';
    const reading = state.reading_list.filter((item) => !item.read).slice(0, 3);
    $("#reading-preview").innerHTML = reading.length
      ? `<div class="home-rows">${reading.map(homeRow).join("")}</div>`
      : emptyCard(
          "glasses",
          "Nenhuma leitura salva",
          "Salve uma página pelo menu Compartilhar.",
        );
    const seen = new Set();
    const recent = state.history
      .filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .slice(0, 3);
    $("#recent-preview").innerHTML = recent.length
      ? `<div class="home-rows">${recent.map(homeRow).join("")}</div>`
      : emptyCard(
          "history",
          "Nenhuma página recente",
          "As páginas visitadas aparecem aqui.",
        );
    $$("[data-go]", $("#startpage")).forEach((el) =>
      el.addEventListener("click", () => navigate(el.dataset.go)),
    );
    $$(".favorite-wrap", $("#favorites")).forEach((el, i) =>
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showFavoriteMenu(state.bookmarks[i], e.clientX, e.clientY);
      }),
    );
  }
  function renderSidebar() {
    $("#sidebar").hidden = !(ui.sidebar || ui.sidebarClosing);
    $("#sidebar-toggle").setAttribute("aria-pressed", String(ui.sidebar));
    $("#sidebar-toggle").setAttribute("aria-expanded", String(ui.sidebar));
    if (!ui.sidebar) return;
    $("#sidebar-title").textContent = {
      bookmarks: "Favoritos",
      reading: "Lista de leitura",
      history: "Histórico",
    }[ui.section];
    $$("[data-section]").forEach((el) =>
      el.setAttribute(
        "aria-selected",
        String(el.dataset.section === ui.section),
      ),
    );
    $("#sidebar-add").hidden = ui.section === "history";
    $("#sidebar-add").title =
      ui.section === "reading"
        ? "Adicionar página atual à lista"
        : "Adicionar favorito";
    const q = ui.query.toLocaleLowerCase("pt-BR");
    const items = (
      ui.section === "bookmarks"
        ? state.bookmarks
        : ui.section === "reading"
          ? state.reading_list
          : state.history
    ).filter((item) =>
      `${item.title} ${item.url}`.toLocaleLowerCase("pt-BR").includes(q),
    );
    const empty =
      ui.section === "bookmarks"
        ? ["star", "Nenhum favorito", "Adicione um site com o botão +."]
        : ui.section === "reading"
          ? [
              "glasses",
              "Nenhuma leitura salva",
              "Salve uma página pelo menu Compartilhar.",
            ]
          : [
              "history",
              "Nenhuma página recente",
              "Seu histórico aparecerá aqui.",
            ];
    $("#sidebar-list").innerHTML = items.length
      ? items
          .slice(0, 250)
          .map(
            (item, index) =>
              `<div class="library-item" role="button" tabindex="0" data-library-index="${index}" title="${esc(item.url)}"><span class="library-icon">${siteImage(item)}</span><div class="item-copy"><span class="item-title">${item.read ? "✓ " : ""}${esc(item.title || hostname(item.url))}</span><span class="item-subtitle">${esc(ui.section === "history" ? `${hostname(item.url)} · ${formatDate(item.visited_at)}` : hostname(item.url))}</span></div>${ui.section !== "history" ? `<button class="item-action" data-library-remove="${index}" title="Remover" aria-label="Remover ${esc(item.title)}">${icon("close")}</button>` : ""}</div>`,
          )
          .join("")
      : `<div class="library-empty">${icon(q ? "search" : empty[0])}<p>${esc(q ? "Nenhum resultado" : empty[1])}</p>${esc(q ? "Tente outro título ou endereço." : empty[2])}</div>`;
    $$("[data-library-index]").forEach((el) => {
      const item = items[Number(el.dataset.libraryIndex)];
      el.addEventListener("click", (e) => {
        if (!e.target.closest("[data-library-remove]")) navigate(item.url);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          navigate(item.url);
        }
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (ui.section === "bookmarks")
          showFavoriteMenu(item, e.clientX, e.clientY);
        if (ui.section === "reading")
          showReadingMenu(item, e.clientX, e.clientY);
      });
    });
    $$("[data-library-remove]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = items[Number(el.dataset.libraryRemove)];
        send({
          cmd: ui.section === "reading" ? "remove_reading" : "remove_bookmark",
          id: item.id,
        });
      }),
    );
    if (ui.section === "history" && state.history.length) {
      const btn = document.createElement("button");
      btn.className = "text-button";
      btn.style.cssText = "display:block;margin:18px auto 0";
      btn.textContent = "Limpar histórico…";
      btn.addEventListener("click", confirmHistory);
      $("#sidebar-list").append(btn);
    }
  }
  function formatDate(value) {
    try {
      return dateFormat.format(new Date(value));
    } catch {
      return "";
    }
  }
  function navigate(url) {
    closeTransient();
    const appRoute = String(url).match(/^mare:\/\/apps\/([a-z0-9-]+)\/?$/i);
    send(
      appRoute
        ? { cmd: "apps_open", id: appRoute[1] }
        : { cmd: "navigate", url },
    );
    $("#address").blur();
  }
  function newTab(privateTab = false, url = "mare://start") {
    closeTransient();
    send({ cmd: "new_tab", url, private: privateTab });
    if (url === "mare://start") setTimeout(focusAddress, 70);
  }
  function focusAddress() {
    closeTransient();
    $("#address").focus();
    $("#address").select();
    renderSuggestions();
  }
  function cycleTabs(direction) {
    const tabs = combinedTabs();
    const activeApp = state.apps?.active_id;
    const index = tabs.findIndex((tab) =>
      activeApp
        ? tab.kind === "app" && tab.id === activeApp
        : tab.kind === "web" && tab.id === state.active_id,
    );
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    if (next)
      send({
        cmd: next.kind === "app" ? "apps_open" : "activate",
        id: next.id,
      });
  }
  function toggleSidebar(section) {
    const wasOpen = ui.sidebar;
    ui.sidebar = section ? true : !ui.sidebar;
    if (section) {
      ui.section = section;
      ui.query = "";
      $("#library-search").value = "";
    }
    closeTransient(true);
    const epoch = ++sidebarEpoch;
    if (wasOpen === ui.sidebar || reducedMotion.matches) {
      renderSidebar();
      updateLayout();
      return;
    }
    ui.sidebarAnimating = true;
    ui.sidebarClosing = !ui.sidebar;
    updateLayout();
    if (ui.sidebar) {
      renderSidebar();
      animate(
        $("#sidebar"),
        [
          { opacity: 0, transform: "translateX(-14px)" },
          { opacity: 1, transform: "translateX(0)" },
        ],
        motion.sidebar,
      ).then(finish);
    } else {
      animate(
        $("#sidebar"),
        [
          { opacity: 1, transform: "translateX(0)" },
          { opacity: 0, transform: "translateX(-14px)" },
        ],
        motion.sidebar,
      ).then(finish);
    }
    function finish() {
      if (epoch !== sidebarEpoch) return;
      ui.sidebarAnimating = false;
      ui.sidebarClosing = false;
      renderSidebar();
      rendered.delete("sidebar");
      updateLayout();
    }
  }
  function closeTransient(immediate = false) {
    clearInterval(resourceTimer);
    immediate = immediate === true;
    closeSelect();
    const epoch = ++transitionEpoch;
    const popup = $("#popup"),
      overlay = $("#overlay");
    const panelWasOpen = !overlay.hidden;
    const focused = document.activeElement;
    $("#suggestions").hidden = true;
    $("#address").setAttribute("aria-expanded", "false");
    ui.popup = null;
    ui.overlay = null;
    const finish = () => {
      if (epoch !== transitionEpoch) return;
      popup.hidden = true;
      overlay.hidden = true;
      popup.style.pointerEvents = "";
      overlay.style.pointerEvents = "";
      ui.motion = false;
      $("#overlay-panel").className = "";
      if (
        panelWasOpen &&
        overlay.contains(focused) &&
        ui.returnFocus?.isConnected &&
        ui.returnFocus.getClientRects().length
      )
        ui.returnFocus.focus();
      updateLayout();
    };
    if (
      immediate ||
      reducedMotion.matches ||
      (popup.hidden && overlay.hidden)
    ) {
      popup.getAnimations().forEach((a) => a.cancel());
      overlay.getAnimations().forEach((a) => a.cancel());
      finish();
      return;
    }
    ui.motion = true;
    popup.style.pointerEvents = "none";
    overlay.style.pointerEvents = "none";
    updateLayout();
    const tasks = [];
    if (!popup.hidden)
      tasks.push(
        animate(
          popup,
          [
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(-3px)" },
          ],
          90,
        ),
      );
    if (!overlay.hidden)
      tasks.push(animate(overlay, [{ opacity: 1 }, { opacity: 0 }], 120));
    Promise.all(tasks).then(finish);
  }
  function renderSuggestions() {
    const q = $("#address").value.trim().toLocaleLowerCase("pt-BR"),
      target = $("#suggestions");
    if (document.activeElement !== $("#address")) return;
    const seen = new Set();
    const matches = [...state.bookmarks, ...state.history]
      .filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return (
          !q ||
          `${item.title} ${item.url}`.toLocaleLowerCase("pt-BR").includes(q)
        );
      })
      .slice(0, 7);
    const search = q
      ? `<button class="suggestion" role="option" data-suggest="${esc($("#address").value.trim())}">${icon("search")}<span><span class="item-title">Pesquisar “${esc($("#address").value.trim())}”</span><span class="item-subtitle">${esc({ duckduckgo: "DuckDuckGo", google: "Google", bing: "Bing" }[state.settings.search_engine] || "DuckDuckGo")}</span></span></button>`
      : "";
    target.innerHTML = `${search}<div class="suggestion-heading">${q ? "Favoritos e histórico" : "Favoritos"}</div>${matches.map((item) => `<button class="suggestion" role="option" data-suggest="${esc(item.url)}">${icon("globe")}<span><span class="item-title">${esc(item.title || hostname(item.url))}</span><span class="item-subtitle">${esc(hostname(item.url))}</span></span></button>`).join("")}${!matches.length ? '<div class="suggestion-heading">Nenhuma página encontrada na sua biblioteca.</div>' : ""}`;
    const r = $("#address-form").getBoundingClientRect();
    target.style.left = `${r.left}px`;
    target.style.top = `${r.bottom + 6}px`;
    target.style.width = `${r.width}px`;
    target.hidden = false;
    ui.suggestion = -1;
    $("#address").setAttribute("aria-expanded", "true");
    $$("[data-suggest]", target).forEach((el) =>
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        navigate(el.dataset.suggest);
      }),
    );
    updateLayout();
  }
  function showPopup(html, anchor, kind = "menu", position) {
    closeTransient(true);
    const popup = $("#popup");
    popup.innerHTML = html;
    popup.hidden = false;
    ui.popup = kind;
    const r = anchor ? anchor.getBoundingClientRect() : null;
    const x = position?.x ?? r?.right ?? innerWidth - 20;
    const y = position?.y ?? (r?.bottom ?? 45) + 7;
    popup.style.left = `${Math.max(8, Math.min(x - popup.offsetWidth, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(y, innerHeight - popup.offsetHeight - 10))}px`;
    $$("[data-menu-action]", popup).forEach((el) =>
      el.addEventListener("click", () => {
        const action = el.dataset.menuAction;
        closeTransient();
        menuAction(action, el.dataset.id);
      }),
    );
    animate(
      popup,
      [
        { opacity: 0, transform: "translateY(-4px) scale(.985)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      motion.popup,
    );
    updateLayout();
  }
  const menuItem = (
    glyph,
    label,
    action,
    shortcut = "",
    id = "",
    danger = false,
  ) =>
    `<button class="menu-item${danger ? " danger" : ""}" data-menu-action="${esc(action)}" data-id="${esc(id)}">${icon(glyph)}<span>${esc(label)}</span>${shortcut ? `<span class="shortcut">${esc(shortcut)}</span>` : ""}</button>`;
  const separator = '<hr class="menu-separator">';
  function showShare() {
    const tab = active(),
      saved = state.bookmarks.some((b) => b.url === tab.url);
    showPopup(
      menuItem("copy", "Copiar endereço", "copy") +
        separator +
        menuItem(
          "star",
          saved ? "Remover dos Favoritos" : "Adicionar aos Favoritos",
          "bookmark",
          "Ctrl+D",
        ) +
        menuItem("glasses", "Adicionar à Lista de Leitura", "reading") +
        separator +
        menuItem("printer", "Imprimir…", "print", "Ctrl+P"),
      $("#share-button"),
      "share",
    );
  }
  function showMore() {
    showPopup(
      menuItem("plus", "Nova aba", "new", "Ctrl+T") +
        menuItem("private", "Nova aba privada", "private", "Ctrl+Shift+N") +
        menuItem("history", "Reabrir aba fechada", "reopen", "Ctrl+Shift+T") +
        separator +
        menuItem("book", "Favoritos", "bookmarks", "Ctrl+B") +
        menuItem("history", "Histórico", "history", "Ctrl+H") +
        menuItem("download", "Downloads", "downloads", "Ctrl+J") +
        menuItem("extension", "Extensões", "extensions") +
        separator +
        menuItem("reader", "Modo de leitura", "reader", "Ctrl+Shift+R") +
        menuItem("search", "Buscar nesta página…", "find", "Ctrl+F") +
        menuItem("zoom", `Zoom: ${Math.round(ui.zoom * 100)}%`, "zoom") +
        menuItem("printer", "Imprimir…", "print", "Ctrl+P") +
        separator +
        menuItem("settings", "Ajustes…", "settings") +
        menuItem(
          "sliders",
          "Gerenciador de tarefas",
          "task-manager",
          "Shift+Esc",
        ) +
        menuItem("code", "Ferramentas de desenvolvedor", "devtools", "F12"),
      $("#more-button"),
      "more",
    );
  }
  let extensionState = { items: [] };
  function showExtensions() {
    showOverlay(
      "extensions",
      "Extensões",
      '<p class="extensions-intro">Instale extensões Manifest V3 pelo link da Chrome Web Store. Algumas APIs do Chrome não estão disponíveis no WebView2.</p><form id="extension-add"><label for="extension-url">Link da Chrome Web Store</label><div><input id="extension-url" type="url" required placeholder="https://chromewebstore.google.com/detail/…"><button class="button primary">Verificar extensão</button></div></form><div id="extension-review" aria-live="polite"></div><div id="extension-items"></div><div class="resource-actions"><button class="button" id="extension-store">Abrir Chrome Web Store</button><button class="button" id="extension-refresh">Atualizar lista</button></div>',
      "extensions-panel",
    );
    if (
      /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com)\//.test(
        active().url,
      )
    )
      $("#extension-url").value = active().url;
    $("#extension-add").onsubmit = (event) => {
      event.preventDefault();
      send({ cmd: "extensions_prepare", url: $("#extension-url").value });
    };
    $("#extension-store").onclick = () =>
      newTab(false, "https://chromewebstore.google.com/");
    $("#extension-refresh").onclick = () => send({ cmd: "extensions_list" });
    renderExtensions();
    send({ cmd: "extensions_list" });
  }
  function extensionsEvent(result) {
    if (result.state === "error") extensionState.prepared = null;
    if (result.items) extensionState.items = result.items;
    if (result.state) {
      extensionState.state = result.state;
      extensionState.error = result.error;
    }
    if (result.prepared) extensionState.prepared = result.prepared;
    if (result.items && extensionState.state === "installing") {
      extensionState.state = "ready";
      extensionState.prepared = null;
    }
    if (ui.overlay === "extensions") renderExtensions();
  }
  function renderExtensions() {
    if (ui.overlay !== "extensions") return;
    const p = extensionState.prepared,
      busy = ["downloading", "installing"].includes(extensionState.state);
    $("#extension-add button").disabled = busy || !!p;
    $("#extension-review").innerHTML = busy
      ? '<p role="status">' +
        (extensionState.state === "installing"
          ? "Instalando extensão…"
          : "Baixando e verificando a assinatura da extensão…") +
        "</p>"
      : p
        ? '<section class="extension-review"><h3>' +
          esc(p.name) +
          "</h3><p>Versão " +
          esc(p.version) +
          " · Assinatura verificada</p><h4>Permissões solicitadas</h4><ul>" +
          (p.permissions.length
            ? p.permissions
                .map((value) => "<li>" + esc(value) + "</li>")
                .join("")
            : "<li>Nenhuma permissão adicional declarada.</li>") +
          '</ul><p>Extensões com acesso a sites podem ler ou alterar o conteúdo dessas páginas.</p><button class="button primary" data-extension-confirm>Adicionar ao Maré</button><button class="button" data-extension-cancel>Cancelar</button></section>'
        : extensionState.error
          ? '<p role="alert">' + esc(extensionState.error) + "</p>"
          : "";
    $("[data-extension-confirm]")?.addEventListener("click", () => {
      extensionState.state = "installing";
      renderExtensions();
      send({ cmd: "extensions_install" });
    });
    $("[data-extension-cancel]")?.addEventListener("click", () => {
      extensionState.prepared = null;
      extensionState.state = "ready";
      send({ cmd: "extensions_cancel" });
      renderExtensions();
    });
    $("#extension-items").innerHTML = extensionState.items.length
      ? extensionState.items
          .map(
            (item) =>
              '<article class="extension-item"><span class="extension-glyph">' +
              icon("extension") +
              "</span><div><strong>" +
              esc(item.name) +
              "</strong><small>" +
              esc(item.id) +
              '</small></div><label class="extension-toggle"><input type="checkbox" data-extension-enable="' +
              esc(item.id) +
              '" ' +
              (item.enabled ? "checked" : "") +
              "> Ativa</label>" +
              (item.popup
                ? '<button class="button" data-extension-open="' +
                  esc(item.id) +
                  '">Abrir</button>'
                : "") +
              '<button class="icon-button" data-extension-remove="' +
              esc(item.id) +
              '" aria-label="Remover ' +
              esc(item.name) +
              '">' +
              icon("trash") +
              "</button></article>",
          )
          .join("")
      : '<p class="extensions-empty">Nenhuma extensão instalada.</p>';
    $$("[data-extension-enable]").forEach(
      (el) =>
        (el.onchange = () =>
          send({
            cmd: "extensions_enable",
            id: el.dataset.extensionEnable,
            enabled: el.checked,
          })),
    );
    $$("[data-extension-open]").forEach(
      (el) =>
        (el.onclick = () => {
          closeTransient();
          send({ cmd: "extension_open", id: el.dataset.extensionOpen });
        }),
    );
    $$("[data-extension-remove]").forEach(
      (el) =>
        (el.onclick = () => {
          el.disabled = true;
          send({ cmd: "extensions_remove", id: el.dataset.extensionRemove });
        }),
    );
  }
  let resourceTimer,
    resourcesOpenedAt = 0;
  function showTaskManager() {
    showOverlay(
      "resources",
      "Gerenciador de tarefas",
      `<p class="resource-intro">Consumo desta instância do Maré, incluindo motor e apps abertos.</p><div class="resource-totals"><div><small>RAM privada</small><strong id="resource-ram">—</strong></div><div><small>Memória privada</small><strong id="resource-private">—</strong></div><div><small>CPU do computador</small><strong id="resource-cpu">Coletando…</strong></div><div><small>Processos</small><strong id="resource-count">—</strong></div></div><div class="resource-table-scroll"><table class="resource-table"><thead><tr><th>Processo</th><th>PID</th><th>RAM privada</th><th>Residente</th><th>Memória privada</th><th>CPU</th></tr></thead><tbody id="resource-rows"></tbody></table></div><p class="resource-explanation">RAM privada é a memória residente exclusiva. Memória privada inclui memória comprometida que pode estar fora da RAM. A coluna residente inclui páginas compartilhadas; sua soma pode contá-las mais de uma vez. Renderizadores podem atender mais de uma aba.</p><div class="resource-actions"><small id="resource-status" role="status">Lendo processos do Maré…</small><button class="button" id="resource-engine">Detalhes WebView2</button><button class="button" id="resource-refresh">Atualizar</button></div>`,
      "resources-panel",
    );
    resourcesOpenedAt = Date.now();
    const poll = () => send({ cmd: "resources_poll" });
    $("#resource-refresh").onclick = poll;
    $("#resource-engine").onclick = () => send({ cmd: "engine_task_manager" });
    poll();
    resourceTimer = setInterval(() => {
      if (ui.overlay !== "resources") {
        clearInterval(resourceTimer);
        return;
      }
      poll();
    }, 2000);
  }
  function resources(result) {
    if (ui.overlay !== "resources" || result.sampled_at < resourcesOpenedAt)
      return;
    const memory = (value) =>
      value == null
        ? "—"
        : `${(value / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MiB`;
    const cpu = (value) =>
      value == null
        ? "—"
        : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    $("#resource-ram").textContent = memory(
      result.totals.private_working_set_bytes,
    );
    $("#resource-private").textContent = memory(result.totals.private_bytes);
    $("#resource-cpu").textContent = result.cpu_samples
      ? cpu(result.totals.cpu_percent)
      : "Coletando…";
    $("#resource-count").textContent = String(result.process_count);
    let group = "";
    $("#resource-rows").innerHTML = result.processes
      .map((row) => {
        let header = "";
        if (row.group !== group) {
          group = row.group;
          header = `<tr class="resource-group"><th colspan="6">${esc(group)}</th></tr>`;
        }
        return (
          header +
          `<tr data-process-pid="${row.pid}"><td><strong>${esc(row.name)}</strong><small>${esc(row.exe)}</small></td><td>${row.pid}</td><td>${memory(row.private_working_set_bytes)}</td><td>${memory(row.working_set_bytes)}</td><td>${memory(row.private_bytes)}</td><td>${cpu(row.cpu_percent)}</td></tr>`
        );
      })
      .join("");
    $("#resource-status").textContent =
      `Atualizado às ${new Date(result.sampled_at).toLocaleTimeString("pt-BR")} · ${result.sampled_processes}/${result.process_count} processos medidos${result.truncated ? " · Totais parciais: limite atingido" : ""}`;
  }
  function showTabMenu(id, x, y) {
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab) return;
    showPopup(
      menuItem("tab", "Duplicar aba", "duplicate", "", id) +
        menuItem(
          "pin",
          tab.pinned ? "Desafixar aba" : "Fixar aba",
          "pin",
          "",
          id,
        ) +
        separator +
        menuItem("close", "Fechar aba", "close", "Ctrl+W", id) +
        menuItem("tab", "Fechar outras abas", "close-others", "", id) +
        separator +
        menuItem("history", "Reabrir aba fechada", "reopen", "Ctrl+Shift+T"),
      null,
      "tab",
      { x: x + 260, y },
    );
  }
  function showFavoriteMenu(item, x, y) {
    if (!item) return;
    showPopup(
      menuItem("tab", "Abrir em nova aba", "bookmark-new", "", item.id) +
        menuItem("settings", "Editar favorito…", "bookmark-edit", "", item.id) +
        separator +
        menuItem(
          "trash",
          "Remover favorito",
          "bookmark-remove",
          "",
          item.id,
          true,
        ),
      null,
      "favorite",
      { x: x + 260, y },
    );
  }
  function showReadingMenu(item, x, y) {
    showPopup(
      menuItem(
        "check",
        item.read ? "Marcar como não lido" : "Marcar como lido",
        "reading-read",
        "",
        item.id,
      ) +
        menuItem(
          "trash",
          "Remover da lista",
          "reading-remove",
          "",
          item.id,
          true,
        ),
      null,
      "reading",
      { x: x + 260, y },
    );
  }
  function menuAction(action, id) {
    const numericId = Number(id);
    switch (action) {
      case "new":
        newTab();
        break;
      case "private":
        newTab(true);
        break;
      case "copy":
        copyUrl();
        break;
      case "bookmark":
        if (!isStart(active())) {
          send({ cmd: "toggle_bookmark" });
        } else {
          showBookmarkDialog();
        }
        break;
      case "reading":
        if (!isStart(active())) send({ cmd: "add_reading" });
        else notify("Abra uma página para adicioná-la à Lista de Leitura.");
        break;
      case "bookmarks":
        toggleSidebar("bookmarks");
        break;
      case "history":
        toggleSidebar("history");
        break;
      case "downloads":
        showDownloads();
        break;
      case "extensions":
        showExtensions();
        break;
      case "settings":
        showSettings();
        break;
      case "find":
        showFind();
        break;
      case "print":
        send({ cmd: "print" });
        break;
      case "devtools":
        send({ cmd: "devtools" });
        break;
      case "task-manager":
        showTaskManager();
        break;
      case "reader":
        send({ cmd: "reader" });
        break;
      case "zoom":
        showZoom();
        break;
      case "pin":
        send({ cmd: "pin_tab", id: numericId });
        break;
      case "duplicate":
        send({ cmd: "duplicate_tab", id: numericId });
        break;
      case "close":
        send({ cmd: "close_tab", id: numericId });
        break;
      case "close-others":
        send({ cmd: "close_other_tabs", id: numericId });
        break;
      case "close-app":
        closeAppTab(id);
        break;
      case "reopen":
        send({ cmd: "reopen_tab" });
        break;
      case "bookmark-new": {
        const b = state.bookmarks.find((b) => b.id === numericId);
        if (b) newTab(!!active().private, b.url);
        break;
      }
      case "bookmark-edit":
        showBookmarkDialog(state.bookmarks.find((b) => b.id === numericId));
        break;
      case "bookmark-remove":
        send({ cmd: "remove_bookmark", id: numericId });
        break;
      case "reading-read":
        send({ cmd: "mark_read", id: numericId });
        break;
      case "reading-remove":
        send({ cmd: "remove_reading", id: numericId });
        break;
      case "zoom-in":
        setZoom(ui.zoom + 0.1);
        break;
      case "zoom-out":
        setZoom(ui.zoom - 0.1);
        break;
      case "zoom-reset":
        setZoom(1);
        break;
    }
  }
  async function copy(text) {
    const value = String(text || "");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      notify("Endereço copiado.");
      return true;
    } catch {
      const previous = document.activeElement,
        field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("aria-hidden", "true");
      field.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
      document.body.append(field);
      field.focus();
      field.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {}
      field.remove();
      previous?.focus();
      if (copied) {
        notify("Endereço copiado.");
        return true;
      }
      closeTransient();
      $("#address").value = value;
      $("#address").focus();
      $("#address").select();
      notify("Endereço selecionado. Pressione Ctrl+C para copiar.");
      return false;
    }
  }
  function copyUrl() {
    if (isNative) {
      send({ cmd: "copy_url" });
    } else copy(active().url);
  }
  function showDownloads() {
    showPopup("", $("#downloads-button"), "downloads");
    renderDownloads();
    updateLayout();
  }
  function renderDownloads() {
    const target = $("#popup");
    target.innerHTML = `<div class="popup-heading">Downloads<small>${state.downloads.length || ""}</small></div>${
      state.downloads.length
        ? state.downloads
            .slice()
            .reverse()
            .slice(0, 20)
            .map(
              (item) =>
                `<div class="download-entry"><span>${icon("download")}</span><div><span class="item-title" title="${esc(item.path || item.filename)}">${esc(item.filename.replace(/^\d{13}-\d+-\d+-/, ""))}</span><span class="item-subtitle">${esc(item.error || downloadStatus(item.status))}${item.total ? ` · ${Math.floor((item.received / item.total) * 100)}%` : ""}${item.received ? ` · ${(item.received / 1048576).toFixed(1)} MB` : ""}</span></div>${item.status === "downloading" ? `<button data-transfer="cancel_download" data-transfer-id="${item.id}" aria-label="Cancelar download">${icon("close")}</button>` : ""}${item.resumable ? `<button data-transfer="resume_download" data-transfer-id="${item.id}" aria-label="Retomar download">${icon("reload")}</button>` : ""}${item.status === "completed" || item.status === "concluído" ? `<button data-open-download="${item.id}" title="Abrir arquivo" aria-label="Abrir ${esc(item.filename)}">${icon("external")}</button><button data-reveal-download="${item.id}" title="Mostrar na pasta" aria-label="Mostrar na pasta">${icon("folder")}</button>` : ""}</div>`,
            )
            .join("")
        : `<div class="download-empty">${icon("download")}Seus downloads aparecem aqui.<br>Baixe um arquivo para começar.</div>`
    }`;
    $$("[data-transfer]", target).forEach(
      (el) =>
        (el.onclick = () =>
          send({
            cmd: el.dataset.transfer,
            id: Number(el.dataset.transferId),
          })),
    );
    $$("[data-open-download]", target).forEach((el) =>
      el.addEventListener("click", () =>
        send({ cmd: "open_download", id: Number(el.dataset.openDownload) }),
      ),
    );
    $$("[data-reveal-download]", target).forEach((el) =>
      el.addEventListener("click", () =>
        send({ cmd: "reveal_download", id: Number(el.dataset.revealDownload) }),
      ),
    );
  }
  function downloadStatus(status) {
    return (
      {
        choosing: "Escolha onde salvar…",
        missing: "Arquivo não encontrado",
        completed: "Concluído",
        downloading: "Baixando…",
        failed: "Falha no download",
        cancelled: "Cancelado",
        started: "Baixando…",
      }[status] || status
    );
  }
  function showOverlay(kind, title, body, cls = "") {
    const previous = document.activeElement;
    closeTransient(true);
    ui.returnFocus = previous;
    ui.overlay = kind;
    $("#overlay-panel").className = cls;
    $("#overlay-panel").innerHTML =
      `<div class="dialog-heading"><h2 id="overlay-title">${esc(title)}</h2><button class="icon-button" data-dialog-close aria-label="Fechar">${icon("close")}</button></div>${body}`;
    $("#overlay").hidden = false;
    $("[data-dialog-close]")?.addEventListener("click", closeTransient);
    updateLayout();
    animate(
      $("#overlay-panel"),
      [
        { opacity: 0, transform: "translateY(9px) scale(.985)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      motion.panel,
    );
    requestAnimationFrame(() => {
      $(
        "#overlay-panel input,#overlay-panel select,#overlay-panel button",
      )?.focus();
    });
  }
  function appIcon(app) {
    return ["notes", "calculator", "spotify", "discord"].includes(app.id)
      ? app.id
      : app.icon || "apps";
  }
  function storeRows() {
    const catalog = state.apps?.catalog || [];
    return catalog.length
      ? catalog
          .map((app) => {
            const available =
              app.status !== "planned" && app.installable !== false;
            const stopping = (state.apps?.stopping || []).some(
              (process) => process.id === app.id,
            );
            return `<article class="store-app" data-app-row="${esc(app.id)}"><div class="store-app-icon app-icon-${esc(app.id)}">${icon(appIcon(app))}</div><div class="store-app-info"><h3>${esc(app.name)}</h3><p>${esc(app.description)}</p><span>${available ? (app.kind === "web" ? "Aplicativo web oficial" : app.kind === "external-native" ? "Cliente nativo Zig/SDL" : "Aplicativo nativo Rust") : "Em desenvolvimento"}${app.version ? ` · ${esc(app.version)}` : ""}</span></div><div class="store-app-actions">${available ? `<button class="button${app.installed ? "" : " primary"}" data-app-action="${app.installed ? "open" : "install"}" data-app-id="${esc(app.id)}" ${stopping ? "disabled" : ""}>${stopping ? "Encerrando…" : app.running ? "Em execução" : app.installed ? "Abrir" : "Instalar"}</button>${app.installed && !app.running && !stopping ? `<button class="store-remove" data-app-action="uninstall" data-app-id="${esc(app.id)}" aria-label="Remover ${esc(app.name)}" title="Remover aplicativo">${icon("trash")}</button>` : ""}` : `<span class="planned-label">${app.status === "component_missing" ? "Não incluído" : "Planejado"}</span>`}</div></article>`;
          })
          .join("")
      : '<div class="store-empty">O catálogo de aplicativos ainda não está disponível.</div>';
  }
  function showStore() {
    showOverlay(
      "store",
      "Loja do Maré",
      `<p class="store-intro">Aplicativos nativos em abas. Alterne entre eles e a navegação sem encerrar seus aplicativos.</p><div class="store-catalog" id="store-catalog">${storeRows()}</div><div class="store-footer"><span id="store-running"></span><span>Instalação local</span></div>`,
      "store-panel",
    );
    bindStore();
    rendered.delete("store");
    renderApps();
  }
  function bindStore() {
    $$("[data-app-action]", $("#overlay-panel")).forEach(
      (button) =>
        (button.onclick = async () => {
          const id = button.dataset.appId,
            action = button.dataset.appAction;
          if (action === "open") {
            closeTransient();
            await openApp(id);
            return;
          }
          if (action === "uninstall") {
            send({ cmd: "apps_uninstall", id });
            return;
          }
          button.disabled = true;
          button.textContent = "Instalando…";
          send({ cmd: "apps_install", id });
        }),
    );
  }
  async function openApp(id) {
    try {
      await flushNote();
      send({ cmd: "apps_open", id });
    } catch {
      notify("Salve a nota atual antes de abrir outro aplicativo.");
    }
  }
  let appLaunch = null;
  function finishAppLaunch(id) {
    if (appLaunch?.id !== id) return;
    appLaunch.ready = true;
    const current = appLaunch;
    setTimeout(
      () => {
        if (appLaunch !== current) return;
        document.querySelector(".native-app-launch")?.remove();
        appLaunch = null;
        updateLayout();
      },
      Math.max(0, 380 - (performance.now() - current.start)),
    );
  }
  function renderApps() {
    const apps = state.apps || {},
      activeId = apps.active_id || null,
      workspace = $("#app-workspace");
    const openIds = new Set(openAppTabs().map((app) => app.id));
    $("#apps-button").classList.toggle("apps-running", openIds.size > 0);
    $("#apps-button").setAttribute(
      "aria-pressed",
      String(ui.overlay === "store"),
    );
    if (ui.overlay === "store") {
      cached("store", [apps.catalog || [], apps.stopping || []], () => {
        $("#store-catalog").innerHTML = storeRows();
        bindStore();
      });
      const count = Number(apps.process_count ?? apps.running?.length ?? 0);
      $("#store-running").textContent =
        `${count} ${count === 1 ? "aplicativo ativo" : "aplicativos ativos"}`;
    }
    for (const [id] of appViews) {
      if (openIds.has(id)) continue;
      appViews.delete(id);
      appInstances.delete(id);
      if (ui.appId === id) {
        $("#native-app-body")?.replaceChildren();
        ui.appId = null;
      }
      if (id === "notes") {
        clearTimeout(noteSaveTimer);
        appData.notes = [];
        appData.selected_id = null;
        appData.noteOpenedId = null;
        appData.draft = null;
        appData.dirty = false;
        rendered.delete("notes-list");
      }
      if (id === "calculator") appData.calculator = null;
      if (id === "spotify") {
        spotifyView?.dispose();
        spotifyView = null;
      }
    }
    workspace.hidden = !activeId;
    if (!activeId) {
      document.querySelector(".native-app-launch")?.remove();
      appLaunch = null;
      return;
    }
    $("#startpage").hidden = true;
    $("#remote-placeholder").hidden = true;
    const app = openAppTabs().find((item) => item.id === activeId) ||
      (apps.catalog || []).find((item) => item.id === activeId) || {
        id: activeId,
        name: "Aplicativo",
      };
    document.title = `${app.name} — Maré`;
    if (!ui.workspaceBuilt) {
      workspace.innerHTML = `<header class="native-app-header"><button class="button app-back" id="app-back">${icon("back")}Voltar à navegação</button><div class="native-app-name"><span id="app-title-icon"></span><h1 id="app-title"></h1></div><button class="icon-button" id="app-store" title="Loja do Maré" aria-label="Loja do Maré">${icon("apps")}</button></header><div class="native-app-body" id="native-app-body"></div><footer class="native-app-footer"><span id="app-status"></span><span>Aplicativo Rust</span></footer>`;
      $("#app-back").onclick = () => leaveApp();
      $("#app-store").onclick = showStore;
      ui.workspaceBuilt = true;
    }
    $("#app-title").textContent = app.name;
    $(".native-app-footer span:last-child").textContent =
      activeId === "discord" ? "Cliente Zig/SDL" : "Aplicativo Rust";
    $("#app-title-icon").innerHTML = icon(appIcon(app));
    if (ui.appId !== activeId) {
      if (
        ui.appId &&
        openIds.has(ui.appId) &&
        $("#native-app-body").firstElementChild
      )
        appViews.set(ui.appId, $("#native-app-body").firstElementChild);
      ui.appId = activeId;
      const cachedView = appViews.get(activeId);
      if (cachedView) $("#native-app-body").replaceChildren(cachedView);
      else {
        $("#native-app-body").replaceChildren();
        if (activeId === "notes") {
          appData.noteOpenedId = null;
          rendered.delete("notes-list");
          buildNotes();
        } else if (activeId === "calculator") buildCalculator();
        else if (activeId === "spotify") buildSpotify();
        else if (activeId === "discord")
          $("#native-app-body").innerHTML =
            '<div class="larper-loading"><span>Preparando larperCord…</span><small>Cliente nativo em uma aba do Maré.</small></div>';
        else
          $("#native-app-body").innerHTML =
            '<div class="app-unavailable">Este aplicativo não tem uma interface disponível nesta versão.</div>';
        if ($("#native-app-body").firstElementChild)
          appViews.set(activeId, $("#native-app-body").firstElementChild);
      }
      animate(workspace, [{ opacity: 0 }, { opacity: 1 }], 130);
      document.querySelector(".native-app-launch")?.remove();
      if (["spotify", "discord"].includes(activeId)) {
        appLaunch = { id: activeId, start: performance.now() };
        workspace.insertAdjacentHTML(
          "beforeend",
          `<div class="native-app-launch" role="status"><span class="app-icon-${esc(activeId)}">${icon(appIcon(app))}</span><strong>${esc(app.name)}</strong><small>Abrindo…</small></div>`,
        );
        updateLayout();
        if (cachedView && activeId !== "discord") finishAppLaunch(activeId);
      }
    }
    if (activeId === "notes") {
      renderNotes();
      $("#app-status").textContent = appData.dirty
        ? "Alterações não salvas"
        : "Salvo neste computador";
    }
    if (activeId === "calculator") {
      if (appData.calculator) renderCalculator(appData.calculator);
      else $("#app-status").textContent = "Pronto";
    }
    if (activeId === "spotify")
      $("#app-status").textContent =
        "Biblioteca e áudio locais · Downloads sob demanda";
    for (const event of Object.values(apps.responses || {}))
      if (event?.kind) appsEvent(event);
    if (apps.last_response?.kind) appsEvent(apps.last_response);
  }
  function requestApp(method, params = {}, appId = state.apps?.active_id) {
    const id = appId;
    if (!id) return Promise.reject(new Error("O aplicativo não está aberto."));
    const requestId = ++requestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          appRequests.delete(requestId);
          reject(new Error("O aplicativo demorou para responder."));
        },
        id === "spotify" && method === "import_link" ? 15000 : 8000,
      );
      appRequests.set(requestId, { resolve, reject, timer });
      send({ cmd: "apps_request", id, method, params, request_id: requestId });
    });
  }
  const pendingPermissions=[];
  let activePermission=null;
  function permissionRequest(value) {
    pendingPermissions.push(value);
    if (!activePermission) showNextPermission();
  }
  function showNextPermission() {
    activePermission=pendingPermissions.shift();
    if (!activePermission) return;
    const p=activePermission;
    showOverlay("permission","Permitir acesso ao "+p.permission+"?",'<p><strong>'+esc(p.origin)+'</strong> está solicitando acesso ao '+esc(p.permission)+'.</p><label class="permission-remember"><input type="checkbox" id="permission-remember"> Lembrar para este site</label><div class="dialog-actions"><button class="button" data-permission-deny>Bloquear</button><button class="button primary" data-permission-allow>Permitir</button></div>');
    const answer=allow=>{send({cmd:"permission_answer",id:p.id,allow,remember:!!$("#permission-remember")?.checked});activePermission=null;closeTransient();showNextPermission();};
    $("[data-permission-allow]").onclick=()=>answer(true);
    $("[data-permission-deny]").onclick=()=>answer(false);
    $("[data-dialog-close]").onclick=()=>answer(false);
  }
  function appsRequestFailed(id, message) {
    const pending = appRequests.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    appRequests.delete(id);
    pending.reject(new Error(message));
  }
  function appsEvent(event) {
    if (!event || !event.app_id) return;
    const knownInstance = appInstances.get(event.app_id);
    if (knownInstance != null && event.instance_id < knownInstance) return;
    if (event.instance_id != null)
      appInstances.set(event.app_id, event.instance_id);
    const payload = event.payload || {},
      key = `${event.app_id}:${event.instance_id}:${event.kind}:${payload.id}:${payload.method}`;
    if (appEventsSeen.has(key)) return;
    appEventsSeen.add(key);
    if (appEventsSeen.size > 300)
      appEventsSeen.delete(appEventsSeen.values().next().value);
    if (event.kind === "exited") {
      if (state.apps?.active_id === event.app_id && $("#app-status"))
        $("#app-status").textContent = "Aplicativo encerrado";
      return;
    }
    if (event.kind !== "response") return;
    const pending = appRequests.get(payload.id);
    if (pending) {
      clearTimeout(pending.timer);
      appRequests.delete(payload.id);
    }
    if (payload.error) {
      finishAppLaunch(event.app_id);
      const message =
        typeof payload.error === "string"
          ? payload.error
          : payload.error.message || "O aplicativo não concluiu a operação.";
      pending?.reject(new Error(message));
      if (state.apps?.active_id === event.app_id) {
        notify(message);
        if ($("#app-status"))
          $("#app-status").textContent = "Não foi possível concluir a operação";
      }
      return;
    }
    const result = payload.result || {};
    if (
      event.app_id === "spotify" &&
      (result.player || payload.method === "hello")
    )
      finishAppLaunch("spotify");
    if (event.app_id === "discord" && result.attached)
      finishAppLaunch("discord");
    if (event.app_id === "notes" && Array.isArray(result.notes)) {
      appData.notes = result.notes;
      if (
        result.selected_id != null &&
        (payload.method !== "list" || appData.selected_id == null)
      )
        appData.selected_id = result.selected_id;
      if (!appData.notes.some((note) => note.id === appData.selected_id))
        appData.selected_id = appData.notes[0]?.id ?? null;
      if (state.apps?.active_id === "notes") {
        renderNotes();
        if (!appData.dirty && $("#app-status"))
          $("#app-status").textContent = "Salvo neste computador";
      }
    }
    if (
      event.app_id === "spotify" &&
      (Array.isArray(result.entries) || result.player)
    )
      spotifyView?.update(result);
    if (event.app_id === "discord" && state.apps?.active_id === "discord") {
      $("#app-status").textContent = result.attached
        ? `${result.engine} · PID ${result.external_pid}`
        : "Preparando cliente nativo…";
      if (result.attached) $(".larper-loading")?.remove();
    }
    if (event.app_id === "calculator" && payload.method === "calculate") {
      appData.calculator = result;
      if (state.apps?.active_id === "calculator") renderCalculator(result);
    }
    if (
      state.apps?.active_id === event.app_id &&
      payload.method === "hello" &&
      $("#app-status")
    )
      $("#app-status").textContent = "Pronto";
    pending?.resolve(result);
  }
  let spotifyView;
  function buildSpotify() {
    spotifyView = window.createSpotifyView({
      request: (method, params) => requestApp(method, params, "spotify"),
      send,
      notify,
      icon,
      isOpen: () => openAppTabs().some((app) => app.id === "spotify"),
    });
    $("#native-app-body").replaceChildren(spotifyView.element);
    spotifyView.load();
  }
  function buildNotes() {
    $("#native-app-body").innerHTML =
      `<div class="notes-layout"><aside class="notes-sidebar"><div class="notes-heading"><h2>Notas</h2><button class="icon-button" id="note-new" title="Nova nota" aria-label="Nova nota">${icon("plus")}</button></div><div id="notes-list" class="notes-list"></div></aside><section class="note-editor" id="note-editor"><div class="note-editor-toolbar"><span id="note-date"></span><button class="button" id="note-save" disabled>Salvar</button><button class="icon-button" id="note-delete" title="Excluir nota" aria-label="Excluir nota">${icon("trash")}</button></div><input id="note-title" aria-label="Título da nota" placeholder="Sem título" maxlength="160"><textarea id="note-body" aria-label="Texto da nota" placeholder="Escreva sua nota…" maxlength="30000"></textarea></section><div id="notes-empty" class="notes-empty" hidden><span>${icon("notes")}</span><h2>Nenhuma nota</h2><p>Crie uma nota para começar.</p><button class="button primary" id="note-first">Criar nota</button></div></div>`;
    $("#note-new").onclick = createNote;
    $("#note-first").onclick = createNote;
    $("#note-title").oninput = markNoteDirty;
    $("#note-body").oninput = markNoteDirty;
    $("#note-save").onclick = () =>
      flushNote().catch((error) => notify(error.message));
    $("#note-delete").onclick = () => {
      const id = appData.selected_id;
      if (id == null) return;
      showOverlay(
        "confirm",
        "Excluir nota?",
        `<p class="dialog-intro">Esta nota será removida deste computador.</p><div class="dialog-actions"><button class="button" id="note-delete-cancel">Cancelar</button><button class="button danger" id="note-delete-confirm">Excluir nota</button></div>`,
      );
      $("#note-delete-cancel").onclick = closeTransient;
      $("#note-delete-confirm").onclick = () => {
        clearTimeout(noteSaveTimer);
        appData.dirty = false;
        requestApp("delete", { id }).catch((error) => notify(error.message));
        closeTransient();
      };
    };
    requestApp("list").catch((error) => notify(error.message));
  }
  function renderNotes() {
    if (!$("#notes-list")) return;
    cached("notes-list", [appData.notes, appData.selected_id], () => {
      $("#notes-list").innerHTML = appData.notes
        .map(
          (note) =>
            `<button class="note-item${note.id === appData.selected_id ? " selected" : ""}" data-note-id="${note.id}" aria-pressed="${note.id === appData.selected_id}"><strong>${esc(note.title || "Sem título")}</strong><span>${esc((note.body || "").trim().split("\n")[0] || "Nota vazia")}</span><small>${esc(formatDate(note.updated_at))}</small></button>`,
        )
        .join("");
      $$("[data-note-id]").forEach(
        (button) =>
          (button.onclick = async () => {
            try {
              await flushNote();
              appData.selected_id = Number(button.dataset.noteId);
              renderNotes();
            } catch (error) {
              notify(error.message);
            }
          }),
      );
    });
    const note = appData.notes.find((item) => item.id === appData.selected_id);
    $("#note-editor").hidden = !note;
    $("#notes-empty").hidden = !!note;
    if (note && appData.noteOpenedId !== note.id) {
      appData.noteOpenedId = note.id;
      $("#note-title").value = note.title || "";
      $("#note-body").value = note.body || "";
      $("#note-date").textContent = formatDate(note.updated_at);
      appData.dirty = false;
      appData.draft = {
        id: note.id,
        title: note.title || "",
        body: note.body || "",
      };
      $("#note-save").disabled = true;
    }
    if (!note) appData.noteOpenedId = null;
  }
  async function createNote() {
    try {
      await flushNote();
      await requestApp("create", { title: "Sem título", body: "" });
      $("#note-title")?.focus();
      $("#note-title")?.select();
    } catch (error) {
      notify(error.message);
    }
  }
  function markNoteDirty() {
    appData.dirty = true;
    appData.draft = {
      id: appData.selected_id,
      title: $("#note-title").value,
      body: $("#note-body").value,
    };
    noteRevision++;
    $("#note-save").disabled = false;
    $("#app-status").textContent = "Alterações não salvas";
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(
      () => flushNote().catch((error) => notify(error.message)),
      600,
    );
  }
  async function flushNote() {
    clearTimeout(noteSaveTimer);
    if (!appData.dirty || !appData.draft || appData.draft.id == null) return;
    const revision = noteRevision,
      draft = { ...appData.draft };
    if (state.apps?.active_id === "notes" && $("#app-status"))
      $("#app-status").textContent = "Salvando…";
    await requestApp("update", draft, "notes");
    if (revision === noteRevision) {
      appData.dirty = false;
      const noteRoot = appViews.get("notes") || document;
      if ($("#note-save", noteRoot)) $("#note-save", noteRoot).disabled = true;
      if (state.apps?.active_id === "notes" && $("#app-status"))
        $("#app-status").textContent = "Salvo neste computador";
    }
  }
  function buildCalculator() {
    const keys = [
      "(",
      ")",
      "⌫",
      "C",
      "7",
      "8",
      "9",
      "/",
      "4",
      "5",
      "6",
      "*",
      "1",
      "2",
      "3",
      "-",
      "0",
      ".",
      "=",
      "+",
    ];
    $("#native-app-body").innerHTML =
      `<div class="calculator-layout"><div class="calculator-surface"><div class="calc-caption">Calculadora</div><form id="calculator-form"><label class="sr-only" for="calc-expression">Expressão matemática</label><input id="calc-expression" autocomplete="off" spellcheck="false" placeholder="0" maxlength="256"><output id="calc-result" aria-live="polite">0</output><div class="calc-keypad">${keys.map((key) => `<button type="button" data-calc-key="${esc(key)}" class="calc-key${["/", "*", "-", "+"].includes(key) ? " operator" : ""}${key === "=" ? " equals" : ""}" aria-label="${esc({ "*": "Multiplicar", "/": "Dividir", "-": "Subtrair", "+": "Somar", "⌫": "Apagar último caractere", C: "Limpar", "=": "Calcular" }[key] || key)}">${esc({ "*": "×", "/": "÷" }[key] || key)}</button>`).join("")}</div></form><p>Parênteses e operações básicas.</p></div></div>`;
    $("#app-status").textContent = "Pronto";
    const calculate = () => {
      const expression = $("#calc-expression").value.trim();
      if (!expression) return;
      requestApp("calculate", { expression }).catch((error) => {
        notify(error.message);
        $("#app-status").textContent = error.message;
      });
    };
    $("#calculator-form").onsubmit = (event) => {
      event.preventDefault();
      calculate();
    };
    $$("[data-calc-key]").forEach(
      (button) =>
        (button.onclick = () => {
          const key = button.dataset.calcKey,
            field = $("#calc-expression");
          if (key === "=") {
            calculate();
            return;
          }
          if (key === "C") {
            field.value = "";
            $("#calc-result").textContent = "0";
            return;
          }
          if (key === "⌫") field.value = field.value.slice(0, -1);
          else field.value += key;
          field.focus();
          field.setSelectionRange(field.value.length, field.value.length);
        }),
    );
  }
  function renderCalculator(result) {
    if (!$("#calc-result")) return;
    const text = String(result.display ?? result.value ?? "0");
    if ($("#calc-result").textContent !== text) {
      $("#calc-result").textContent = text;
      animate($("#calc-result"), [{ opacity: 0.4 }, { opacity: 1 }], 120);
    }
    $("#app-status").textContent = "Calculado no aplicativo Rust";
  }
  const searchEngines = [
    ["duckduckgo", "DuckDuckGo"],
    ["google", "Google"],
    ["bing", "Bing"],
  ];
  function selectMarkup(id, labelId, value, options) {
    const label =
      options.find((item) => item[0] === value)?.[1] || options[0][1];
    return `<div class="select-control" data-select="${id}"><button type="button" id="${id}" class="select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-options" aria-labelledby="${labelId} ${id}-value"><span id="${id}-value">${esc(label)}</span>${icon("down")}</button><div class="select-options" id="${id}-options" role="listbox" aria-labelledby="${labelId}" hidden>${options.map(([key, text]) => `<button type="button" role="option" data-value="${key}" tabindex="-1" aria-selected="${key === value}"><span>${esc(text)}</span>${icon("check")}</button>`).join("")}</div></div>`;
  }
  function closeSelect(focus = false) {
    $$(".select-control.open").forEach((control) => {
      control.classList.remove("open");
      $(".select-options", control).hidden = true;
      const trigger = $(".select-trigger", control);
      trigger.setAttribute("aria-expanded", "false");
      if (focus) trigger.focus();
    });
  }
  function bindSelect(id, onChange) {
    const trigger = $(`#${id}`),
      control = trigger.closest(".select-control"),
      list = $(".select-options", control),
      options = $$('[role="option"]', list);
    const open = () => {
      closeSelect();
      control.classList.add("open");
      list.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      animate(
        list,
        [
          { opacity: 0, transform: "translateY(-3px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        110,
      );
      (
        options.find(
          (option) => option.getAttribute("aria-selected") === "true",
        ) || options[0]
      ).focus();
    };
    const choose = (option) => {
      options.forEach((item) =>
        item.setAttribute("aria-selected", String(item === option)),
      );
      $(`#${id}-value`).textContent = option.textContent.trim();
      closeSelect(true);
      onChange(option.dataset.value);
    };
    trigger.onclick = () =>
      control.classList.contains("open") ? closeSelect() : open();
    trigger.onkeydown = (event) => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        open();
        if (event.key === "End") options.at(-1).focus();
        if (event.key === "Home") options[0].focus();
      }
    };
    options.forEach((option, index) => {
      option.onclick = () => choose(option);
      option.onkeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeSelect(true);
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          options[
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? options.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    options.length) %
                  options.length
          ].focus();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose(option);
        } else if (event.key === "Tab") closeSelect();
        else if (event.key.length === 1) {
          const match = options.find((item) =>
            item.textContent
              .trim()
              .toLocaleLowerCase()
              .startsWith(event.key.toLocaleLowerCase()),
          );
          match?.focus();
        }
      };
    });
  }
  function showShield() {
    showPopup(
      `<div class="shield-panel"><div class="shield-heading">${icon("shield")}<div><strong>Proteção do Maré</strong><span id="shield-status"></span></div></div><div class="shield-count"><strong id="shield-count">—</strong><span>requisições bloqueadas nesta página</span></div><div class="protection-toggle"><label for="shield-site"><strong id="shield-host">Esta página</strong><small>Bloqueio neste site</small></label><label class="switch"><input id="shield-site" type="checkbox"><span></span></label></div><div class="protection-toggle"><label for="shield-global">Proteção de anúncios e rastreadores</label><label class="switch"><input id="shield-global" type="checkbox"><span></span></label></div><p class="shield-details" id="shield-details"></p></div>`,
      $("#shield-button"),
      "shield",
    );
    $("#shield-global").onchange = (event) =>
      send({ cmd: "shield_toggle", enabled: event.target.checked });
    $("#shield-site").onchange = (event) =>
      send({ cmd: "shield_site_toggle", enabled: event.target.checked });
    renderProtection();
  }
  function renderProtection() {
    const protection = state.protection;
    const appSelected = !!state.apps?.active_id;
    $("#shield-button").disabled = appSelected;
    if (appSelected && ui.popup === "shield") closeTransient(true);
    const enabled = !!protection?.enabled,
      siteEnabled = enabled && !!protection?.site_enabled;
    $("#shield-button").classList.toggle("protection-active", siteEnabled);
    $("#shield-button").setAttribute(
      "aria-pressed",
      String(ui.popup === "shield"),
    );
    $("#shield-button").title = appSelected
      ? "Proteção das páginas — disponível nas abas da web"
      : protection?.host
        ? `Proteção ${siteEnabled ? "ativada" : "desativada"} em ${protection.host}`
        : "Proteção do Maré";
    if ($("#settings-shield")) $("#settings-shield").checked = enabled;
    if (ui.popup !== "shield") return;
    $("#shield-status").textContent =
      !protection || protection.status === "unavailable"
        ? "Indisponível"
        : !enabled
          ? "Desativada"
          : protection.host
            ? siteEnabled
              ? "Ativada neste site"
              : "Desativada neste site"
            : "Ativada";
    $("#shield-count").textContent = protection
      ? Number(protection.blocked || 0).toLocaleString("pt-BR")
      : "—";
    $("#shield-host").textContent =
      protection?.host || "Abra um site para configurar";
    $("#shield-global").checked = enabled;
    $("#shield-global").disabled =
      !protection || protection.status === "unavailable";
    $("#shield-site").checked = siteEnabled;
    $("#shield-site").disabled =
      !protection?.host || !enabled || protection.status === "unavailable";
    $("#shield-details").textContent = protection
      ? `${protection.engine || "Bloqueio de conteúdo"}${protection.lists?.length ? ` · ${protection.lists.join(" e ")}` : ""}. ${Number(protection.rules_count || 0).toLocaleString("pt-BR")} regras carregadas.`
      : "O estado da proteção ainda não foi recebido.";
  }
  function showSettings() {
    const s = state.settings;
    const wallpapers = [
      ["aurora", "Aurora"],
      ["ocean", "Oceano"],
      ["dusk", "Entardecer"],
      ["minimal", "Discreto"],
    ];
    showOverlay(
      "settings",
      "Ajustes do Maré",
      `<section class="settings-section"><h3>Aparência</h3><div class="theme-picker">${[
        ["system", "Automática"],
        ["light", "Clara"],
        ["dark", "Escura"],
      ]
        .map(
          ([value, label]) =>
            `<button class="theme-choice" data-theme-choice="${value}" aria-pressed="${s.theme === value}">${label}</button>`,
        )
        .join(
          "",
        )}</div></section><section class="settings-section"><h3>Navegação</h3><div class="setting-row"><span class="setting-label" id="search-engine-label">Mecanismo de pesquisa</span>${selectMarkup("search-engine", "search-engine-label", s.search_engine, searchEngines)}</div><div class="setting-row"><label for="restore-session">Continuar de onde parei<small>Reabrir as abas comuns ao iniciar o Maré.</small></label><label class="switch"><input id="restore-session" type="checkbox" ${s.restore_session ? "checked" : ""}><span></span></label></div></section><section class="settings-section"><h3>Página inicial</h3><div class="wallpaper-picker">${wallpapers.map(([value, label]) => `<button class="wallpaper-choice wallpaper ${value}" data-wallpaper="${value}" aria-pressed="${s.home_background === value}"><span class="landscape" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${label}</button>`).join("")}</div></section><section class="settings-section"><h3>Proteção</h3><div class="setting-row"><label for="settings-shield">Bloquear anúncios e rastreadores<small>Use o botão de proteção para configurar cada site.</small></label><label class="switch"><input id="settings-shield" type="checkbox" ${(state.protection?.enabled ?? s.shield_enabled) !== false ? "checked" : ""}><span></span></label></div></section><section class="settings-section"><h3>Dados de navegação</h3><div class="setting-row"><div class="setting-label">Histórico<small>${state.history.length} ${state.history.length === 1 ? "página registrada" : "páginas registradas"}</small></div><button class="button" id="clear-history">Limpar histórico…</button></div><div class="setting-row"><div class="setting-label">Cookies e dados dos sites<small>Limpar pode encerrar sessões nos sites.</small></div><button class="button danger" id="clear-data">Limpar dados…</button></div></section><p class="about-footer">Maré ${esc(state.version)} · Código aberto</p>`,
    );
    bindSelect("search-engine", (value) =>
      changeSettings({ search_engine: value }),
    );
    $$("[data-theme-choice]").forEach((el) =>
      el.addEventListener("click", () => {
        changeSettings({ theme: el.dataset.themeChoice });
        $$("[data-theme-choice]").forEach((button) =>
          button.setAttribute("aria-pressed", String(button === el)),
        );
      }),
    );
    $$("[data-wallpaper]").forEach((el) =>
      el.addEventListener("click", () => {
        changeSettings({ home_background: el.dataset.wallpaper });
        $$("[data-wallpaper]").forEach((button) =>
          button.setAttribute("aria-pressed", String(button === el)),
        );
      }),
    );
    $("#settings-shield").onchange = (event) =>
      send({ cmd: "shield_toggle", enabled: event.target.checked });
    $("#restore-session").addEventListener("change", (e) =>
      changeSettings({ restore_session: e.target.checked }),
    );
    $("#clear-history").addEventListener("click", confirmHistory);
    $("#clear-data").addEventListener("click", confirmData);
  }
  function changeSettings(values) {
    state.settings = { ...state.settings, ...values };
    applyTheme();
    send({ cmd: "settings", settings: state.settings });
  }
  function showBookmarkDialog(item) {
    const current = active();
    ui.editing = item?.id ?? null;
    showOverlay(
      "bookmark",
      item ? "Editar favorito" : "Adicionar favorito",
      `<form id="bookmark-form"><div class="dialog-field"><label for="bookmark-title">Nome</label><input id="bookmark-title" value="${esc(item?.title || (!isStart(current) ? current.title : ""))}" placeholder="Nome do site" required maxlength="160"></div><div class="dialog-field"><label for="bookmark-url">Endereço</label><input id="bookmark-url" value="${esc(item?.url || (!isStart(current) ? current.url : ""))}" placeholder="https://exemplo.com" required spellcheck="false" autocomplete="url"></div><div class="field-error" id="bookmark-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" id="bookmark-cancel">Cancelar</button><button type="submit" class="button primary">${item ? "Salvar" : "Adicionar"}</button></div></form>`,
    );
    $("#bookmark-cancel").addEventListener("click", closeTransient);
    $("#bookmark-form").addEventListener("submit", (e) => {
      e.preventDefault();
      let url = $("#bookmark-url").value.trim();
      if (!/^\w+:/.test(url)) url = `https://${url}`;
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname)
          throw new Error();
        url = parsed.href;
      } catch {
        $("#bookmark-error").textContent =
          "Digite um endereço válido que comece com http:// ou https://.";
        $("#bookmark-url").focus();
        return;
      }
      const title = $("#bookmark-title").value.trim() || hostname(url);
      if (item) send({ cmd: "remove_bookmark", id: item.id });
      send({ cmd: "add_bookmark", url, title });
      closeTransient();
      notify(item ? "Favorito atualizado." : "Favorito adicionado.");
    });
  }
  function confirmHistory() {
    showOverlay(
      "confirm",
      "Limpar histórico?",
      `<p class="dialog-intro">Os endereços das páginas visitadas serão removidos do Maré. Seus favoritos e sua Lista de Leitura serão mantidos.</p><div class="dialog-actions"><button class="button" id="confirm-cancel">Cancelar</button><button class="button primary" id="confirm-clear">Limpar histórico</button></div>`,
    );
    $("#confirm-cancel").onclick = closeTransient;
    $("#confirm-clear").onclick = () => {
      send({ cmd: "clear_history" });
      closeTransient();
      notify("Histórico limpo.");
    };
  }
  function confirmData() {
    showOverlay(
      "confirm",
      "Limpar dados dos sites?",
      `<p class="dialog-intro">Isso remove cookies, cache e armazenamento dos sites deste perfil. Você poderá precisar entrar nas suas contas novamente.</p><div class="dialog-actions"><button class="button" id="confirm-cancel">Cancelar</button><button class="button primary" id="confirm-clear">Limpar dados</button></div>`,
    );
    $("#confirm-cancel").onclick = closeTransient;
    $("#confirm-clear").onclick = () => {
      send({ cmd: "clear_data" });
      closeTransient();
    };
  }
  function showOverview() {
    const count = combinedTabs().length;
    showOverlay(
      "overview",
      `${count} ${count === 1 ? "aba aberta" : "abas abertas"}`,
      "",
      "overview-panel",
    );
    renderOverview();
  }
  function renderOverview() {
    const tabs = combinedTabs();
    $("#overlay-panel").innerHTML =
      `<div class="dialog-heading"><h2 id="overlay-title">${tabs.length} ${tabs.length === 1 ? "aba aberta" : "abas abertas"}</h2><button class="button" id="overview-new">Nova aba</button><button class="icon-button" data-dialog-close aria-label="Fechar visão geral">${icon("close")}</button></div><div class="overview-grid">${tabs
        .map((tab) => {
          const app = tab.kind === "app",
            selected = app
              ? state.apps?.active_id === tab.id
              : !state.apps?.active_id && tab.id === state.active_id;
          const title = app ? tab.name : tab.title || hostname(tab.url);
          const image = app
            ? icon(appIcon(tab))
            : isStart(tab)
              ? `<span class="landscape" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${icon(tab.private ? "private" : "compass")}`
              : icon(tab.private ? "private" : "globe");
          return `<div class="overview-card${selected ? " active" : ""}"><button class="overview-close" ${app ? "data-overview-close-app" : "data-overview-close"}="${esc(tab.id)}" aria-label="Fechar ${esc(title)}">${icon("close")}</button><button ${app ? "data-overview-app" : "data-overview-tab"}="${esc(tab.id)}" style="width:100%;padding:0;text-align:left;color:inherit"><span class="overview-preview">${image}</span><span class="overview-title">${esc(title)}</span><span class="overview-domain">${app ? "Aplicativo Rust" : esc(hostname(tab.url))}${tab.private ? " · Privada" : ""}</span></button></div>`;
        })
        .join("")}</div>`;
    $("[data-dialog-close]").onclick = closeTransient;
    $("#overview-new").onclick = () => newTab();
    $$("[data-overview-tab]").forEach(
      (button) =>
        (button.onclick = () => {
          closeTransient();
          send({ cmd: "activate", id: Number(button.dataset.overviewTab) });
        }),
    );
    $$("[data-overview-app]").forEach(
      (button) =>
        (button.onclick = () => {
          closeTransient();
          send({ cmd: "apps_open", id: button.dataset.overviewApp });
        }),
    );
    $$("[data-overview-close]").forEach(
      (button) =>
        (button.onclick = () =>
          send({ cmd: "close_tab", id: Number(button.dataset.overviewClose) })),
    );
    $$("[data-overview-close-app]").forEach(
      (button) =>
        (button.onclick = () => closeAppTab(button.dataset.overviewCloseApp)),
    );
  }
  function showFind() {
    closeTransient();
    ui.find = true;
    $("#find-bar").hidden = false;
    $("#find-input").focus();
    $("#find-input").select();
    updateLayout();
  }
  function closeFind() {
    ui.find = false;
    $("#find-bar").hidden = true;
    send({ cmd: "find", query: "", direction: "next" });
    updateLayout();
  }
  function find(direction = "next") {
    send({ cmd: "find", query: $("#find-input").value, direction });
  }
  function setZoom(factor) {
    ui.zoom = Math.max(0.5, Math.min(3, Math.round(factor * 10) / 10));
    send({ cmd: "zoom", factor: ui.zoom });
    notify(`Zoom: ${Math.round(ui.zoom * 100)}%`);
  }
  function showZoom() {
    showPopup(
      menuItem("plus", "Ampliar", "zoom-in", "Ctrl++") +
        menuItem(
          "zoom",
          `${Math.round(ui.zoom * 100)}% — tamanho real`,
          "zoom-reset",
          "Ctrl+0",
        ) +
        menuItem("close", "Reduzir", "zoom-out", "Ctrl+−"),
      $("#more-button"),
      "zoom",
    );
  }
  function shortcut(key, shift = false) {
    const k = key.toLowerCase();
    if (k === "task-manager" || (k === "escape" && shift)) {
      showTaskManager();
      return true;
    }
    if (k === "l") {
      focusAddress();
      return true;
    }
    if (k === "t") {
      shift ? send({ cmd: "reopen_tab" }) : newTab();
      return true;
    }
    if (k === "w") {
      if (state.apps?.active_id) closeAppTab(state.apps.active_id);
      else send({ cmd: "close_tab", id: state.active_id });
      return true;
    }
    if (k === "tab") {
      cycleTabs(shift ? -1 : 1);
      return true;
    }
    if (k === "n" && shift) {
      newTab(true);
      return true;
    }
    if (k === "f") {
      showFind();
      return true;
    }
    if (k === "d") {
      menuAction("bookmark");
      return true;
    }
    if (k === "h") {
      toggleSidebar("history");
      return true;
    }
    if (k === "j") {
      showDownloads();
      return true;
    }
    if (k === "b") {
      toggleSidebar();
      return true;
    }
    if (k === "p") {
      send({ cmd: "print" });
      return true;
    }
    if (k === "r" || k === "reload") {
      send({ cmd: shift && k === "r" ? "reader" : "reload" });
      return true;
    }
    if (k === "+" || k === "=") {
      setZoom(ui.zoom + 0.1);
      return true;
    }
    if (k === "-") {
      setZoom(ui.zoom - 0.1);
      return true;
    }
    if (k === "0") {
      setZoom(1);
      return true;
    }
    return false;
  }
  function preview(command) {
    const tab = active();
    let changed = true;
    switch (command.cmd) {
      case "ready":
      case "layout":
        return;
      case "new_tab": {
        const id = Math.max(...state.tabs.map((t) => t.id), 0) + 1;
        state.tabs.push({
          id,
          title:
            command.url === "mare://start"
              ? "Página inicial"
              : hostname(command.url),
          url: command.url,
          private: command.private,
          pinned: false,
          loading: false,
          can_go_back: false,
          can_go_forward: false,
        });
        state.active_id = id;
        break;
      }
      case "navigate": {
        let url = command.url;
        if (!/^https?:\/\//i.test(url) && url !== "mare://start")
          url = /^[^\s]+\.[^\s]+$/.test(url)
            ? `https://${url}`
            : `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
        tab.url = url;
        tab.title = hostname(url);
        break;
      }
      case "activate":
        state.active_id = command.id;
        break;
      case "close_tab": {
        const item = state.tabs.find((t) => t.id === command.id);
        if (item) previouslyClosed.push({ ...item });
        state.tabs = state.tabs.filter((t) => t.id !== command.id);
        if (!state.tabs.length) {
          state.tabs = [
            {
              id: 1,
              title: "Página inicial",
              url: "mare://start",
              private: false,
            },
          ];
        }
        if (!state.tabs.some((t) => t.id === state.active_id))
          state.active_id = state.tabs.at(-1).id;
        break;
      }
      case "reopen_tab": {
        const item = previouslyClosed.pop();
        if (item) {
          item.id = Math.max(...state.tabs.map((t) => t.id)) + 1;
          state.tabs.push(item);
          state.active_id = item.id;
        }
        break;
      }
      case "duplicate_tab": {
        const t = state.tabs.find((t) => t.id === command.id);
        if (t) {
          const id = Math.max(...state.tabs.map((t) => t.id)) + 1;
          state.tabs.push({ ...t, id });
          state.active_id = id;
        }
        break;
      }
      case "pin_tab": {
        const t = state.tabs.find((t) => t.id === command.id);
        if (t) t.pinned = !t.pinned;
        break;
      }
      case "close_other_tabs":
        state.tabs = state.tabs.filter((t) => t.id === command.id);
        state.active_id = command.id;
        break;
      case "reorder_tabs":
        state.tabs = command.ids
          .map((id) => state.tabs.find((t) => t.id === id))
          .filter(Boolean);
        break;
      case "add_bookmark":
        state.bookmarks.push({
          id: Date.now(),
          url: command.url,
          title: command.title,
        });
        break;
      case "remove_bookmark":
        state.bookmarks = state.bookmarks.filter((b) => b.id !== command.id);
        break;
      case "toggle_bookmark": {
        const index = state.bookmarks.findIndex((b) => b.url === tab.url);
        if (index >= 0) state.bookmarks.splice(index, 1);
        else
          state.bookmarks.push({
            id: Date.now(),
            title: tab.title,
            url: tab.url,
          });
        break;
      }
      case "add_reading":
        if (!state.reading_list.some((r) => r.url === tab.url)) {
          state.reading_list.push({
            id: Date.now(),
            title: tab.title,
            url: tab.url,
            read: false,
          });
          notify("Página adicionada à Lista de Leitura.");
        }
        break;
      case "remove_reading":
        state.reading_list = state.reading_list.filter(
          (r) => r.id !== command.id,
        );
        break;
      case "mark_read": {
        const r = state.reading_list.find((r) => r.id === command.id);
        if (r) r.read = !r.read;
        break;
      }
      case "settings":
        state.settings = { ...state.settings, ...command.settings };
        break;
      case "clear_history":
        state.history = [];
        break;
      case "window":
        changed = false;
        notify("Os controles da janela funcionam no aplicativo Maré.");
        break;
      case "copy_url":
        copyUrl();
        return;
      default:
        changed = false;
    }
    if (changed) render();
  }
  hydrateIcons();
  $("#address-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const choices = $$("[data-suggest]", $("#suggestions"));
    if (
      !$("#suggestions").hidden &&
      ui.suggestion >= 0 &&
      choices[ui.suggestion]
    )
      navigate(choices[ui.suggestion].dataset.suggest);
    else if ($("#address").value.trim()) navigate($("#address").value.trim());
  });
  $("#address").addEventListener("focus", () => {
    renderSuggestions();
  });
  $("#address").addEventListener("input", () => {
    clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(renderSuggestions, 70);
  });
  $("#address").addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const choices = $$("[data-suggest]", $("#suggestions"));
      if (!choices.length) return;
      ui.suggestion =
        (ui.suggestion + (e.key === "ArrowDown" ? 1 : -1) + choices.length) %
        choices.length;
      choices.forEach((el, i) =>
        el.setAttribute("aria-selected", String(i === ui.suggestion)),
      );
    }
    if (e.key === "Escape") {
      closeTransient();
      $("#address").value = isStart(active()) ? "" : active().url;
      $("#address").blur();
    }
  });
  $("#back").onclick = () => send({ cmd: "back" });
  $("#forward").onclick = () => send({ cmd: "forward" });
  $("#reload").onclick = () =>
    send({ cmd: active().loading ? "stop" : "reload" });
  $("#reader-button").onclick = () => send({ cmd: "reader" });
  $("#shield-button").onclick = () =>
    ui.popup === "shield" ? closeTransient() : showShield();
  $("#performance-button").onclick = showTaskManager;
  $("#extensions-button").onclick = showExtensions;
  $("#apps-button").onclick = () =>
    ui.overlay === "store" ? closeTransient() : showStore();
  $("#sidebar-toggle").onclick = () => toggleSidebar();
  $("#sidebar-close").onclick = () => toggleSidebar();
  $("#sidebar-start").onclick = () => navigate("mare://start");
  $("#new-tab").onclick = () => newTab();
  $("#private-button").onclick = () => newTab(true);
  $("#share-button").onclick = () =>
    ui.popup === "share" ? closeTransient() : showShare();
  $("#more-button").onclick = () =>
    ui.popup === "more" ? closeTransient() : showMore();
  $("#downloads-button").onclick = () =>
    ui.popup === "downloads" ? closeTransient() : showDownloads();
  $("#overview-button").onclick = () =>
    ui.overlay === "overview" ? closeTransient() : showOverview();
  $("#settings-button").onclick = showSettings;
  $("#customize").onclick = showSettings;
  $("#add-favorite").onclick = () => showBookmarkDialog();
  $("#sidebar-add").onclick = () =>
    ui.section === "reading" ? menuAction("reading") : showBookmarkDialog();
  $("#reading-all").onclick = () => toggleSidebar("reading");
  $("#history-all").onclick = () => toggleSidebar("history");
  $$("[data-section]").forEach(
    (el) =>
      (el.onclick = () => {
        ui.section = el.dataset.section;
        ui.query = "";
        $("#library-search").value = "";
        renderSidebar();
      }),
  );
  $("#library-search").addEventListener("input", (e) => {
    ui.query = e.target.value;
    renderSidebar();
  });
  $("#site-info").onclick = () => {
    if (state.apps?.active_id) {
      const app = openAppTabs().find(
        (item) => item.id === state.apps.active_id,
      );
      showPopup(
        `<div class="popup-info"><strong>${esc(app?.name || "Aplicativo")}</strong><p>Aplicativo Rust em uma aba do Maré.</p></div>`,
        $("#site-info"),
        "info",
      );
      return;
    }
    const tab = active();
    showPopup(
      `<div class="popup-info"><strong>${esc(isStart(tab) ? "Maré" : hostname(tab.url))}</strong><p>${esc(isStart(tab) ? "Seu navegador de código aberto." : tab.url.startsWith("https:") ? "Esta página usa uma conexão HTTPS." : "Esta página usa uma conexão HTTP sem criptografia.")}</p>${tab.private ? "<p>Esta aba não salva o histórico de páginas visitadas.</p>" : ""}</div>`,
      $("#site-info"),
      "info",
    );
  };
  $("#find-bar").onsubmit = (e) => {
    e.preventDefault();
    find();
  };
  $("#find-input").oninput = () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => find(), 180);
  };
  $("#find-prev").onclick = () => find("previous");
  $("#find-close").onclick = closeFind;
  $$("[data-window]").forEach(
    (el) =>
      (el.onclick = () =>
        el.dataset.window === "close"
          ? requestClose()
          : send({ cmd: "window", action: el.dataset.window })),
  );
  $("#titlebar").addEventListener("mousedown", (e) => {
    if (e.button === 0 && !e.target.closest("button,input,form"))
      send({ cmd: "window", action: "drag" });
  });
  $("#titlebar").addEventListener("dblclick", (e) => {
    if (!e.target.closest("button,input,form"))
      send({ cmd: "window", action: "maximize" });
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest(".select-control")) closeSelect();
    if (
      !$("#popup").hidden &&
      !e.target.closest("#popup") &&
      !e.target.closest(
        "#share-button,#more-button,#downloads-button,#site-info,#shield-button",
      )
    ) {
      closeTransient();
    }
    if (
      !$("#suggestions").hidden &&
      !e.target.closest("#suggestions,#address-form")
    ) {
      $("#suggestions").hidden = true;
      $("#address").setAttribute("aria-expanded", "false");
      updateLayout();
    }
  });
  $("#overlay").addEventListener("mousedown", (e) => {
    if (e.target === $("#overlay")) closeTransient();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $(".select-control.open")) {
      e.preventDefault();
      closeSelect(true);
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "s" &&
      state.apps?.active_id === "notes"
    ) {
      e.preventDefault();
      flushNote().catch((error) => notify(error.message));
      return;
    }
    if (e.key === "Escape") {
      if (
        !$("#overlay").hidden ||
        !$("#popup").hidden ||
        !$("#suggestions").hidden
      )
        closeTransient();
      else if (ui.find) closeFind();
      else send({ cmd: "stop" });
      return;
    }
    if (e.key === "F12") {
      e.preventDefault();
      send({ cmd: "devtools" });
      return;
    }
    if (e.key === "F5") {
      e.preventDefault();
      send({ cmd: "reload" });
      return;
    }
    if (e.key === "F6") {
      e.preventDefault();
      focusAddress();
      return;
    }
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      send({ cmd: "back" });
      return;
    }
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      send({ cmd: "forward" });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && shortcut(e.key, e.shiftKey)) {
      e.preventDefault();
      return;
    }
    if (e.key === "Tab" && !$("#overlay").hidden) {
      const items = $$(
        'button,input,select,textarea,[tabindex="0"]',
        $("#overlay-panel"),
      ).filter(
        (el) => !el.disabled && el.getClientRects().length && el.tabIndex >= 0,
      );
      if (!items.length) return;
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  window.addEventListener("resize", () => {
    const popup = $("#popup");
    if (!popup.hidden) {
      const rect = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(8, Math.min(rect.x, innerWidth - rect.width - 8))}px`;
      popup.style.top = `${Math.max(8, Math.min(rect.y, innerHeight - rect.height - 8))}px`;
    }
    if (!$("#suggestions").hidden) renderSuggestions();
    updateLayout();
  });
  new ResizeObserver(updateLayout).observe($("#viewport"));
  for (const selector of ["#popup", "#suggestions", "#toast"])
    new ResizeObserver(updateLayout).observe($(selector));
  media.addEventListener("change", applyTheme);
  window.mare = {
    receive,
    resources,
    extensionsEvent,
    showTaskManager,
    dismiss: () => closeTransient(true),
    notify,
    shortcut,
    focusAddress,
    showSettings,
    showStore,
    appsEvent,
    appsRequestFailed,
    permissionRequest,
    requestClose,
    copy,
  };
  render();
  send({ cmd: "ready" });
})();
