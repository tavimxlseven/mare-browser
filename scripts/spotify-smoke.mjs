import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
const exe = resolve(
  process.argv.find((a) => a.startsWith("--exe="))?.slice(6) ||
    "dist/Mare/Mare.exe",
);
const directory = await mkdtemp(join(tmpdir(), "mare-spotify-smoke-"));
let child,
  sequence = 0,
  pending = new Map();
function start() {
  child = spawn(exe, ["--native-app", "spotify", "--data-dir", directory], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const result = JSON.parse(line),
      request = pending.get(result.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(result.id);
      result.error
        ? request.reject(Error(result.error.message))
        : request.resolve(result.result);
    }
  });
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Timeout ${method}`));
      }, 12000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
async function stop() {
  const closed = once(child, "close");
  child.stdin.end();
  const [code] = await closed;
  assert.equal(code, 0);
}
try {
  start();
  assert.equal((await call("hello")).playback_available, false);
  const url = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";
  let state = await call("save_link", { url, title: "Local test fixture" });
  const uri = state.entries[0].uri;
  await call("favorite", { uri });
  await call("create_collection", { name: "Test collection" });
  await call("set_collection", { uri, collection: 1 });
  await assert.rejects(
    call("save_link", { url: "https://example.org/not-spotify" }),
  );
  await stop();
  start();
  state = await call("list");
  assert.equal(state.entries[0].favorite, true);
  assert.equal(state.entries[0].collection, 1);
  const delta = await call("playback_status", {
    revision: state.library_revision,
  });
  assert.ok(delta.player);
  assert.equal(delta.local_tracks, undefined);
  assert.equal(delta.entries, undefined);
  if (!state.account.configured) await assert.rejects(call("account_begin"));
  if (process.argv.includes("--audio")) {
    const audio = join(directory, "audio");
    await mkdir(audio, { recursive: true });
    const rate = 22050,
      seconds = 24,
      pcmBytes = rate * seconds * 2,
      bytes = Buffer.alloc(44 + pcmBytes);
    bytes.write("RIFF");
    bytes.writeUInt32LE(36 + pcmBytes, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(rate, 24);
    bytes.writeUInt32LE(rate * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(pcmBytes, 40);
    await writeFile(join(audio, "Silent local QA fixture.wav"), bytes);
    state = await call("scan_local");
    assert.equal(state.local_tracks.length, 1);
    state = await call("play_local", { id: state.local_tracks[0].id });
    assert.equal(state.player.state, "playing");
    assert.ok(state.player.duration_ms >= 23000);
    state = await call("pause");
    assert.equal(state.player.state, "paused");
    state = await call("seek", { position_ms: 5000 });
    assert.ok(state.player.position_ms >= 4900);
    state = await call("volume", { value: 20 });
    assert.equal(state.player.volume, 20);
    state = await call("resume");
    assert.equal(state.player.state, "playing");
    state = await call("stop");
    assert.equal(state.player.track_id, null);
    console.log(
      "PASS native Windows audio: silent WAV decode, play/pause, seek, volume, resume and stop",
    );
  }
  if (process.argv.includes("--components")) {
    state = await call("download", { url });
    assert.equal(state.download.state, "running");
    const downloaderPid = state.downloader_pid;
    assert.ok(downloaderPid > 0);
    const repeated = await call("download", { url, play_after: true });
    assert.equal(repeated.downloader_pid, downloaderPid);
    state = await call("cancel_download");
    assert.equal(state.download.state, "cancelled");
    assert.equal(state.downloader_pid, null);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.throws(() => process.kill(downloaderPid, 0));
    console.log(
      "PASS bundled Sunnify starts without a window and explicit cancellation reaps its process (no audio downloaded)",
    );
  }
  if (process.argv.includes("--online")) {
    state = await call("import_link", { url });
    assert.notEqual(state.entries[0].title, "Local test fixture");
    assert.ok(
      [
        "i.scdn.co",
        "image-cdn-ak.spotifycdn.com",
        "image-cdn-fa.spotifycdn.com",
      ].includes(new URL(state.entries[0].thumbnail).hostname),
    );
    console.log(
      "PASS official public Spotify metadata:",
      state.entries[0].title,
    );
  }
  if (process.argv.includes("--audio")) {
    await stop();
    const indexPath = join(directory, "downloaded.json");
    const tracks = JSON.parse(await readFile(indexPath, "utf8"));
    tracks[0].source_uri = uri;
    await writeFile(indexPath, JSON.stringify(tracks));
    await writeFile(
      join(directory, "completed-downloads.json"),
      JSON.stringify([uri]),
    );
    start();
    state = await call("download", { url, play_after: true });
    assert.equal(state.downloader_pid, null);
    assert.equal(state.player.state, "playing");
    assert.deepEqual(state.completed_sources, [uri]);
    await assert.rejects(call("delete_local", { id: 999999 }));
    const deletedId = state.local_tracks[0].id;
    state = await call("delete_local", { id: deletedId });
    assert.equal(state.local_tracks.length, 0);
    assert.equal(state.player.track_id, null);
    assert.deepEqual(state.completed_sources, []);
    await stop();
    start();
    assert.equal((await call("list")).local_tracks.length, 0);
    console.log(
      "PASS deleting a playing completed download stops playback and persists an empty index",
    );
    console.log(
      "PASS confirmed download survives restart and plays without starting another downloader",
    );
  }
  await call("remove", { uri });
  assert.equal((await call("list")).entries.length, 0);
  await stop();
  assert.equal(
    JSON.parse(await readFile(join(directory, "library.json"), "utf8")).entries
      .length,
    0,
  );
  console.log(
    "PASS Spotify worker: normalization, local collections/favorites, restart, rejected links, removal and EOF",
  );
} finally {
  for (const value of pending.values()) {
    clearTimeout(value.timer);
    value.reject(Error("Test ended"));
  }
  if (child && child.exitCode === null) child.kill();
}
