"use strict";
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, net, shell, powerSaveBlocker } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Bridge } = require("./bridge.cjs");
const updates = require("./updates.cjs");

const entry = path.join(__dirname, "index.html");
const entryURL = pathToFileURL(entry).href;
const smokeDirectory = process.argv.includes("--smoke-test") &&
  /^\/tmp\/noise-smoke-[\w-]+$/.test(process.env.NOISE_SMOKE_DIR || "")
  ? process.env.NOISE_SMOKE_DIR : null;
app.setName("Noise Music");
const profile = smokeDirectory ? path.join(smokeDirectory, "profile") :
  path.join(app.getPath("appData"), "Noise Music");
fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
app.setPath("userData", profile);

let win, bridge, power, closing, checking;
function call(method, arg) {
  if (!win || win.isDestroyed()) return Promise.resolve();
  return win.webContents.executeJavaScript(
    `window.mare?.[${JSON.stringify(method)}]?.(${JSON.stringify(arg)})`,
  ).catch(() => {});
}
function updatePower(active) {
  if (active && power == null) power = powerSaveBlocker.start("prevent-app-suspension");
  if (!active && power != null) {
    powerSaveBlocker.stop(power);
    power = null;
  }
}
function externalURL(command, input) {
  if (typeof input !== "string" || input.length > 4096) return;
  const spotify = /^spotify:(track|album|artist|playlist|show|episode):([A-Za-z0-9]{22})$/.exec(input);
  const youtube = /^youtube:video:([A-Za-z0-9_-]{11})$/.exec(input);
  if (command === "spotify_open") {
    if (spotify) return `https://open.spotify.com/${spotify[1]}/${spotify[2]}`;
    if (youtube) return `https://www.youtube.com/watch?v=${youtube[1]}`;
  }
  const url = URL.parse(input);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port) return;
  if (command === "new_tab" && url.hostname === "accounts.spotify.com" && url.pathname === "/authorize")
    return url.href;
  if (command === "spotify_open" && url.hostname === "open.spotify.com") return url.href;
}
async function checkUpdates(manual) {
  if (checking) return;
  checking = true;
  try {
    const update = await updates.check(net.fetch, app.getVersion(), process.arch);
    if (closing || win.isDestroyed()) return;
    if (!update) {
      if (manual) await dialog.showMessageBox(win, { message: "O Noise Music está atualizado." });
      return;
    }
    const result = await dialog.showMessageBox(win, {
      message: `Noise Music ${update.version} disponível`,
      detail: "Baixe a versão para Mac e substitua o aplicativo em Aplicativos.",
      buttons: ["Baixar", "Agora não"], cancelId: 1,
    });
    if (result.response === 0) await shell.openExternal(update.url);
  } catch (error) {
    if (manual) await call("notify", error.message);
  } finally {
    checking = false;
  }
}

async function start() {
  bridge = new Bridge(path.join(__dirname, "noise-worker"), profile, "--noise-host");
  bridge.on("app", ({ event }) => {
    if (event.app_id !== "spotify") return;
    if (event.kind === "exited") updatePower(false);
    const playback = event.payload?.result?.player;
    if (playback) updatePower(playback.state === "playing");
    void call("appEvent", event);
  });
  bridge.on("remote_status", ({ status }) => call("remoteStatus", status));
  bridge.on("remote_action", ({ value }) => call("remoteMusic", value));
  bridge.on("closed", () => {
    if (!closing) void call("appEvent", { kind: "exited" });
  });
  const initial = await bridge.ready;
  if (!initial.catalog.some((item) => item.id === "spotify" && item.installed))
    await bridge.request({ cmd: "apps_install", id: "spotify" });
  await bridge.request({ cmd: "apps_open", id: "spotify" });
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 720, minHeight: 510,
    show: false, backgroundColor: "#0b0b0c", title: "Noise Music",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, backgroundThrottling: false,
    },
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  ipcMain.on("compass-command", async (event, text) => {
    if (event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame.url !== entryURL ||
        typeof text !== "string" || Buffer.byteLength(text) > 262144) return;
    try {
      const v = JSON.parse(text);
      switch (v?.cmd) {
        case "apps_request":
          try {
            await bridge.request({ cmd: v.cmd, id: "spotify", method: v.method,
              params: v.params, request_id: v.request_id });
          } catch (error) {
            await call("appEvent", { kind: "response", payload: { id: v.request_id, error: error.message } });
          }
          break;
        case "music_remote":
          await call("remoteStatus", await bridge.request({ cmd: v.cmd, enabled: v.enabled === true }));
          break;
        case "copy":
          if (typeof v.text === "string" && v.text.length <= 4096) {
            clipboard.writeText(v.text);
            await call("notify", "Link copiado.");
          }
          break;
        case "new_tab":
        case "spotify_open": {
          const url = externalURL(v.cmd, v.url);
          if (url) await shell.openExternal(url);
          break;
        }
      }
    } catch (error) {
      await call("notify", error.message);
    }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Noise Music", submenu: [
      { role: "about" }, { label: "Buscar atualizações…", click: () => checkUpdates(true) },
      { type: "separator" }, { role: "quit" },
    ] },
    { role: "editMenu" }, { role: "windowMenu" },
  ]));
  await win.loadFile(entry);
  win.show();
  if (smokeDirectory) await require("./smoke.cjs")(win, bridge, smokeDirectory);
  else void checkUpdates(false);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { win?.show(); win?.focus(); });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (!bridge || closing) return;
    event.preventDefault();
    closing = true;
    updatePower(false);
    void bridge.close().finally(() => app.quit());
  });
  app.whenReady().then(start).catch((error) => {
    if (smokeDirectory) console.error(error);
    else dialog.showErrorBox("Noise Music", error.message);
    void (bridge?.close() ?? Promise.resolve()).finally(() => app.exit(1));
  });
}
