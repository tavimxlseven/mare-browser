"use strict";
let deviceLinkState = { id: null, devices: [], error: "" },
  deviceLinkTimer = 0,
  deviceLinkBusy = false,
  deviceLinkAgain = false,
  deviceAck = 0,
  pendingDeviceTransfer = null;
function localDevicePlayer() {
  return {
    track_id: current?.id || null,
    title: current?.title || "",
    artist: current?.artist || "",
    art: current?.art || "",
    state: audio.ended ? "stopped" : audio.paused ? "paused" : "playing",
    position_ms: Math.round((audio.currentTime || 0) * 1000),
    duration_ms: Math.round(
      (Number.isFinite(audio.duration) ? audio.duration : 0) * 1000,
    ),
    volume: Math.round(audio.volume * 100),
    activation: window.musicOutput?.activation() || 0,
    queue: [...queue],
  };
}
window.cancelMusicTransfer = (id) => {
  if (pendingDeviceTransfer?.track_id !== id) pendingDeviceTransfer = null;
};
async function receiveDevicePlayer(player) {
  window.applyingDeviceCommand = (window.applyingDeviceCommand || 0) + 1;
  try {
    return await receiveDevicePlayerLocal(player);
  } finally {
    window.applyingDeviceCommand--;
  }
}
async function receiveDevicePlayerLocal(player) {
  if (player.action === "pause") {
    audio.pause();
    return;
  }
  const track = library.tracks.find((t) => t.id === player.track_id);
  if (!track) {
    pendingDeviceTransfer = player;
    await refresh();
    notice("Sincronizando esta música para continuar aqui.");
    return { pending: true };
  }
  if (track.status !== "ready" && !offlineIds.has(track.id)) {
    pendingDeviceTransfer = player;
    await api("prepare", {
      tracks: [{ ...track, artists: track.artist, thumbnail: track.art }],
    });
    notice("Preparando esta música para continuar aqui");
    return { pending: true };
  }
  pendingDeviceTransfer = null;
  try {
    if (!(await play(track))) return;
  } catch (error) {
    pendingDeviceTransfer = { ...player, needs_gesture: true };
    notice("Toque neste aparelho em Dispositivos para autorizar a reprodução.");
    throw error;
  }
  queue = (player.queue || []).filter((id) =>
    library.tracks.some((t) => t.id === id),
  );
  playbackContext = [track.id, ...queue];
  const seek = () => {
    if (Number.isFinite(audio.duration))
      audio.currentTime = Math.max(
        0,
        Math.min((player.position_ms || 0) / 1000, audio.duration),
      );
  };
  if (audio.readyState >= 1) seek();
  else audio.addEventListener("loadedmetadata", seek, { once: true });
  if (player.state !== "playing") audio.pause();
  savePlayer();
  drawQueue();
  if (player.source && player.source !== deviceLinkState.id)
    await api("devices/commands", {
      target: player.source,
      command: { action: "pause", expected_activation: player.activation || 0 },
    });
}
async function deviceCommand(command) {
  window.applyingDeviceCommand = (window.applyingDeviceCommand || 0) + 1;
  try {
    return await applyDeviceCommand(command);
  } finally {
    window.applyingDeviceCommand--;
  }
}
async function applyDeviceCommand(command) {
  if (
    command.action === "pause" &&
    command.expected_activation != null &&
    command.expected_activation !== musicOutput.activation()
  )
    return;
  if (command.action === "transfer") return receiveDevicePlayer(command.player);
  if (command.action === "pause") audio.pause();
  else if (command.action === "resume") {
    await audio.play();
    musicOutput.claim();
  } else if (command.action === "next") await next(false);
  else if (command.action === "previous") await $("previous").onclick();
  else if (command.action === "seek" && Number.isFinite(audio.duration))
    audio.currentTime = Math.min(command.position_ms / 1000, audio.duration);
  else if (command.action === "volume") audio.volume = command.value / 100;
  else if (command.action === "select") musicOutput.claim();
  else if (command.action === "queue") {
    queue = command.queue;
    savePlayer();
    drawQueue();
  }
}
window.musicOutput = createMusicOutput({
  getState: () => deviceLinkState,
  localPlayer: localDevicePlayer,
  send: (target, command) => api("devices/commands", { target, command }),
  receive: receiveDevicePlayer,
  changed: () => window.syncMusicDevices?.(),
});
window.getMusicDisplayTrack = () => {
  const remote = musicOutput.remote(),
    p = remote?.player;
  return remote
    ? p.track_id
      ? {
          ...library.tracks.find((t) => t.id === p.track_id),
          id: p.track_id,
          title: p.title,
          artist: p.artist,
          art: p.art,
        }
      : null
    : current;
};
window.paintMusicOutput = () => {
  const output = musicOutput.remote();
  const player = output?.player;
  $("mini-output").textContent = output
    ? "Saída: " + output.name
    : "Dispositivos";
  $("player-output").textContent = output
    ? "Ouvindo em " + output.name
    : "Neste aparelho";
  $("music-devices").classList.toggle("remote-output", !!output);
  if (player) {
    $("mini-play").innerHTML = $("big-play").innerHTML = icon(
      player.state === "playing" ? "pause" : "play",
    );
    $("mini").classList.toggle("playing", player.state === "playing");
    $("duration").textContent = stamp(player.duration_ms / 1000);
    if (!seeking)
      paintMobileSeek(
        player.duration_ms
          ? (player.position_ms / player.duration_ms) * 100
          : 0,
        player.position_ms / 1000,
      );
    $("mini-progress").value = player.duration_ms
      ? (player.position_ms / player.duration_ms) * 100
      : 0;
  }
};
const deviceLinkPanel = createMusicDevices($("device-settings"), {
  output: musicOutput,
  getState: () => deviceLinkState,
  localPlayer: localDevicePlayer,
  icon,
  notify: notice,
  pair: () => api("devices/pair", {}),
  send: (target, command) => api("devices/commands", { target, command }),
  receive: receiveDevicePlayer,
});
const devicePickerPanel = createMusicDevices($("device-picker-body"), {
  picker: true,
  output: musicOutput,
  getState: () => deviceLinkState,
  localPlayer: localDevicePlayer,
  icon,
  notify: notice,
});
for (const button of [$("mini-output"), $("music-devices")])
  button.onclick = () => {
    devicePickerPanel.render(true);
    openSheet($("device-picker"));
  };
setInterval(() => {
  if (!document.hidden && !$("app").hidden) window.paintMusicOutput();
}, 500);
window.stopDeviceLink = () => {
  clearTimeout(deviceLinkTimer);
  pendingDeviceTransfer = null;
  deviceLinkState = { id: null, devices: [], session: null, error: "" };
  musicOutput.reset();
  window.syncMusicDevices = null;
};
async function startDeviceLink() {
  window.stopDeviceLink();
  deviceAck = 0;
  pendingDeviceTransfer = null;
  deviceLinkPanel.clear();
  deviceLinkState.id = await local("meta", "device-id");
  if (isAdminEntry()) return;
  const owner = currentUser?.id;
  async function poll() {
    if (currentUser?.id !== owner) return;
    if (deviceLinkBusy) {
      deviceLinkAgain = true;
      return;
    }
    deviceLinkBusy = true;
    try {
      if (!navigator.onLine) return;
      if (!deviceLinkState.id) {
        const response = await api("devices/register", {
          name: "Maré no celular",
        });
        if (!response.id)
          throw Error("Atualize o app para conectar dispositivos.");
        deviceLinkState.id = response.id;
        await local("meta", "device-id", response.id);
      }
      const response = await api("devices/sync", {
        id: deviceLinkState.id,
        revision: deviceLinkState.revision,
        player: localDevicePlayer(),
        ack: deviceAck,
      });
      if (currentUser?.id !== owner) return;
      deviceLinkState.devices = response.devices || [];
      deviceLinkState.session = response.session || null;
      deviceLinkState.error = "";
      if (
        deviceLinkState.revision &&
        deviceLinkState.revision !== response.revision
      )
        await refresh();
      deviceLinkState.revision = response.revision;
      for (const operation of response.commands || []) {
        if (operation.id <= deviceAck) continue;
        try {
          await deviceCommand(operation.command);
        } catch (error) {
          notice(error.message);
        }
        deviceAck = operation.id;
        deviceLinkAgain = true;
      }
      if (musicOutput.remote() && !audio.paused) audio.pause();
      if (
        pendingDeviceTransfer &&
        !pendingDeviceTransfer.needs_gesture &&
        library.tracks.some(
          (t) =>
            t.id === pendingDeviceTransfer.track_id && t.status === "ready",
        )
      )
        await receiveDevicePlayer(pendingDeviceTransfer);
    } catch (error) {
      deviceLinkState.error = error.message;
      if (error.status === 404) {
        deviceLinkState.id = null;
        await local("meta", "device-id", null);
      }
    } finally {
      deviceLinkBusy = false;
      deviceLinkPanel.render();
      devicePickerPanel.render();
      drawPlayer();
      window.paintMusicOutput();
      if (currentUser?.id === owner)
        deviceLinkTimer = setTimeout(
          poll,
          deviceLinkAgain ? 50 : document.hidden && audio.paused ? 10000 : 700,
        );
      deviceLinkAgain = false;
    }
  }
  window.syncMusicDevices = () => {
    clearTimeout(deviceLinkTimer);
    void poll();
  };
  poll();
}
for (const event of ["play", "pause", "seeked", "ended", "volumechange"])
  audio.addEventListener(event, () => window.syncMusicDevices?.());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) window.syncMusicDevices?.();
});
$("preferences").addEventListener("close", () => deviceLinkPanel.clear());
