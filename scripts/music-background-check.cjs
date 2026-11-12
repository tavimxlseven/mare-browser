const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise the production transition with storage and media controlled independently.
const source = fs.readFileSync("mobile/public/app.js", "utf8");
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}
const events = [];
const reads = [];
let resolveBlob;
const tracks = ["a", "b", "c"].map((id) => ({ id, status: "ready" }));
const context = vm.createContext({
  console,
  Date,
  Number,
  Math,
  JSON,
  window: {},
  navigator: {},
  library: { tracks },
  currentUser: { id: "first" },
  offlineIds: new Set(),
  queue: [],
  playbackContext: [],
  playHistory: [],
  current: null,
  nextAudio: null,
  playVersion: 0,
  objectUrl: "",
  restoredPosition: 0,
  shuffle: false,
  repeat: "off",
  audio: {
    currentTime: 0,
    set src(value) {
      events.push(["src", value]);
    },
    play() {
      events.push(["play"]);
      return Promise.resolve();
    },
    pause() {
      events.push(["pause"]);
    },
    addEventListener() {},
  },
  URL: {
    createObjectURL: () => "blob:next",
    revokeObjectURL: (url) => events.push(["revoke", url]),
  },
  local: (store, id) => {
    if (store !== "audio") return Promise.resolve();
    reads.push(id);
    return new Promise((resolve) => {
      resolveBlob = resolve;
    });
  },
  drawPlayer: () => events.push(["draw"]),
  savePlayer() {},
  shuffleItems: (items) => items,
});
vm.runInContext(
  section("function warmNextAudio()", "function updateMediaPosition()") +
    section("async function play(track, list)", "function drawPlayer()") +
    section("async function next(automatic", "function toggle()"),
  context,
);

(async () => {
  // Starting an online song must not yield to storage before requesting playback.
  const started = context.play(tracks[0], tracks);
  assert.equal(events[1][0], "play");
  assert.equal(reads.length, 0);
  await started;
  await context.next(true);
  assert.equal(context.current.id, "b");
  assert.equal(
    events.some(([event]) => event === "pause"),
    false,
  );
  assert.ok(
    events.findIndex(([event]) => event === "play") <
      events.findIndex(([event]) => event === "draw"),
  );

  // The next offline file is read once, while the current song is still active.
  context.queue = ["c"];
  context.offlineIds.add("c");
  context.warmNextAudio();
  context.warmNextAudio();
  assert.deepEqual(reads, ["c"]);
  resolveBlob({ size: 12 });
  await context.nextAudio.promise;
  events.length = 0;
  context.objectUrl = "blob:old";
  const offline = context.next(true);
  assert.deepEqual(events.slice(0, 3), [
    ["src", "blob:next"],
    ["play"],
    ["revoke", "blob:old"],
  ]);
  await offline;
  assert.deepEqual(reads, ["c"]);

  // A superseded account/track transition cannot start after its storage read completes.
  context.nextAudio = null;
  events.length = 0;
  const stale = context.play(tracks[2]);
  context.playVersion++;
  context.currentUser = { id: "second" };
  resolveBlob({ size: 12 });
  assert.equal(await stale, false);
  assert.equal(events.length, 0);
  console.log(
    "PASS background next: immediate online play, warm offline handoff, no explicit pause, stale transition cancellation",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
