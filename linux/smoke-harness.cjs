"use strict";
// Runs only with --smoke-test and a fresh /tmp/compass-smoke-* profile. No accounts.
module.exports = async function (host, directory) {
  const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    http = require("node:http");
  const { app, webContents } = require("electron");
  const checks = [];
  const wait = async (fn, label, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 60));
    }
    throw Error("Timed out: " + label);
  };
  const check = (name) => checks.push(name);
  if (process.argv.includes("--smoke-restore")) {
    try {
      await wait(() => host.uiReady, "restored chrome");
      assert(
        host.state.history.some((h) => h.title === "Compass Ubuntu fixture"),
      );
      const ses = require("electron").session.fromPartition(
        "persist:compass-sites",
      );
      assert(
        (await ses.cookies.get({ name: "compass_fixture" })).some(
          (c) => c.value === "retained",
        ),
      );
      const extension = host.extensions.list().find((item) => item.name === "Compass extension fixture");
      assert(extension?.enabled);
      await host.command({ cmd: "extensions_remove", id: extension.id });
      assert(!host.extensions.list().some((item) => item.id === extension.id));
      await host.command({ cmd: "apps_open", id: "spotify" });
      const state = await wait(
        () => host.appState?.responses?.spotify?.payload?.result,
        "restored music worker",
      );
      assert(state.local_tracks.some((t) => t.title === "Ubuntu fixture"));
      assert(state.player.track_id != null);
      assert.notEqual(state.player.state, "playing");
      const report = JSON.parse(
        fs.readFileSync(path.join(directory, "result.json")),
      );
      report.checks.push(
        "second launch restores browser history, site cookies and paused Noise track",
        "enabled extension persists across launches and can be removed",
      );
      fs.writeFileSync(
        path.join(directory, "result.json"),
        JSON.stringify(report, null, 2),
      );
      await host.shutdown();
      host.win.destroy();
      app.quit();
      return;
    } catch (error) {
      fs.writeFileSync(
        path.join(directory, "result.json"),
        JSON.stringify({ success: false, error: error.stack, checks }, null, 2),
      );
      await host.shutdown();
      app.exit(1);
      return;
    }
  }
  const server = http.createServer((req, res) => {
    if (req.url === "/file") {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename=compass-fixture.txt",
        "Content-Length": "65536",
      });
      res.end(Buffer.alloc(65536, 65));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Set-Cookie":
        "compass_fixture=retained; Path=/; Max-Age=3600; SameSite=Lax",
    });
    res.end(
      '<!doctype html><title>Compass Ubuntu fixture</title><h1>Ubuntu sandbox fixture</h1><a href="/next" target="_blank">New tab</a><a href="/file">Download</a><script>document.documentElement.dataset.privilege=typeof require+":"+typeof process+":"+typeof window.ipc</script>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    await wait(() => host.uiReady, "chrome ready");
    assert.equal(
      await host.win.webContents.executeJavaScript(
        "typeof window.mare?.receive",
      ),
      "function",
    );
    check("real packaged UI and privileged preload loaded");
    const tab = await host.newTab(url);
    let wc = host.views.get(tab.id).webContents;
    await wait(
      () => !wc.isLoading() && wc.getTitle() === "Compass Ubuntu fixture",
      "fixture loaded",
    );
    assert.equal(
      await wc.executeJavaScript("document.documentElement.dataset.privilege"),
      "undefined:undefined:undefined",
    );
    assert.equal(wc.getLastWebPreferences().sandbox, true);
    assert.equal(wc.getLastWebPreferences().contextIsolation, true);
    check(
      "remote pages have no Node, process or privileged IPC; sandbox enabled",
    );
    const view = host.views.get(tab.id);
    await wait(() => view.getBounds().y > 0, "normal toolbar bounds");
    const normalBounds = view.getBounds();
    wc.focus();
    await wc.executeJavaScript("document.body.requestFullscreen()", true);
    await wait(() => host.fullscreenTab === tab.id, "HTML fullscreen");
    await wait(() => {
      const [width, height] = host.win.getContentSize();
      const bounds = view.getBounds();
      return bounds.x === 0 && bounds.y === 0 &&
        bounds.width === width && bounds.height === height;
    }, "fullscreen fills the window");
    wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await wait(() => host.fullscreenTab === null, "Escape leaves fullscreen");
    await wait(() => view.getBounds().y === normalBounds.y, "normal toolbar restored");
    check("HTML fullscreen covers browser chrome and Escape restores the tab");
    const before = host.state.tabs.length;
    await wc.executeJavaScript("document.querySelector('a').click()");
    await wait(
      () => host.state.tabs.length === before + 1,
      "popup routed to tab",
    );
    check("new-window links open isolated Compass tabs");
    await host.command({ cmd: "activate", id: tab.id });
    wc.downloadURL(url + "/file");
    await wait(
      () => host.state.downloads.some((d) => d.status === "completed"),
      "real download",
    );
    const download = host.state.downloads.find((d) => d.status === "completed");
    assert.equal(fs.statSync(download.path).size, 65536);
    assert.equal(download.received, 65536);
    check("download completes with file path and byte progress");
    await wc.executeJavaScript(
      "document.body.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:80,clientY:80}))",
    );
    // Verify the native compositor raises local panels above the page while retaining its image.
    await host.win.webContents.executeJavaScript("window.mare.showSettings()");
    await wait(() => host.overlay, "settings overlay");
    assert(!host.views.get(tab.id).getVisible());
    await host.win.webContents.executeJavaScript("window.mare.dismiss()");
    await wait(() => !host.overlay, "settings dismissed");
    check("trusted settings panels appear above web pages and dismiss cleanly");
    const privateTab = await host.newTab(url + "/private", true);
    const privateWC = host.views.get(privateTab.id).webContents;
    await wait(() => !privateWC.isLoading(), "private tab");
    host.flush();
    const persisted = JSON.parse(fs.readFileSync(host.file));
    assert(
      !persisted.tabs.some((t) => t.private || t.url.endsWith("/private")),
    );
    assert(!persisted.history.some((t) => t.url.endsWith("/private")));
    check("private tabs and history excluded from disk");
    await host.command({ cmd: "activate", id: tab.id });
    host.closeTab(privateTab.id);
    const filter = await host.bridge.request({
      cmd: "filter",
      tab: tab.id,
      url: "https://googleads.g.doubleclick.net/pagead/ads",
      type: "script",
      method: "GET",
      referer: url,
    });
    assert.equal(filter.cancel, true);
    check("adblock-rust checks real filter lists");
    const { createHash, generateKeyPairSync } = require("node:crypto");
    const { publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    const id = [...createHash("sha256").update(publicKey).digest().subarray(0, 16)]
      .flatMap((byte) => [byte >> 4, byte & 15])
      .map((nibble) => String.fromCharCode(97 + nibble)).join("");
    const staging = fs.mkdtempSync(path.join(host.extensions.directory, ".review-"));
    const payload = path.join(staging, "pending-" + id);
    fs.mkdirSync(payload);
    const extension = { id, name: "Compass extension fixture", version: "1.0", popup: "popup.html", permissions: [] };
    fs.writeFileSync(path.join(payload, "manifest.json"), JSON.stringify({
      name: extension.name,
      version: extension.version,
      manifest_version: 3,
      key: publicKey.toString("base64"),
      action: { default_popup: extension.popup },
      content_scripts: [{ matches: ["http://127.0.0.1/*"], js: ["content.js"] }],
    }));
    fs.writeFileSync(path.join(payload, "content.js"), 'document.body.dataset.compassExtension = "loaded";');
    fs.writeFileSync(path.join(payload, extension.popup), "<p>Compass extension popup</p>");
    host.extensions.prepared = { directory: staging, summary: extension };
    await host.command({ cmd: "extensions_install" });
    assert(host.extensions.list().find((item) => item.id === id)?.enabled);
    wc.reload();
    await wait(() => wc.executeJavaScript('document.body?.dataset.compassExtension === "loaded"'), "extension content script");
    await host.command({ cmd: "extension_open", id });
    const popup = host.extensions.popups.get(id);
    assert(popup);
    assert.equal(await popup.webContents.executeJavaScript("typeof window.ipc"), "undefined");
    await host.command({ cmd: "extensions_enable", id, enabled: false });
    assert(!host.extensions.list().find((item) => item.id === id).enabled);
    await host.command({ cmd: "extensions_enable", id, enabled: true });
    assert(host.extensions.list().find((item) => item.id === id).enabled);
    const separate = await host.newTab(url + "/extension-private", true);
    const separateWC = host.views.get(separate.id).webContents;
    await wait(() => separateWC.getTitle() === "Compass Ubuntu fixture", "extension private tab");
    assert.equal(await separateWC.executeJavaScript("document.body.dataset.compassExtension"), undefined);
    host.closeTab(separate.id);
    await host.command({ cmd: "activate", id: tab.id });
    check("Chromium installs, runs, opens and toggles extensions only in the regular profile");
    // Keep streaming tests independent of an account, a live catalog and hardware audio.
    const music = await host.win.webContents.executeJavaScript(`(async () => {
      const tracks = [{ id: 1, title: "Local fixture", available: true },
        { id: 2, title: "Streaming fixture", streamable: true, track_uri: "spotify:track:fixture" }];
      const snapshot = { local_tracks: tracks, entries: [], collections: [],
        session: { order: [1, 2], original: [1, 2], position: 0 },
        player: { volume: 80 } };
      let persistedVolume;
      const view = createSpotifyView({
        request: async (method, params) => {
          if (method === "volume") persistedVolume = params.value;
          if (method === "cloud_stream") return { state: "preparing" };
          return snapshot;
        },
        send() {}, notify() {}, icon: () => "", isOpen: () => true,
      });
      document.body.append(view.element);
      try {
        await view.load();
        const row = view.element.querySelector(".music-next [data-action=queue_play]");
        row?.click();
        const slider = view.element.querySelector(".music-volume-slider");
        slider.value = "30";
        slider.dispatchEvent(new Event("change"));
        await new Promise(resolve => setTimeout(resolve, 150));
        const audio = document.querySelector("audio[data-noise-stream]");
        return { title: row?.querySelector("strong").textContent, persistedVolume, gain: audio.volume };
      } finally {
        view.dispose();
        view.element.remove();
      }
    })()`);
    assert.equal(music.title, "Streaming fixture");
    assert.equal(music.persistedVolume, 30);
    assert(Math.abs(music.gain - 0.09) < 0.0001);
    check("streaming tracks render in the queue and the volume slider changes streaming gain");
    // Seed one local WAV in the same account-free library path the native scanner uses.
    const audio = path.join(directory, "profile/apps/spotify/audio");
    fs.mkdirSync(audio, { recursive: true });
    const pcm = Buffer.alloc(44100 * 2 * 2),
      wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(44100, 24);
    wav.writeUInt32LE(88200, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(pcm.length, 40);
    pcm.copy(wav, 44);
    fs.writeFileSync(path.join(audio, "Ubuntu fixture.wav"), wav);
    const request = async (method, params = {}) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          host.bridge.off("app", listener);
          reject(Error("Native response timeout: " + method));
        }, 12000);
        const listener = (v) => {
          if (v.event?.payload?.id === id) {
            clearTimeout(timer);
            host.bridge.off("app", listener);
            resolve(v.event.payload);
          }
        };
        host.bridge.on("app", listener);
      });
      await host.bridge.request({
        cmd: "apps_request",
        id: "spotify",
        request_id: id,
        method,
        params,
      });
      const result = await response;
      if (result.error)
        throw Error(method + ": " + JSON.stringify(result.error));
      return result.result;
    };
    // Exercise the renderer->preload->main->Rust bridge, not a duplicate UI.
    await host.win.webContents.executeJavaScript(
      "window.ipc.postMessage(JSON.stringify({cmd:'apps_install',id:'spotify'}))",
    );
    await wait(
      () => host.appState.catalog.find((a) => a.id === "spotify")?.installed,
      "Noise installed",
    );
    await host.win.webContents.executeJavaScript(
      "window.ipc.postMessage(JSON.stringify({cmd:'apps_open',id:'spotify'}))",
    );
    await wait(() => host.appState.active_id === "spotify", "Noise opened");
    const result = await request("scan_local");
    const list = await request("list");
    const local =
      list.tracks?.find((t) => t.title === "Ubuntu fixture") ||
      list.local_tracks?.find((t) => t.title === "Ubuntu fixture");
    assert(local, "Native scanner should list the local WAV");
    await request("play_local", { id: local.id });
    await new Promise((r) => setTimeout(r, 200));
    await request("pause");
    check("Noise native worker scans and plays local audio through ALSA");
    await wait(
      () =>
        host.win.webContents.executeJavaScript(
          "!!document.querySelector('.sp-shell, .spotify-app, .sp-app, .spotify-view')",
        ),
      "Noise UI",
    );
    assert.equal(
      await host.win.webContents.executeJavaScript(
        "typeof window.ipc.postMessage",
      ),
      "function",
    );
    const leaked = await wc.executeJavaScript("typeof window.ipc");
    assert.equal(leaked, "undefined");
    check(
      "Noise shares the existing desktop interface while page IPC remains isolated",
    );
    await host.command({ cmd: "apps_install", id: "notes" });
    await host.command({ cmd: "apps_open", id: "notes" });
    await wait(
      () =>
        host.win.webContents.executeJavaScript(
          "!!document.querySelector('.notes-sidebar')",
        ),
      "notes UI",
    );
    check("native Notes interface opens");
    await host.command({ cmd: "apps_open", id: "spotify" });
    await new Promise((r) => setTimeout(r, 600));
    const image = await host.win.capturePage();
    fs.writeFileSync(path.join(directory, "screenshot.png"), image.toPNG());
    const cookies = await wc.session.cookies.get({ url });
    assert(cookies.some((c) => c.name === "compass_fixture"));
    await wc.session.cookies.flushStore();
    check("normal site cookies saved in the Linux user's session");
    host.flush();
    const report = {
      success: true,
      checks,
      ui_errors: host.errors,
      chromium: process.versions.chrome,
      electron: process.versions.electron,
      sandbox: true,
    };
    fs.writeFileSync(
      path.join(directory, "result.json"),
      JSON.stringify(report, null, 2),
    );
    await host.shutdown();
    host.win.destroy();
    app.quit();
  } catch (error) {
    fs.writeFileSync(
      path.join(directory, "result.json"),
      JSON.stringify(
        { success: false, error: error.stack, checks, ui_errors: host.errors },
        null,
        2,
      ),
    );
    try {
      const image = await host.win.capturePage();
      fs.writeFileSync(path.join(directory, "screenshot.png"), image.toPNG());
    } catch {}
    await host.shutdown();
    app.exit(1);
  } finally {
    server.close();
  }
};
