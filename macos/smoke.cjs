"use strict";
const assert = require("node:assert/strict");
const { app, webContents } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

module.exports = async (win, bridge, directory) => {
  const ui = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await ui(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Interface condition failed: " + code);
  };
  let sequence = 900;
  function request(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        bridge.off("app", onEvent);
        reject(Error("Timed out: " + method));
      }, 10000);
      function onEvent({ event }) {
        if (event.app_id !== "spotify" || event.payload.id !== id) return;
        bridge.off("app", onEvent);
        clearTimeout(timer);
        if (event.payload.error) reject(Error(JSON.stringify(event.payload.error)));
        else resolve(event.payload.result);
      }
      bridge.on("app", onEvent);
      bridge.request({ cmd: "apps_request", id: "spotify", request_id: id, method, params })
        .catch((error) => {
          bridge.off("app", onEvent);
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  await wait("!!document.querySelector('.spotify-app')");
  assert.equal(await ui("document.title"), "Noise Music");
  assert.equal(await ui("document.querySelectorAll('#address, #tabs, #app-store, webview, iframe').length"), 0);
  assert.equal(await ui("typeof require + ':' + typeof process + ':' + typeof window.ipc.postMessage"),
    "undefined:undefined:function");
  assert.deepEqual(webContents.getAllWebContents().map((contents) => contents.id), [win.webContents.id]);
  const restore = process.argv.includes("--smoke-restore");
  if (!restore) await request("scan_local");
  const list = await request("list");
  const local = list.local_tracks.find((track) => track.title === "Noise fixture");
  assert(local, "The WAV fixture should appear in the local library.");
  await wait("document.body.innerText.includes('Noise fixture')");
  if (restore) {
    assert.notEqual(list.player.state, "playing");
  } else {
    assert.equal((await request("play_local", { id: local.id })).player.state, "playing");
    assert.equal((await request("pause")).player.state, "paused");
    const remote = await bridge.request({ cmd: "music_remote", enabled: true });
    assert.equal(remote.enabled, true);
    const panel = await fetch("http://127.0.0.1:" + remote.port + "/");
    assert.equal(panel.status, 200);
    assert.equal((await bridge.request({ cmd: "music_remote", enabled: false })).enabled, false);
    const image = await win.capturePage();
    fs.writeFileSync(path.join(directory, "music.png"), image.toPNG());
  }
  console.log(restore ? "Noise Music restored the library without autoplay." :
    "Standalone UI, local audio, sandboxing and Wi-Fi panel verified.");
  app.quit();
};
