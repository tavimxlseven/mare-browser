// End-to-end smoke against a fresh, isolated profile. Downloads a public store extension.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { connect, until, CDP } from "./lib/cdp.mjs";
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return [arg.slice(0, i), arg.slice(i + 1)];
  }),
);
const root =
  args.get("--profile") ||
  (await fs.mkdtemp(join(tmpdir(), "mare-release-qa-")));
assert.ok(
  isAbsolute(root) && /qa|smoke/i.test(root),
  "Use an absolute disposable QA profile",
);
await assert.rejects(
  fs.stat(join(root, "state.json")),
  "Refusing to reuse an existing browser profile",
);
const exe = resolve(args.get("--exe") || "dist/Mare/Mare.exe");
await fs.mkdir(root + "/apps/spotify/audio", { recursive: true });
const rate = 22050,
  n = rate * 60 * 2,
  wav = Buffer.alloc(44 + n);
wav.write("RIFF");
wav.writeUInt32LE(36 + n, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(n, 40);
await fs.writeFile(root + "/apps/spotify/audio/deletion-fixture.wav", wav);
await fs.writeFile(
  root + "/apps/spotify/downloaded.json",
  JSON.stringify([
    {
      id: 1,
      title: "Silent deletion fixture",
      artists: "Maré QA",
      path: root + "/apps/spotify/audio/deletion-fixture.wav",
      source_uri: "",
      track_uri: "",
      artwork: "",
    },
  ]),
);
const server = createServer((req, res) => {
  if (req.url.startsWith("/sound")) {
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": wav.length,
    });
    return res.end(wav);
  }
  if (req.url.startsWith("/favicon")) {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    return res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    );
  }
  if (req.url === "/cookie") {
    res.writeHead(200, {
      "Set-Cookie":
        "MareFixture=qa-persistent-cookie; Max-Age=3600; HttpOnly; SameSite=Lax",
    });
    return res.end("ok");
  }
  if (req.url === "/echo") {
    return res.end(req.headers.cookie || "");
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    '<!doctype html><link rel="icon" href="/favicon.svg"><title>Mare media QA</title><audio src="/sound.wav" controls></audio><script>document.addEventListener("visibilitychange",()=>{if(document.hidden)document.querySelector("audio").pause()});</script>',
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let child, c, page;
async function launch(path) {
  child = spawn(path, [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      MARE_DATA_DIR: root,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9260",
    },
  });
  await until(
    "debug endpoint",
    async () => {
      try {
        c = await connect(9260);
        return true;
      } catch {
        return false;
      }
    },
    30000,
  );
  await c.call("Runtime.enable");
  await c.eval(
    `window.__finalQA={state:null,extensions:[]};var rxFinal=window.mare.receive;window.mare.receive=s=>{window.__finalQA.state=typeof s==='string'?JSON.parse(s):s;rxFinal(s)};var extFinal=window.mare.extensionsEvent;window.mare.extensionsEvent=v=>{window.__finalQA.extensions.push(v);extFinal(v)};true`,
  );
  await c.ipc({ cmd: "ready" });
  await until("state", () => c.eval("!!window.__finalQA.state"));
}
async function remote(url) {
  let wsURL;
  for (const host of ["127.0.0.1", "[::1]"]) {
    try {
      const targets = await fetch(`http://${host}:9260/json/list`).then((r) =>
        r.json(),
      );
      wsURL = targets.find((t) => t.url === url)?.webSocketDebuggerUrl;
      if (wsURL) break;
    } catch {}
  }
  if (!wsURL) return null;
  const ws = new WebSocket(wsURL);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return new CDP(ws);
}
async function close() {
  const closed = once(child, "exit");
  await c.eval("window.mare.requestClose();true").catch(() => {});
  c.close();
  page?.close();
  await closed;
  await delay(1000);
}
const checks = [];
try {
  await launch(exe);
  await c.ipc({ cmd: "navigate", url: base + "/first" });
  await until("page", async () => {
    page = await remote(base + "/first");
    return !!page;
  });
  await page.eval("document.readyState");
  await until("audio element", () =>
    page.eval('!!document.querySelector("audio")'),
  );
  await page.eval(
    `(async()=>{localStorage.setItem('mare-fixture','persisted');await fetch('/cookie');await new Promise((resolve,reject)=>{let r=indexedDB.open('mare-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('values');r.onsuccess=()=>{let db=r.result,t=db.transaction('values','readwrite');t.objectStore('values').put('saved','key');t.oncomplete=()=>{db.close();resolve()};t.onerror=reject};r.onerror=reject});return true})()`,
  );
  await until("favicon decoded", () =>
    c.eval(
      'Array.from(document.querySelectorAll("img.site-image")).some(i=>i.naturalWidth>0)',
    ),
  );
  checks.push("Native page favicons decode in browser chrome");
  console.log(checks.at(-1));
  await page.call("Runtime.evaluate", {
    expression: 'document.querySelector("audio").play()',
    awaitPromise: true,
    userGesture: true,
  });
  await until("media playing", () =>
    page.eval('!document.querySelector("audio").paused'),
  );
  await delay(400);
  const firstId = await c.eval("window.__finalQA.state.active_id");
  const before = await page.eval('document.querySelector("audio").currentTime');
  await c.ipc({ cmd: "new_tab", url: base + "/second" });
  const secondId = await until("second tab", () =>
    c.eval(
      `window.__finalQA.state.active_id!==${firstId}&&window.__finalQA.state.active_id`,
    ),
  );
  await delay(1200);
  assert.equal(
    await page.eval('document.querySelector("audio").paused'),
    false,
  );
  await until(
    "background playback advances",
    () =>
      page.eval(`document.querySelector('audio').currentTime>${before + 0.7}`),
    8000,
  );
  checks.push(
    "A site that pauses on document.hidden keeps playing while another web tab is active",
  );
  console.log(checks.at(-1));
  await c.ipc({ cmd: "apps_install", id: "spotify" });
  await c.ipc({ cmd: "apps_open", id: "spotify" });
  await until("music ready", () =>
    c.eval('!!document.querySelector(".spotify-library")'),
  );
  await delay(700);
  assert.equal(
    await page.eval('document.querySelector("audio").paused'),
    false,
  );
  assert.equal(
    await c.eval('document.querySelector(".music-account").hidden'),
    true,
  );
  await c.click("[data-filter=downloaded]");
  await until("delete row", () =>
    c.eval('!!document.querySelector("[data-action=delete_local]")'),
  );
  await c.click("[data-action=delete_local]");
  await until("delete dialog", () =>
    c.eval('!!document.querySelector("[data-confirm-delete]")'),
  );
  await c.click("[data-confirm-delete]");
  await until("delete done", () =>
    c.eval('!document.querySelector("[data-action=delete_local]")'),
  );
  await assert.rejects(
    fs.stat(root + "/apps/spotify/audio/deletion-fixture.wav"),
  );
  checks.push(
    "Music delete action removes its file, retains library navigation and account login stays hidden",
  );
  console.log(checks.at(-1));
  const started = performance.now();
  for (let i = 0; i < 30; i++)
    await c.ipc({ cmd: "activate", id: i % 2 ? firstId : secondId });
  await c.ipc({ cmd: "apps_open", id: "spotify" });
  await c.ipc({ cmd: "apps_close", id: "spotify" });
  await delay(500);
  assert.equal(
    await page.eval('document.querySelector("audio").paused'),
    false,
  );
  checks.push(
    `30 rapid tab switches and music close completed without pausing media (${Math.round(performance.now() - started)} ms including 500 ms settle)`,
  );
  console.log(checks.at(-1));
  await c.click("#performance-button");
  await until("performance rows", () =>
    c.eval('document.querySelectorAll("#resource-rows tr").length>0'),
  );
  await c.click("[data-dialog-close]");
  checks.push(
    "Performance toolbar button samples browser and WebView processes",
  );
  console.log(checks.at(-1));
  await c.click("#extensions-button");
  await c.ipc({
    cmd: "extensions_prepare",
    url: "https://chromewebstore.google.com/detail/google-translate/aapbdbdomjkkjkaonfhkkikfgjllcleb",
  });
  await until(
    "extension review",
    () => c.eval('!!document.querySelector("[data-extension-confirm]")'),
    45000,
  );
  await c.click("[data-extension-confirm]");
  await until(
    "extension installed",
    () =>
      c.eval(
        'window.__finalQA.extensions.some(e=>e.items?.some(i=>i.id==="aapbdbdomjkkjkaonfhkkikfgjllcleb"))',
      ),
    30000,
  );
  checks.push(
    "A real signed Chrome Web Store extension is installed and reported by WebView2",
  );
  console.log(checks.at(-1));
  await c.click("[data-dialog-close]");
  await c.ipc({ cmd: "activate", id: firstId });
  await page.eval('document.querySelector("audio").pause()');
  await close();
  const relocated = root + "-relocated";
  await fs.mkdir(relocated, { recursive: true });
  await fs.copyFile(exe, relocated + "/Mare.exe");
  await fs
    .copyFile(
      join(dirname(exe), "WebView2Loader.dll"),
      relocated + "/WebView2Loader.dll",
    )
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  await launch(relocated + "/Mare.exe");
  await until("restored page", async () => {
    page = await remote(base + "/first");
    return !!page;
  });
  assert.equal(
    await page.eval('localStorage.getItem("mare-fixture")'),
    "persisted",
  );
  assert.ok(
    (await page.eval('fetch("/echo").then(r=>r.text())')).includes(
      "MareFixture=qa-persistent-cookie",
    ),
  );
  assert.equal(
    await page.eval(
      `new Promise((resolve,reject)=>{let r=indexedDB.open('mare-fixture',1);r.onsuccess=()=>{let db=r.result,t=db.transaction('values');let q=t.objectStore('values').get('key');q.onsuccess=()=>{db.close();resolve(q.result)}};r.onerror=reject})`,
    ),
    "saved",
  );
  checks.push(
    "Public tabs, persistent HttpOnly cookie, localStorage and IndexedDB survive restart from a different executable folder",
  );
  console.log(checks.at(-1));
  await c.click("#extensions-button");
  await until("extension survived restart", () =>
    c.eval(
      'window.__finalQA.extensions.some(e=>e.items?.some(i=>i.id==="aapbdbdomjkkjkaonfhkkikfgjllcleb"&&i.enabled))',
    ),
  );
  await c.ipc({
    cmd: "extensions_enable",
    id: "aapbdbdomjkkjkaonfhkkikfgjllcleb",
    enabled: false,
  });
  await until("disabled", () =>
    c.eval(
      'window.__finalQA.extensions.at(-1)?.items?.some(i=>i.id==="aapbdbdomjkkjkaonfhkkikfgjllcleb"&&!i.enabled)',
    ),
  );
  await c.ipc({
    cmd: "extensions_remove",
    id: "aapbdbdomjkkjkaonfhkkikfgjllcleb",
  });
  await until("removed", () =>
    c.eval("window.__finalQA.extensions.at(-1)?.items?.length===0"),
  );
  checks.push(
    "Extension registration survives restart; disable and removal both complete",
  );
  console.log(checks.at(-1));
  assert.deepEqual(c.errors, []);
  console.log(JSON.stringify({ checks, profile: root }));
  await close();
} finally {
  c?.close();
  page?.close();
  if (child?.exitCode === null) child.kill();
  server.close();
}
