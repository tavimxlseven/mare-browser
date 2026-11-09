const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
let now = 1000;
const root = {};
vm.runInNewContext(fs.readFileSync("mobile/public/devices-ui.js", "utf8"), {
  window: root,
  performance: { now: () => now },
  Date,
  console,
});
let state = {
  id: "pc",
  session: {
    device_id: "phone",
    name: "Meu celular",
    online: true,
    revision: 1,
    updated_at: 10,
    server_time: 11,
    player: {
      track_id: "a".repeat(22),
      title: "Song",
      artist: "Artist",
      state: "playing",
      position_ms: 2000,
      duration_ms: 100000,
      activation: 10,
      queue: ["b".repeat(22)],
    },
  },
};
const local = {
  track_id: "c".repeat(22),
  state: "paused",
  position_ms: 300,
  queue: [],
};
const commands = [],
  received = [];
const output = root.createMusicOutput({
  getState: () => state,
  localPlayer: () => local,
  send: async (target, command) => commands.push({ target, command }),
  receive: async (player) => received.push(player),
});
(async () => {
  const empty = root.createMusicOutput({getState:()=>({}),localPlayer:()=>local,send:async()=>{},receive:async()=>{}});
  assert.equal(empty.remote(),null,"the initial pre-login render has no device or session yet");
  assert.equal(output.remote().player.position_ms, 3000);
  now += 1500;
  assert.equal(output.remote().player.position_ms, 4500);
  assert.equal(
    local.position_ms,
    300,
    "a mirrored clock must never seek the local audio",
  );
  await output.command("next");
  assert.equal(commands.at(-1).target, "phone");
  assert.equal(commands.at(-1).command.action, "next");
  await output.play(
    { id: "d".repeat(22), title: "Another song", artist: "Artist" },
    ["e".repeat(22)],
  );
  assert.equal(commands.at(-1).command.player.track_id, "d".repeat(22));
  assert.equal(commands.at(-1).command.player.queue[0], "e".repeat(22));
  await output.command("seek", { position_ms: 8000 });
  assert.equal(commands.at(-1).command.position_ms, 8000);
  await output.select({ id: "pc" });
  assert.equal(received[0].source, "phone");
  assert.equal(received[0].track_id, "a".repeat(22));
  output.claim();
  assert.equal(
    output.remote(),
    null,
    "an in-flight local handoff must not flip back to an old heartbeat",
  );
  state = {
    ...state,
    session: {
      ...state.session,
      device_id: "pc",
      player: { ...local, activation: output.activation() },
    },
  };
  assert.equal(output.remote(), null);
  state = {
    ...state,
    session: {
      ...state.session,
      device_id: "phone",
      revision: 2,
      player: { ...state.session.player, state: "paused", position_ms: 6000 },
    },
  };
  assert.equal(output.remote().player.position_ms, 6000);
  now += 2000;
  assert.equal(
    output.remote().player.position_ms,
    6000,
    "paused remote progress must remain still",
  );
  state.session.online = false;
  assert.equal(output.remote(), null);
  assert.equal(
    await output.command("pause"),
    false,
    "offline outputs cannot silently consume local controls",
  );
  console.log(
    "PASS shared output selection, remote transport/queue, clock interpolation, paused state and handoff isolation",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
