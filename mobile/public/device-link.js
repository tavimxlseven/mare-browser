"use strict";
let deviceLinkState = { id: null, devices: [], error: "" },
  deviceLinkTimer = 0,
  deviceLinkBusy = false,
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
    queue: [...queue],
  };
}
window.cancelMusicTransfer = (id) => {
  if (pendingDeviceTransfer?.track_id !== id) pendingDeviceTransfer = null;
};
async function receiveDevicePlayer(player) {
  if (player.action === "pause") {
    audio.pause();
    return;
  }
  const track = library.tracks.find((t) => t.id === player.track_id);
  if (!track)
    throw Error(
      "A biblioteca ainda está sincronizando. Tente novamente em instantes.",
    );
  if (track.status !== "ready" && !offlineIds.has(track.id)) {
    pendingDeviceTransfer = player;
    await api("prepare", {
      tracks: [{ ...track, artists: track.artist, thumbnail: track.art }],
    });
    notice("Preparando esta música para continuar aqui");
    return;
  }
  pendingDeviceTransfer = null;
  if (!(await play(track))) return;
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
      command: { action: "pause" },
    });
}
async function deviceCommand(command) {
  if (command.action === "transfer") return receiveDevicePlayer(command.player);
  if (command.action === "pause") audio.pause();
  else if (command.action === "resume") await audio.play();
  else if (command.action === "next") await next(false);
  else if (command.action === "previous") await $("previous").onclick();
  else if (command.action === "seek" && Number.isFinite(audio.duration))
    audio.currentTime = Math.min(command.position_ms / 1000, audio.duration);
  else if (command.action === "volume") audio.volume = command.value / 100;
}
const deviceLinkPanel = createMusicDevices($("device-settings"), {
  getState: () => deviceLinkState,
  localPlayer: localDevicePlayer,
  icon,
  notify: notice,
  pair: () => api("devices/pair", {}),
  send: (target, command) => api("devices/commands", { target, command }),
  receive: receiveDevicePlayer,
});
async function startDeviceLink() {
  clearTimeout(deviceLinkTimer);
  deviceAck = 0;
  pendingDeviceTransfer = null;
  deviceLinkPanel.clear();
  deviceLinkState = {
    id: await local("meta", "device-id"),
    devices: [],
    error: "",
  };
  if (isAdminEntry()) return;
  const owner = currentUser?.id;
  async function poll() {
    if (currentUser?.id !== owner) return;
    if (deviceLinkBusy) {
      deviceLinkTimer = setTimeout(poll, 3000);
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
      }
      if (
        pendingDeviceTransfer &&
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
      if (currentUser?.id === owner)
        deviceLinkTimer = setTimeout(poll, document.hidden ? 12000 : 3000);
    }
  }
  poll();
}
$("preferences").addEventListener("close", () => deviceLinkPanel.clear());
