"use strict";
const {
  app,
  BrowserWindow,
  WebContentsView,
  webContents,
  ipcMain,
  protocol,
  session,
  dialog,
  shell,
  clipboard,
  Menu,
  powerSaveBlocker,
  net,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Bridge } = require("./bridge.cjs");
const { Extensions } = require("./extensions.cjs");
const M = require("./model.cjs");
const updates = require("./updates.cjs");
const ROOT = __dirname;
const UI = "compass-ui://app/";
const smoke =
  process.argv.includes("--smoke-test") &&
  /^\/tmp\/compass-smoke-[\w-]+$/.test(process.env.COMPASS_SMOKE_DIR || "");
const profile = smoke
  ? path.join(process.env.COMPASS_SMOKE_DIR, "profile")
  : path.join(app.getPath("appData"), "compass-browser");
app.setName("Compass Browser");
app.setDesktopName("compass-browser.desktop");
app.setPath("userData", profile);
app.setPath("sessionData", path.join(profile, "chromium"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "compass-ui",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let host;
  app.on("second-instance", (_, argv) => {
    host?.win.show();
    host?.win.focus();
    for (const url of argv.filter((v) => /^https?:\/\//i.test(v)))
      host?.newTab(url);
  });
  app
    .whenReady()
    .then(async () => {
      protocol.handle(
        "compass-ui",
        (request) =>
          new Response(
            request.url === UI
              ? fs.readFileSync(path.join(ROOT, "index.html"))
              : "Not found",
            {
              status: request.url === UI ? 200 : 404,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "X-Content-Type-Options": "nosniff",
              },
            },
          ),
      );
      Menu.setApplicationMenu(null);
      host = new Host();
      await host.start();
      if (smoke)
        await require("./smoke-harness.cjs")(
          host,
          process.env.COMPASS_SMOKE_DIR,
        );
    })
    .catch((error) => {
      console.error(error.message);
      app.exit(1);
    });
  let closing = false;
  app.on("before-quit", (event) => {
    if (host && !closing) {
      event.preventDefault();
      closing = true;
      host.shutdown().finally(() => app.quit());
    }
  });
  app.on("window-all-closed", () => app.quit());
}

class Host {
  constructor() {
    fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
    fs.chmodSync(profile, 0o700);
    this.file = path.join(profile, "browser.json");
    let saved = {};
    if (fs.existsSync(this.file)) {
      if (fs.statSync(this.file).size > 4 * 1024 * 1024)
        throw Error("O perfil excede o limite. Ele foi preservado.");
      try {
        saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      } catch {
        throw Error(
          "O perfil está inválido e foi preservado. Faça uma cópia antes de recuperá-lo.",
        );
      }
    }
    this.state = M.initial(saved);
    this.views = new Map();
    this.downloads = new Map();
    this.privateSessions = new Map();
    this.closed = [];
    this.contextActions = new Map();
    this.permissionRequests = new Map();
    this.rect = { x: 0, y: 100, width: 1100, height: 650 };
    this.overlay = false;
    this.fullscreenTab = null;
    this.uiReady = false;
    this.savedTimer = null;
    this.appState = null;
    this.sequence = 0;
    this.quit = false;
    this.errors = [];
    this.update = { status: "current" };
    this.availableUpdate = null;
    this.bridge = new Bridge(path.join(ROOT, "noise-worker"), profile);
    this.bridge.on("closed", () =>
      this.notify("O serviço do Noise encerrou. Reabra o Compass."),
    );
    this.bridge.on("app", (v) => {
      this.appState = v.apps;
      this.call("appsEvent", v.event);
      this.publish();
    });
    this.win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 760,
      minHeight: 540,
      frame: false,
      show: false,
      backgroundColor: "#18181d",
      title: "Compass Browser",
      icon: path.join(ROOT, "compass.png"),
      webPreferences: {
        preload: path.join(ROOT, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    this.win.webContents.on("will-navigate", (e, url) => {
      if (url !== UI) e.preventDefault();
    });
    this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.win.webContents.session.setPermissionRequestHandler(
      (_, __, callback) => callback(false),
    );
    this.win.webContents.on("console-message", (details) => {
      if (details.level === "error" || details.level === 3)
        this.errors.push(details.message.slice(0, 300));
    });
    ipcMain.on("compass-command", (event, text) => {
      if (
        event.sender !== this.win.webContents ||
        event.senderFrame !== this.win.webContents.mainFrame ||
        event.senderFrame.url !== UI ||
        typeof text !== "string" ||
        Buffer.byteLength(text) > 262144
      )
        return;
      let v;
      try {
        v = JSON.parse(text);
      } catch {
        return;
      }
      if (!v || typeof v.cmd !== "string") return;
      this.command(v).catch((error) => this.notify(error.message));
    });
    this.win.on("resize", () => this.arrange());
    this.win.on("enter-full-screen", () => this.arrange());
    this.win.on("leave-full-screen", () => this.arrange());
    this.win.on("close", (e) => {
      if (!this.quit) {
        e.preventDefault();
        this.call("requestClose");
      }
    });
    this.win.on("closed", () => {
      this.quit = true;
    });
  }
  async start() {
    this.appState = await this.bridge.ready;
    await this.bridge.request({
      cmd: "filter_configure",
      enabled: this.state.settings.shield_enabled,
      exceptions: this.state.settings.shield_exceptions,
    });
    const sites = session.fromPartition("persist:compass-sites");
    this.configureSession(sites);
    this.extensions = new Extensions(sites, path.join(profile, "extensions"), path.join(ROOT, "noise-worker"));
    await this.extensions.restore();
    this.win.webContents.session.on("will-download", (_, item) => this.trackDownload(item));
    await this.win.loadURL(UI);
    this.win.show();
    for (const tab of this.state.tabs)
      if (tab.url !== M.START) await this.createView(tab);
    this.arrange();
    this.publish();
    for (const url of process.argv.filter((v) => /^https?:\/\//i.test(v)))
      await this.newTab(url);
    this.updateTimer = setInterval(() => this.snapshotProtection(), 1500);
    this.playbackTimer = setInterval(() => this.checkPlayback(), 2000);
    if (!smoke && this.state.settings.automatic_updates) void this.checkUpdates();
  }
  call(method, ...args) {
    if (!this.uiReady || this.win.isDestroyed()) return Promise.resolve();
    return this.win.webContents
      .executeJavaScript(
        `window.mare?.[${JSON.stringify(method)}]?.(${args.map((v) => JSON.stringify(v)).join(",")});`,
      )
      .catch(() => {});
  }
  notify(message) {
    return this.call("notify", String(message).slice(0, 1000));
  }
  active() {
    return this.state.tabs.find((t) => t.id === this.state.active_id);
  }
  activeView() {
    return this.views.get(this.state.active_id)?.webContents;
  }
  publish() {
    if (!this.uiReady) return;
    this.call("receive", {
      ...this.state,
      apps: this.appState,
      platform: "linux",
      music_remote: { enabled: false },
      update: this.update,
      protection: this.protection || {
        enabled: this.state.settings.shield_enabled,
        status: "unavailable",
        blocked: 0,
        host: "",
        rules_count: 0,
        engine: "adblock-rust",
      },
      runtime: {
        open_tabs: this.state.tabs.length,
        loaded_tabs: this.views.size,
        visible_tabs:
          this.overlay || this.appState?.active_id
            ? []
            : [this.state.active_id],
        suspended_tabs: 0,
      },
    });
  }
  save() {
    clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.savedTimer);
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(M.persistent(this.state)), {
      mode: 0o600,
    });
    fs.renameSync(temp, this.file);
  }
  async snapshotProtection() {
    const tab = this.active();
    if (!tab) return;
    try {
      this.protection = await this.bridge.request({
        cmd: "filter_snapshot",
        tab: tab.id,
        url: tab.url,
      });
      this.publish();
    } catch {}
  }
  arrange() {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    const x = Math.min(Math.max(0, Math.round(this.rect.x)), width - 1),
      y = Math.min(Math.max(0, Math.round(this.rect.y)), height - 1);
    const bounds = {
      x,
      y,
      width: Math.max(1, Math.min(Math.round(this.rect.width), width - x)),
      height: Math.max(1, Math.min(Math.round(this.rect.height), height - y)),
    };
    for (const [id, view] of this.views) {
      const fullscreen = id === this.fullscreenTab;
      view.setBounds(fullscreen ? { x: 0, y: 0, width, height } : bounds);
      view.setVisible(
        fullscreen || (id === this.state.active_id &&
          !this.overlay &&
          !this.appState?.active_id),
      );
    }
  }
  canFullscreen(tab) {
    return tab?.id === this.state.active_id && !this.overlay && !this.appState?.active_id;
  }
  async exitPageFullscreen() {
    const id = this.fullscreenTab;
    if (id === null) return;
    const contents = this.views.get(id)?.webContents;
    await contents?.executeJavaScript(
      "if (document.fullscreenElement) document.exitFullscreen()",
    ).catch(() => {});
    if (this.fullscreenTab === id) {
      this.fullscreenTab = null;
      // The renderer may already be gone when a tab closes or crashes.
      if (this.win.isFullScreen()) this.win.setFullScreen(false);
      this.arrange();
    }
  }
  configureSession(ses) {
    if (ses.__compassConfigured) return;
    ses.__compassConfigured = true;
    ses.setPermissionCheckHandler((contents, permission, origin) => {
      const tab = this.tabForContents(contents);
      if (permission === "fullscreen") return this.canFullscreen(tab);
      return (
        !!tab &&
        permission === "media" &&
        this.grants?.has(origin + ":" + permission)
      );
    });
    ses.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        const tab = this.tabForContents(contents);
        if (permission === "fullscreen") {
          callback(this.canFullscreen(tab));
          return;
        }
        if (
          !tab ||
          ![
            "media",
            "notifications",
            "clipboard-read",
            "geolocation",
          ].includes(permission)
        ) {
          callback(false);
          return;
        }
        const url = details.requestingUrl || contents.getURL();
        let origin;
        try {
          origin = new URL(url).origin;
          if (origin !== new URL(contents.getURL()).origin) {
            callback(false);
            return;
          }
        } catch {
          callback(false);
          return;
        }
        const id = ++this.sequence,
          timer = setTimeout(() => {
            this.permissionRequests.delete(id);
            callback(false);
          }, 60000);
        this.permissionRequests.set(id, {
          callback,
          timer,
          contents,
          origin,
          permission,
        });
        this.call("permissionRequest", {
          id,
          origin,
          permission: {
            media: "microfone/câmera",
            notifications: "notificações",
            "clipboard-read": "área de transferência",
            geolocation: "localização",
          }[permission],
        });
      },
    );
    ses.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      async (details, callback) => {
        const contents = details.webContents ||
          (Number.isInteger(details.webContentsId) ? webContents.fromId(details.webContentsId) : null);
        const tab = this.tabForContents(
          contents,
        );
        if (!tab) {
          callback({ cancel: false });
          return;
        }
        try {
          if (details.resourceType === "mainFrame")
            await this.bridge.request({
              cmd: "filter_begin",
              tab: tab.id,
              url: details.url,
            });
          const result = await this.bridge.request({
            cmd: "filter",
            tab: tab.id,
            url: details.url,
            type:
              {
                mainFrame: "document",
                subFrame: "subdocument",
                xhr: "xmlhttprequest",
              }[details.resourceType] || details.resourceType,
            method: details.method,
            referer: details.referrer || tab.url,
          });
          callback({ cancel: !!result.cancel });
        } catch {
          callback({ cancel: false });
          this.protection = { ...this.protection, status: "unavailable" };
        }
      },
    );
    ses.on("will-download", (_, item, contents) =>
      this.trackDownload(item, this.tabForContents(contents)),
    );
  }
  tabForContents(contents) {
    return (
      contents &&
      [...this.views.entries()]
        .map(([id, v]) =>
          v.webContents === contents
            ? this.state.tabs.find((t) => t.id === id)
            : null,
        )
        .find(Boolean)
    );
  }
  async createView(tab) {
    if (this.views.has(tab.id) || tab.url === M.START) return;
    const partition = tab.private
      ? `compass-private-${tab.id}`
      : "persist:compass-sites";
    const ses = session.fromPartition(partition);
    this.configureSession(ses);
    if (tab.private) this.privateSessions.set(tab.id, ses);
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
      },
    });
    this.views.set(tab.id, view);
    this.win.contentView.addChildView(view);
    this.arrange();
    const wc = view.webContents;
    wc.on("enter-html-full-screen", () => {
      this.fullscreenTab = tab.id;
      if (this.canFullscreen(tab)) this.arrange();
      else void this.exitPageFullscreen();
    });
    wc.on("leave-html-full-screen", () => {
      if (this.fullscreenTab !== tab.id) return;
      this.fullscreenTab = null;
      this.arrange();
    });
    const reject = (event, url) => {
      if (!M.pageURL(url) || url === M.START) {
        event.preventDefault();
        this.notify("O site tentou abrir um tipo de endereço não permitido.");
      }
    };
    wc.on("will-navigate", reject);
    wc.on("will-redirect", reject);
    wc.on("will-frame-navigate", (_, details) => {
      if (details && typeof details.url === "string" && !M.pageURL(details.url))
        _.preventDefault();
    });
    wc.setWindowOpenHandler((details) => {
      if (M.pageURL(details.url) && details.url !== M.START)
        this.newTab(details.url, tab.private);
      return { action: "deny" };
    });
    wc.on("did-start-loading", () => {
      tab.loading = true;
      this.publish();
    });
    wc.on("did-stop-loading", () => {
      tab.loading = false;
      tab.can_go_back = wc.navigationHistory.canGoBack();
      tab.can_go_forward = wc.navigationHistory.canGoForward();
      this.publish();
    });
    const navigated = (_, url) => {
      if (M.pageURL(url)) {
        tab.url = url;
        this.publish();
        this.save();
      }
    };
    wc.on("did-navigate", navigated);
    wc.on("did-navigate-in-page", navigated);
    wc.on("page-title-updated", (_, title) => {
      tab.title = title.slice(0, 512);
      if (!tab.private) {
        const entry = this.state.history.find((e) => e.url === tab.url);
        if (entry) entry.title = tab.title;
      }
      this.publish();
      this.save();
    });
    wc.on("page-favicon-updated", (_, urls) => {
      tab.favicon =
        urls.find((u) => u.length <= 2048 && /^https?:\/\//.test(u)) || "";
      this.publish();
    });
    wc.on("did-finish-load", async () => {
      if (!tab.private && M.pageURL(tab.url)) {
        this.state.history = this.state.history.filter(
          (e) => e.url !== tab.url,
        );
        this.state.history.unshift({
          url: tab.url,
          title: tab.title,
          visited_at: Date.now(),
        });
        this.state.history.length = Math.min(1000, this.state.history.length);
        this.save();
      }
      try {
        const candidates = await wc.executeJavaScript(
          fs.readFileSync(path.join(ROOT, "cosmetic-candidates.js"), "utf8"),
        );
        const script = await this.bridge.request({
          cmd: "filter_cosmetics",
          tab: tab.id,
          url: tab.url,
          ...candidates,
        });
        if (wc.getURL() === tab.url) await wc.executeJavaScript(script);
      } catch {}
      this.snapshotProtection();
    });
    wc.on("did-fail-load", (_, code, description, __, main) => {
      if (main && code !== -3) {
        tab.loading = false;
        this.notify("Não foi possível abrir a página: " + description);
        this.publish();
      }
    });
    wc.on("render-process-gone", () => {
      if (this.fullscreenTab === tab.id) void this.exitPageFullscreen();
      tab.loading = false;
      this.notify("Esta aba encerrou. Recarregue para tentar novamente.");
      this.publish();
    });
    wc.on("context-menu", (_, params) => this.contextMenu(wc, tab, params));
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      if (
        input.control &&
        !input.alt &&
        [
          "l",
          "t",
          "w",
          "r",
          "f",
          "d",
          "h",
          "j",
          "b",
          "p",
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
        ].includes(input.key.toLowerCase())
      ) {
        event.preventDefault();
        this.exitPageFullscreen().then(() =>
          this.call("shortcut", input.key.toLowerCase(), input.shift),
        );
      }
      if (input.key === "F5") {
        event.preventDefault();
        wc.reload();
      }
      if (input.alt && ["ArrowLeft", "ArrowRight"].includes(input.key)) {
        event.preventDefault();
        this.command({ cmd: input.key === "ArrowLeft" ? "back" : "forward" });
      }
    });
    await this.bridge.request({
      cmd: "filter_begin",
      tab: tab.id,
      url: tab.url,
    });
    wc.loadURL(tab.url).catch(() => {});
  }
  async newTab(value = M.START, privateTab = false) {
    const url = M.normalize(value, this.state.settings.search_engine);
    await this.exitPageFullscreen();
    const tab = M.newTab(this.state, url, privateTab);
    await this.background();
    await this.createView(tab);
    this.arrange();
    this.publish();
    this.save();
    return tab;
  }
  async background() {
    if (this.appState?.active_id)
      this.appState = await this.bridge.request({ cmd: "apps_background" });
  }
  async navigate(input) {
    const tab = this.active();
    if (!tab) return;
    await this.exitPageFullscreen();
    await this.background();
    tab.url = M.normalize(input, this.state.settings.search_engine);
    tab.title =
      tab.url === M.START ? "Página inicial" : new URL(tab.url).hostname;
    tab.app_id = null;
    if (tab.url === M.START) this.destroyView(tab.id);
    else if (this.views.has(tab.id))
      this.views
        .get(tab.id)
        .webContents.loadURL(tab.url)
        .catch(() => {});
    else await this.createView(tab);
    this.arrange();
  }
  destroyView(id) {
    const view = this.views.get(id);
    if (view) {
      if (this.fullscreenTab === id) {
        this.fullscreenTab = null;
        if (this.win.isFullScreen()) this.win.setFullScreen(false);
      }
      this.views.delete(id);
      this.win.contentView.removeChildView(view);
      view.webContents.close({ waitForBeforeUnload: false });
    }
    this.bridge.request({ cmd: "filter_close", tab: id }).catch(() => {});
    const ses = this.privateSessions.get(id);
    if (ses) {
      this.privateSessions.delete(id);
      ses.clearStorageData().catch(() => {});
      ses.clearCache().catch(() => {});
    }
  }
  closeTab(id) {
    const index = this.state.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const [tab] = this.state.tabs.splice(index, 1);
    if (!tab.private) {
      this.closed.push(tab);
      if (this.closed.length > 20) this.closed.shift();
    }
    this.destroyView(id);
    if (!this.state.tabs.length) M.newTab(this.state);
    if (this.state.active_id === id)
      this.state.active_id =
        this.state.tabs[Math.min(index, this.state.tabs.length - 1)].id;
    this.arrange();
  }
  async contextMenu(wc, tab, p) {
    this.contextActions.clear();
    const items = [];
    const add = (label, fn, enabled = true, shortcut = "") => {
      const id = ++this.sequence;
      this.contextActions.set(id, { wc, fn });
      items.push({ id, label, enabled, shortcut });
    };
    const sep = () => items.push({ separator: true });
    if (p.linkURL && M.pageURL(p.linkURL)) {
      add("Abrir link em nova aba", () => this.newTab(p.linkURL, tab.private));
      add("Copiar link", () => clipboard.writeText(p.linkURL));
      sep();
    }
    if (p.mediaType === "image" && /^https?:\/\//.test(p.srcURL)) {
      add("Salvar imagem como…", () => wc.downloadURL(p.srcURL));
      add("Copiar imagem", () => wc.copyImageAt(p.x, p.y));
      add("Copiar endereço da imagem", () => clipboard.writeText(p.srcURL));
      sep();
    }
    if (p.isEditable) {
      for (const [label, method] of [
        ["Desfazer", "undo"],
        ["Refazer", "redo"],
        ["Recortar", "cut"],
        ["Copiar", "copy"],
        ["Colar", "paste"],
        ["Selecionar tudo", "selectAll"],
      ])
        add(label, () => wc[method]());
      sep();
    } else if (p.selectionText) {
      add("Copiar", () => clipboard.writeText(p.selectionText));
      add("Pesquisar seleção", () => this.newTab(p.selectionText));
      sep();
    }
    add(
      "Voltar",
      () => wc.navigationHistory.goBack(),
      wc.navigationHistory.canGoBack(),
    );
    add(
      "Avançar",
      () => wc.navigationHistory.goForward(),
      wc.navigationHistory.canGoForward(),
    );
    add("Recarregar", () => wc.reload(), true, "Ctrl+R");
    sep();
    add("Inspecionar", () => wc.inspectElement(p.x, p.y));
    this.call("engineMenu", {
      token: ++this.sequence,
      x: this.rect.x + p.x,
      y: this.rect.y + p.y,
      items,
    });
  }
  trackDownload(item, tab) {
    const id = this.state.next_id++,
      record = {
        id,
        filename: path.basename(item.getFilename()),
        path: "",
        status: "choosing",
        received: 0,
        total: item.getTotalBytes() || null,
        resumable: false,
        private: !!tab?.private,
      };
    if (smoke)
      item.setSavePath(
        path.join(process.env.COMPASS_SMOKE_DIR, record.filename),
      );
    else
      item.setSaveDialogOptions({
        defaultPath: path.join(app.getPath("downloads"), record.filename),
        title: "Salvar arquivo — Compass",
      });
    this.downloads.set(id, item);
    this.state.downloads.unshift(record);
    const update = () => {
      record.path = item.getSavePath();
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes() || null;
      record.resumable = item.canResume();
      record.status = item.isPaused() ? "paused" : "downloading";
      this.publish();
      this.save();
    };
    item.on("updated", (_, status) => {
      update();
      if (status === "interrupted") {
        record.status = "interrupted";
        this.publish();
      }
    });
    item.once("done", (_, status) => {
      record.path = item.getSavePath();
      record.received = item.getReceivedBytes();
      record.status = status;
      record.resumable = false;
      this.downloads.delete(id);
      this.pruneDownloads();
      this.publish();
      this.save();
    });
    this.publish();
  }
  pruneDownloads() {
    let terminal = 0;
    this.state.downloads = this.state.downloads.filter(
      (d) => this.downloads.has(d.id) || ++terminal <= 200,
    );
  }
  async checkPlayback() {
    // Chromium streams and Rust local playback must both survive a hidden/minimized window.
    const active =
      this.appState?.responses?.spotify?.payload?.result?.player?.state ===
      "playing";
    const stream = await this.win.webContents
      .executeJavaScript(
        "[...document.querySelectorAll('audio')].some(a=>!a.paused&&!a.ended)",
      )
      .catch(() => false);
    if ((active || stream) && this.powerId == null)
      this.powerId = powerSaveBlocker.start("prevent-app-suspension");
    else if (!active && !stream && this.powerId != null) {
      powerSaveBlocker.stop(this.powerId);
      this.powerId = null;
    }
  }
  async command(v) {
    const id = Number(v.id),
      tab = this.active(),
      wc = this.activeView();
    switch (v.cmd) {
      case "ready":
        this.uiReady = true;
        this.publish();
        this.arrange();
        return;
      case "layout": {
        this.rect = {
          x: Number(v.x) || 0,
          y: Number(v.y) || 0,
          width: Math.max(1, Number(v.width) || 1),
          height: Math.max(1, Number(v.height) || 1),
        };
        if (this.fullscreenTab !== null && !v.overlay) {
          this.arrange();
          return;
        }
        const r = this.rect,
          panels =
            Array.isArray(v.panels) &&
            v.panels.some(
              (p) =>
                p[0] < r.x + r.width &&
                p[0] + p[2] > r.x &&
                p[1] < r.y + r.height &&
                p[1] + p[3] > r.y,
            );
        const next = !!v.overlay || !!panels,
          previous = this.overlay;
        this.overlay = next;
        if (next && !previous && !this.appState?.active_id) {
          await this.exitPageFullscreen();
          const page = this.activeView(),
            id = this.state.active_id;
          if (page)
            page
              .capturePage()
              .then((image) => {
                if (
                  !this.overlay ||
                  this.state.active_id !== id ||
                  this.appState?.active_id
                )
                  return;
                const data = image.toDataURL();
                this.win.webContents
                  .executeJavaScript(
                    `(()=>{let img=document.getElementById('compass-page-preview');if(!img){img=document.createElement('img');img.id='compass-page-preview';img.alt='';img.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';document.getElementById('viewport').prepend(img);}img.src=${JSON.stringify(data)};})()`,
                  )
                  .catch(() => {});
              })
              .catch(() => {});
        }
        if (!next && previous)
          this.win.webContents
            .executeJavaScript(
              "document.getElementById('compass-page-preview')?.remove()",
            )
            .catch(() => {});
        this.arrange();
        return;
      }
      case "navigate":
        await this.navigate(v.url);
        break;
      case "new_tab":
        await this.newTab(v.url, v.private);
        break;
      case "activate":
        if (this.state.tabs.some((t) => t.id === id)) {
          if (this.state.active_id !== id) await this.exitPageFullscreen();
          await this.background();
          this.state.active_id = id;
          this.arrange();
          this.snapshotProtection();
        }
        break;
      case "close_tab":
        this.closeTab(id);
        break;
      case "close_other_tabs":
        for (const t of [...this.state.tabs])
          if (t.id !== id) this.closeTab(t.id);
        break;
      case "reopen_tab": {
        const t = this.closed.pop();
        if (t) await this.newTab(t.url);
        break;
      }
      case "duplicate_tab": {
        const t = this.state.tabs.find((t) => t.id === id);
        if (t) await this.newTab(t.url, t.private);
        break;
      }
      case "pin_tab": {
        const t = this.state.tabs.find((t) => t.id === id);
        if (t) t.pinned = !t.pinned;
        break;
      }
      case "reorder_tabs": {
        const order = v.ids || v.order;
        if (
          Array.isArray(order) &&
          order.length === this.state.tabs.length &&
          new Set(order).size === order.length &&
          order.every((id) => this.state.tabs.some((t) => t.id === id))
        )
          this.state.tabs.sort(
            (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
          );
        break;
      }
      case "back":
        if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        break;
      case "forward":
        if (wc?.navigationHistory.canGoForward())
          wc.navigationHistory.goForward();
        break;
      case "reload":
        wc?.reload();
        break;
      case "stop":
        wc?.stop();
        break;
      case "copy_url":
        clipboard.writeText(tab?.url || "");
        break;
      case "find":
        if (wc) {
          if (v.query)
            wc.findInPage(String(v.query).slice(0, 1000), {
              forward: v.direction !== "previous",
            });
          else wc.stopFindInPage("clearSelection");
        }
        break;
      case "zoom":
        wc?.setZoomFactor(Math.min(3, Math.max(0.25, Number(v.factor) || 1)));
        break;
      case "print":
        wc?.print();
        break;
      case "devtools":
        wc?.openDevTools({ mode: "detach" });
        break;
      case "reader":
        if (wc)
          wc.executeJavaScript(
            fs.readFileSync(path.join(ROOT, "reader.js"), "utf8"),
          ).catch(() =>
            this.notify("Não foi possível abrir o modo de leitura."),
          );
        break;
      case "toggle_bookmark":
        if (tab && tab.url !== M.START) {
          const found = this.state.bookmarks.find((b) => b.url === tab.url);
          if (found)
            this.state.bookmarks = this.state.bookmarks.filter(
              (b) => b !== found,
            );
          else
            this.state.bookmarks.push({
              id: this.state.next_id++,
              title: tab.title,
              url: tab.url,
            });
        }
        break;
      case "add_bookmark":
        if (M.pageURL(v.url) && v.url !== M.START)
          this.state.bookmarks.push({
            id: this.state.next_id++,
            title: String(v.title || v.url).slice(0, 512),
            url: M.pageURL(v.url),
          });
        break;
      case "remove_bookmark":
        this.state.bookmarks = this.state.bookmarks.filter((b) => b.id !== id);
        break;
      case "add_reading":
        if (
          tab &&
          tab.url !== M.START &&
          !this.state.reading_list.some((b) => b.url === tab.url)
        )
          this.state.reading_list.unshift({
            id: this.state.next_id++,
            title: tab.title,
            url: tab.url,
            read: false,
          });
        break;
      case "remove_reading":
        this.state.reading_list = this.state.reading_list.filter(
          (b) => b.id !== id,
        );
        break;
      case "mark_read": {
        const r = this.state.reading_list.find((b) => b.id === id);
        if (r) r.read = !r.read;
        break;
      }
      case "clear_history":
        this.state.history = [];
        break;
      case "clear_data": {
        const confirmed = await dialog.showMessageBox(this.win, {
          type: "question",
          message: "Apagar cookies, logins e cache dos sites?",
          buttons: ["Cancelar", "Apagar dados"],
          defaultId: 0,
          cancelId: 0,
        });
        if (confirmed.response === 1) {
          await session
            .fromPartition("persist:compass-sites")
            .clearStorageData();
          await session.fromPartition("persist:compass-sites").clearCache();
          this.state.history = [];
          this.notify("Dados dos sites apagados.");
        }
        break;
      }
      case "settings":
        this.state.settings = M.settings(v.settings);
        await this.configureShield();
        break;
      case "shield_toggle":
        this.state.settings.shield_enabled = !!v.enabled;
        await this.configureShield();
        break;
      case "shield_site_toggle":
        if (tab && M.pageURL(tab.url) && tab.url !== M.START) {
          const host = new URL(tab.url).hostname;
          this.state.settings.shield_exceptions =
            this.state.settings.shield_exceptions.filter((h) => h !== host);
          if (!v.enabled) this.state.settings.shield_exceptions.push(host);
          await this.configureShield();
        }
        break;
      case "apps_install":
      case "apps_uninstall":
      case "apps_open":
      case "apps_close":
      case "apps_background":
        if (v.cmd === "apps_open") await this.exitPageFullscreen();
        if (v.id === "discord" && v.cmd === "apps_open") {
          await this.newTab("https://discord.com/app");
          break;
        }
        this.appState = await this.bridge.request(v);
        this.arrange();
        break;
      case "apps_request":
        try {
          await this.bridge.request(v);
        } catch (e) {
          this.call("appsRequestFailed", v.request_id, e.message);
        }
        return;
      case "permission_answer": {
        const p = this.permissionRequests.get(id);
        if (p) {
          this.permissionRequests.delete(id);
          clearTimeout(p.timer);
          let valid = false;
          try {
            valid = new URL(p.contents.getURL()).origin === p.origin;
          } catch {}
          if (v.allow && valid) {
            this.grants ||= new Set();
            this.grants.add(p.origin + ":" + p.permission);
          }
          p.callback(!!v.allow && valid);
        }
        break;
      }
      case "context_menu_answer": {
        const action = this.contextActions.get(Number(v.command));
        this.contextActions.clear();
        if (action && !action.wc.isDestroyed()) action.fn();
        break;
      }
      case "pause_download": {
        const item = this.downloads.get(id),
          record = this.state.downloads.find((d) => d.id === id);
        if (item && record) {
          item.pause();
          record.status = "paused";
          record.resumable = item.canResume();
        }
        break;
      }
      case "resume_download": {
        const item = this.downloads.get(id),
          record = this.state.downloads.find((d) => d.id === id);
        if (item && record && item.canResume()) {
          item.resume();
          record.status = "downloading";
          record.resumable = false;
        }
        break;
      }
      case "cancel_download":
        this.downloads.get(id)?.cancel();
        break;
      case "forget_download":
        if (!this.downloads.has(id))
          this.state.downloads = this.state.downloads.filter(
            (d) => d.id !== id,
          );
        break;
      case "clear_downloads":
        this.state.downloads = this.state.downloads.filter((d) =>
          this.downloads.has(d.id),
        );
        break;
      case "open_download":
      case "reveal_download": {
        const d = this.state.downloads.find(
          (d) => d.id === id && d.status === "completed",
        );
        if (d && fs.existsSync(d.path)) {
          if (v.cmd === "reveal_download") shell.showItemInFolder(d.path);
          else {
            const result = await dialog.showMessageBox(this.win, {
              message: "Abrir o arquivo baixado?",
              detail: d.filename,
              buttons: ["Cancelar", "Abrir"],
              defaultId: 0,
              cancelId: 0,
            });
            if (result.response === 1) await shell.openPath(d.path);
          }
        }
        break;
      }
      case "resources_poll":
        await this.resources();
        return;
      case "engine_task_manager":
        await this.resources();
        return;
      case "check_updates":
        await this.checkUpdates(true);
        return;
      case "download_update":
        if (this.availableUpdate)
          this.win.webContents.downloadURL(this.availableUpdate.url);
        return;
      case "extensions_list":
      case "extensions_prepare":
      case "extensions_install":
      case "extensions_cancel":
      case "extensions_enable":
      case "extensions_remove":
      case "extension_open":
        await this.extensionCommand(v);
        return;
      case "music_remote":
        this.notify(
          "Use a conta do Noise e o painel Dispositivos para controlar PC e celular.",
        );
        return;
      case "window":
        if (v.action === "minimize") this.win.minimize();
        else if (v.action === "maximize")
          this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize();
        else if (v.action === "close") {
          this.quit = true;
          app.quit();
        }
        return;
      default:
        return;
    }
    this.publish();
    this.save();
  }
  async checkUpdates(manual = false) {
    if (this.update.status === "checking") {
      if (manual) {
        this.update.manual = true;
        this.publish();
      }
      return;
    }
    this.update = { status: "checking", manual };
    this.publish();
    try {
      this.availableUpdate = await updates.check(net.fetch, this.state.version);
      const { manual } = this.update;
      this.update = this.availableUpdate
        ? { status: "available", version: this.availableUpdate.version, manual }
        : { status: "current", manual };
    } catch (error) {
      this.update = {
        status: "error",
        manual: this.update.manual,
        message: "Não foi possível verificar a versão Ubuntu. " + error.message,
      };
    }
    this.publish();
  }
  async extensionCommand(v) {
    const manager = this.extensions;
    const publish = (state, extra = {}) =>
      this.call("extensionsEvent", { state, items: manager.list(), ...extra });
    if (manager.busy) return;
    manager.busy = true;
    try {
      switch (v.cmd) {
        case "extensions_prepare":
          await publish("downloading");
          await manager.prepare(v.url);
          break;
        case "extensions_install":
          await manager.install();
          break;
        case "extensions_cancel":
          await manager.cancel();
          break;
        case "extensions_enable":
          await manager.setEnabled(v.id, v.enabled === true);
          break;
        case "extensions_remove":
          await manager.remove(v.id);
          break;
        case "extension_open":
          if (this.active()?.private) throw Error("Abra o painel em uma aba normal.");
          await manager.open(v.id, this.win, (url) => {
            if (M.pageURL(url) && url !== M.START) this.newTab(url).catch(() => {});
          });
          break;
      }
      await publish("ready", { prepared: manager.prepared?.summary || null });
    } catch (error) {
      if (v.cmd === "extension_open") this.notify(error.message);
      await publish("error", { error: error.message, prepared: manager.prepared?.summary || null });
    } finally {
      manager.busy = false;
    }
  }
  async configureShield() {
    await this.bridge.request({
      cmd: "filter_configure",
      enabled: this.state.settings.shield_enabled,
      exceptions: this.state.settings.shield_exceptions,
    });
    this.snapshotProtection();
    this.activeView()?.reload();
  }
  async resources() {
    const count = os.cpus().length,
      metrics = app.getAppMetrics();
    const workers = [
      { pid: this.bridge.child.pid, id: "Serviço Rust" },
      ...(this.appState?.running || []),
    ];
    const rows = metrics.map((m) => ({
      pid: m.pid,
      name: m.name || m.type,
      group: "Chromium e interface",
      exe: "compass-browser",
      cpu_percent: m.cpu.percentCPUUsage / count,
    }));
    for (const worker of workers)
      if (worker.pid && !rows.some((r) => r.pid === worker.pid))
        rows.push({
          pid: worker.pid,
          name: worker.id || "App Rust",
          group: "Apps nativos",
          exe: "noise-worker",
          cpu_percent: null,
        });
    for (const row of rows) {
      row.private_bytes = null;
      row.private_working_set_bytes = null;
      row.working_set_bytes = null;
      try {
        const data = fs.readFileSync(`/proc/${row.pid}/smaps_rollup`, "utf8"),
          kb = (name) =>
            Number(
              data.match(new RegExp("^" + name + ":\\s+(\\d+)", "m"))?.[1] || 0,
            ) * 1024;
        row.private_working_set_bytes =
          kb("Private_Clean") + kb("Private_Dirty");
        row.working_set_bytes = kb("Rss");
      } catch {}
    }
    const totals = {
      cpu_percent: rows.reduce((n, r) => n + (r.cpu_percent || 0), 0),
      private_working_set_bytes: rows.every(
        (r) => r.private_working_set_bytes != null,
      )
        ? rows.reduce((n, r) => n + r.private_working_set_bytes, 0)
        : null,
      private_bytes: null,
    };
    this.call("resources", {
      sampled_at: Date.now(),
      cpu_count: count,
      totals,
      processes: rows,
      process_count: rows.length,
      sampled_processes: rows.filter((r) => r.working_set_bytes != null).length,
      truncated: false,
    });
  }
  async shutdown() {
    if (this.stopping) return this.stopping;
    this.quit = true;
    this.stopping = (async () => {
      clearInterval(this.updateTimer);
      clearInterval(this.playbackTimer);
      this.flush();
      for (const p of this.permissionRequests.values()) {
        clearTimeout(p.timer);
        p.callback(false);
      }
      this.permissionRequests.clear();
      for (const item of this.downloads.values()) item.cancel();
      for (const id of [...this.views.keys()]) this.destroyView(id);
      await this.extensions?.cancel();
      await this.bridge.close();
      await session.fromPartition("persist:compass-sites").cookies.flushStore();
      if (this.powerId != null) powerSaveBlocker.stop(this.powerId);
    })();
    return this.stopping;
  }
}
