"use strict";
// This adapter exists only inside the origin-restricted Android host.
window.createMareNativeAudio = () => {
  if (!window.MareNative?.postMessage) return null;
  const target = new EventTarget();
  let state = { id: null, playing: false, position: 0, duration: 0, volume: 1 };
  let source = "",
    pendingId = null,
    pendingUntil = 0,
    signature = "",
    applying = false,
    lastError = "";
  const send = (action, data = {}) => {
    MareNative.postMessage(
      JSON.stringify({ action, account: currentUser?.id, ...data }),
    );
  };
  const emit = (name) => {
    target["on" + name]?.(new Event(name));
    target.dispatchEvent(new Event(name));
  };
  Object.defineProperties(target, {
    native: { value: true },
    src: {
      get: () => source,
      set: (value) => {
        source = value;
      },
    },
    paused: { get: () => !state.playing },
    ended: { get: () => false },
    readyState: { get: () => (state.duration > 0 ? 1 : 0) },
    duration: { get: () => state.duration / 1000 },
    playbackRate: { get: () => 1 },
    currentTime: {
      get: () => state.position / 1000,
      set: (value) => {
        state.position = Math.max(0, Number(value) || 0) * 1000;
        send("seek", { position: state.position });
        emit("seeked");
      },
    },
    volume: {
      get: () => state.volume,
      set: (value) => {
        state.volume = Math.max(0, Math.min(1, value));
        send("volume", { value: state.volume });
        emit("volumechange");
      },
    },
  });
  target.play = () => {
    state.playing = true;
    send("play");
    emit("play");
    return Promise.resolve();
  };
  target.pause = () => {
    state.playing = false;
    send("pause");
    emit("pause");
  };
  target.getAttribute = (key) => (key === "src" ? source || null : null);
  target.removeAttribute = (key) => {
    if (key === "src") {
      source = "";
      state.id = null;
      send("stop");
    }
  };
  target.configure = () => {
    signature = "";
    pendingId = null;
    send("configure");
  };
  target.logout = () => {
    send("logout");
    state = { id: null, playing: false, position: 0, duration: 0, volume: 1 };
    source = "";
  };
  const playable = (id) =>
    library.tracks.some(
      (t) => t.id === id && (t.status === "ready" || offlineIds.has(id)),
    );
  const payload = () => ({
    id: current?.id,
    queue: queue.filter(playable),
    context: playbackContext.filter(playable),
    repeat,
    tracks: library.tracks
      .filter((t) => playable(t.id))
      .map(({ id, title, artist, art, status }) => ({
        id,
        title,
        artist,
        art,
        status,
      })),
  });
  target.startTrack = (track, position) => {
    source = "/media/" + track.id;
    pendingId = track.id;
    pendingUntil = Date.now() + 5000;
    state = {
      ...state,
      id: track.id,
      position: (position || 0) * 1000,
      duration: 0,
      playing: true,
    };
    const data = payload();
    signature = JSON.stringify(data);
    send("start", { ...data, id: track.id, position: state.position });
    emit("play");
  };
  target.updateQueue = () => {
    if (applying || !current || window.musicOutput?.remote()) return;
    const data = payload(),
      next = JSON.stringify(data);
    if (signature !== next) {
      signature = next;
      send("queue", data);
    }
  };
  const savingIds = new Set();
  target.saveTracks = (tracks) => {
    const available = tracks.filter(
      (t) => !savingIds.has(t.id) && !offlineIds.has(t.id),
    );
    if (!available.length) return;
    available.forEach((t) => savingIds.add(t.id));
    send("download", { ids: available.map((t) => t.id), tracks: available });
  };
  target.removeDownload = (id) => {
    savingIds.delete(id);
    send("remove", { id });
  };
  window.receiveMareNativeState = (next) => {
    if (!currentUser || next.account !== currentUser.id) return;
    if (pendingId && next.id !== pendingId && Date.now() < pendingUntil) return;
    pendingId = null;
    applying = true;
    try {
      const wasPlaying = state.playing,
        oldId = state.id,
        oldDuration = state.duration;
      state = { ...state, ...next };
      if (next.id) {
        const track = library.tracks.find((t) => t.id === next.id);
        if (track) {
          const trackChanged = current?.id !== next.id;
          if (current && current.id !== next.id) {
            playHistory.unshift(current.id);
            playHistory = playHistory.slice(0, 50);
          }
          current = track;
          source = "/media/" + track.id;
          queue = next.queue || [];
          if (oldId !== next.id || trackChanged) {
            drawPlayer();
            emit("loadedmetadata");
          }
        }
      }
      if (!oldDuration && next.duration > 0 && oldId === next.id)
        emit("loadedmetadata");
      let changed = false;
      for (const id of next.offline || []) {
        if (!offlineIds.has(id)) changed = true;
        offlineIds.add(id);
        savingIds.delete(id);
        if (downloads.delete(id)) changed = true;
      }
      if (changed) {
        local("meta", "downloads", [...downloads]).catch(() => {});
        render();
        drawIsland();
      }
      for (const id of next.failed || []) savingIds.delete(id);
      if (next.error && next.error !== lastError) notice(next.error);
      lastError = next.error || "";
      if (wasPlaying !== next.playing || oldId !== next.id)
        emit(next.playing ? "play" : "pause");
      emit("timeupdate");
    } finally {
      applying = false;
    }
  };
  return target;
};
