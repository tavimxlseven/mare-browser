const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const commands = [];
const tracks = ["a", "b"].map((id) => ({ id, title: id, status: "ready" }));
const scope = {
  window: {},
  EventTarget,
  Event,
  Set,
  JSON,
  Date,
  Promise,
  MareNative: { postMessage: (raw) => commands.push(JSON.parse(raw)) },
  currentUser: { id: "first" },
  library: { tracks },
  current: tracks[0],
  queue: ["b"],
  playbackContext: ["a", "b"],
  repeat: "off",
  playHistory: [],
  offlineIds: new Set(),
  downloads: new Set(["b"]),
  drawPlayer() {},
  render() {},
  drawIsland() {},
  notice() {},
  local: () => Promise.resolve(),
};
scope.window.MareNative = scope.MareNative;
vm.runInNewContext(
  fs.readFileSync("mobile/public/native-player.js", "utf8"),
  scope,
);
const audio = scope.window.createMareNativeAudio();
assert.equal(audio.native, true);
audio.startTrack(tracks[0], 15);
assert.equal(commands[0].action, "start");
assert.equal(commands[0].position, 15000);
assert.deepEqual(commands[0].queue, ["b"]);
assert.equal(audio.paused, false);
audio.updateQueue();
assert.equal(
  commands.length,
  1,
  "unchanged progress must not rebuild the native queue",
);
scope.window.receiveMareNativeState({
  account: "other",
  id: "b",
  playing: true,
  queue: [],
  offline: ["b"],
});
assert.equal(scope.current.id, "a");
assert.equal(
  scope.offlineIds.size,
  0,
  "another account cannot expose offline files",
);
// The host completes the transition independently of JavaScript's ended event.
scope.window.receiveMareNativeState({
  account: "first",
  id: "a",
  playing: true,
  queue: ["b"],
  position: 16000,
  duration: 20000,
});
scope.window.receiveMareNativeState({
  account: "first",
  id: "b",
  playing: true,
  queue: [],
  position: 1000,
  duration: 20000,
  offline: ["b"],
});
assert.equal(scope.current.id, "b");
assert.equal(audio.currentTime, 1);
assert.equal(scope.downloads.size, 0);
assert.ok(scope.offlineIds.has("b"));
scope.downloads.add("a");
scope.window.receiveMareNativeState({
  account: "first",
  id: "b",
  playing: true,
  queue: [],
  position: 1200,
  duration: 20000,
  failed: ["a"],
});
assert.equal(
  scope.downloads.has("a"),
  false,
  "a failed native transfer must not leave a permanent task",
);
audio.currentTime = 8;
assert.equal(commands.at(-1).action, "seek");
assert.equal(commands.at(-1).position, 8000);
audio.pause();
assert.equal(commands.at(-1).action, "pause");
assert.equal(audio.paused, true);
audio.logout();
assert.equal(commands.at(-1).action, "logout");
assert.equal(audio.getAttribute("src"), null);
console.log(
  "PASS Android bridge: full queue handoff, account isolation, native transition adoption, offline completion and transport",
);
