"use strict";
const $ = (id) => document.getElementById(id);
const musicIcon = icon("music");
let library = { tracks: [], playlists: [] },
  view = "library",
  selected = null,
  results = [];
let current = null,
  queue = [],
  objectUrl = "",
  shuffle = false,
  repeat = "off",
  playbackContext = [],
  restoredPosition = 0;
let downloads = new Set(),
  saving = false,
  activeSave = "",
  onlineSession = false;
const audio = $("audio");
let seeking = false;
let playVersion = 0;
let searchVersion = 0,
  searchController = null;
const pendingMutations = new Map();
let database;
function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      for (const name of ["meta", "audio"]) open.result.createObjectStore(name);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function local(store, key, value, remove = false) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      store,
      value === undefined && !remove ? "readonly" : "readwrite",
    );
    const table = tx.objectStore(store);
    const req = remove
      ? table.delete(key)
      : value === undefined
        ? table.get(key)
        : table.put(value, key);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Armazenamento indisponível"));
  });
}
function notice(message) {
  $("notice").textContent = message;
  $("notice").hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => ($("notice").hidden = true), 6500);
}
async function api(path, data, signal) {
  const dedupe =
    data &&
    (path === "prepare" ||
      path === "import" ||
      /^playlists\/[^/]+\/prepare$/.test(path));
  const identity = data?.tracks
    ? [...new Set(data.tracks.map((t) => t.id))].sort()
    : data?.url?.replace(/[?#].*$/, "") || "";
  const key = dedupe
    ? (currentUser?.id || "") + ":" + path + ":" + JSON.stringify(identity)
    : null;
  if (key && pendingMutations.has(key)) return pendingMutations.get(key);
  const promise = (async () => {
    try {
      return await performApi(path, data, signal);
    } catch (error) {
      if (
        !dedupe ||
        !navigator.onLine ||
        error.name === "AbortError" ||
        !(error instanceof TypeError || error.status >= 500)
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return performApi(path, data, signal);
    }
  })();
  if (key) pendingMutations.set(key, promise);
  try {
    return await promise;
  } finally {
    if (key && pendingMutations.get(key) === promise)
      pendingMutations.delete(key);
  }
}
async function performApi(path, data, signal) {
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin",
    signal,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(
      "O serviço não respondeu. Sua fila foi preservada; tente novamente.",
    );
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401) onlineSession = false;
    const error = new Error(result.error || "Não foi possível concluir.");
    error.status = response.status;
    throw error;
  }
  return result;
}
function task(fn) {
  return (...args) =>
    Promise.resolve(fn(...args)).catch((e) => notice(e.message));
}
function artwork(track, target) {
  target.replaceChildren();
  if (track?.art || /^[A-Za-z0-9]{22}$/.test(track?.id || "")) {
    const img = new Image();
    img.src = track.art || "/artwork/" + track.id;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => {
      target.innerHTML = musicIcon;
    };
    target.append(img);
  } else target.innerHTML = musicIcon;
}
function sourceTracks() {
  if (view === "search") return results;
  if (view === "offline")
    return library.tracks.filter((t) => offlineIds.has(t.id));
  if (selected === "liked") return library.tracks.filter((t) => t.liked);
  if (selected && selected !== "all") {
    const p = library.playlists.find((p) => p.id === selected);
    return (p?.tracks || [])
      .map((id) => library.tracks.find((t) => t.id === id))
      .filter(Boolean);
  }
  return library.tracks;
}
let offlineIds = new Set();
function row(track, list) {
  const el = document.createElement("article");
  el.className = "track";
  el.dataset.trackId = track.id;
  const art = document.createElement("div");
  art.className = "art";
  artwork(track, art);
  const title = document.createElement("button");
  title.className = "title";
  const name = document.createElement("strong");
  name.textContent = track.title;
  const artist = document.createElement("small");
  artist.textContent =
    track.status === "error"
      ? track.error || "Falha ao preparar. Tente novamente."
      : track.artist +
        (offlineIds.has(track.id)
          ? " · Neste aparelho"
          : track.status === "ready"
            ? " · Na nuvem"
            : "");
  title.append(name, artist);
  title.onclick = task(async () => {
    if (title.disabled) return;
    title.disabled = true;
    try {
      await play(track, list);
    } finally {
      title.disabled = false;
    }
  });
  const more = document.createElement("button");
  more.className = "more";
  more.innerHTML = icon("more");
  more.ariaLabel = "Opções de " + track.title;
  more.onclick = () => options(track);
  const status = document.createElement("button");
  status.className = "track-state";
  status.innerHTML = icon(
    offlineIds.has(track.id)
      ? "check"
      : track.status === "ready"
        ? "download"
        : "cloud",
  );
  status.ariaLabel = statusLabel(track);
  status.disabled = ["queued", "preparing"].includes(track.status);
  status.classList.toggle(
    "ready",
    offlineIds.has(track.id) || track.status === "ready",
  );
  status.onclick = task(() =>
    offlineIds.has(track.id)
      ? play(track, list)
      : track.status === "ready"
        ? saveTracks([track])
        : play(track, list),
  );
  el.append(art, title, status, more);
  return el;
}
function render(force = false) {
  if (typeof playlistSort !== "undefined" && playlistSort.dragging) return;
  const signature = JSON.stringify({
    view,
    selected,
    results,
    tracks: library.tracks,
    playlists: library.playlists,
    offline: [...offlineIds],
  });
  if (!force && signature === renderSignature) return;
  renderSignature = signature;
  $("heading").textContent =
    view === "search"
      ? "Buscar"
      : view === "offline"
        ? "Baixadas"
        : "Biblioteca";
  $("search-form").hidden = view !== "search";
  $("library-actions").hidden = view !== "library";
  $("collections").hidden = view !== "library";
  $("collections").replaceChildren();
  if (view === "library") {
    for (const p of library.playlists) {
      const b = document.createElement("button");
      b.className = "collection";
      const art = document.createElement("div");
      art.className = "collection-art";
      collectionArt(p, art);
      b.append(art);
      const label = document.createElement("b");
      label.textContent = p.name;
      const count = document.createElement("small");
      count.textContent =
        p.id === null
          ? library.tracks.length + " músicas"
          : p.id === "liked"
            ? "Suas favoritas"
            : (p.tracks || []).length + " músicas";
      b.append(label, count);
      b.onclick = () => {
        showPlaylist(p.id);
      };
      $("collections").append(b);
    }
  }
  $("library-menu").hidden =
    view !== "library" || library.playlists.some((p) => p.id === selected);
  const playlist = library.playlists.find((p) => p.id === selected);
  $("list-title").textContent =
    selected === "liked"
      ? "Músicas curtidas"
      : playlist?.name ||
        (view === "search"
          ? "Resultados"
          : selected === "all"
            ? "Todas as músicas"
            : "Adições recentes");
  $("download-all").hidden = !playlist || view !== "library";
  updatePlaylistHeader();
  const list = sourceTracks();
  $("tracks").replaceChildren(
    ...list.map((t) => {
      const line = row(t, list);
      if (playlist && view === "library") {
        line.dataset.sortKey = t.id;
        line.append(dragHandle(t.title));
      }
      return line;
    }),
  );
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      view === "offline"
        ? "Salve músicas para ouvir aqui sem internet."
        : view === "search"
          ? "Procure uma música ou um artista."
          : "Sua biblioteca começa com uma música. Busque pelo nome ou importe uma playlist.";
    $("tracks").append(empty);
  }
  for (const button of document.querySelectorAll("[data-view]")) {
    if (button.dataset.view === view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
function showEntry(title, label, callback) {
  $("playlist-cover-editor")?.remove();
  $("entry-value").maxLength = 500;
  $("entry-form").querySelector(".primary").textContent = "Continuar";
  if ($("delete-playlist")) $("delete-playlist").hidden = true;
  $("entry-title").textContent = title;
  $("entry-label").textContent = label;
  $("entry-value").value = "";
  $("entry-error").hidden = true;
  $("entry-help").textContent =
    title === "Importar do Spotify"
      ? "Cole o link público. A playlist será importada e preparada na nuvem, mesmo depois de fechar esta janela."
      : "";
  $("entry-value").inputMode = title === "Importar do Spotify" ? "url" : "text";
  $("entry-form").onsubmit = task(async (e) => {
    e.preventDefault();
    const button = e.submitter || $("entry-form").querySelector(".primary");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await callback($("entry-value").value);
      closeSheet($("entry"));
    } catch (error) {
      $("entry-error").hidden = false;
      $("entry-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  openSheet($("entry"));
}
function options(track) {
  const old = $("track-options");
  if (old) old.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "track-options";
  const heading = document.createElement("h2");
  heading.textContent = track.title;
  dialog.append(heading);
  const add = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = "option";
    b.onclick = task(async () => {
      closeSheet(dialog);
      await fn();
    });
    dialog.append(b);
  };
  add("Salvar no aparelho", () => saveTracks([track]));
  add(track.liked ? "Remover das curtidas" : "Curtir", async () => {
    await ensureSaved(track);
    await api("tracks/" + track.id, { liked: !track.liked });
    await refresh();
  });
  add("Tocar a seguir", () => addToQueue(track, true));
  add("Adicionar ao fim da fila", () => addToQueue(track, false));
  add("Adicionar à playlist", () => choosePlaylist(track));
  if (offlineIds.has(track.id))
    add("Remover download deste iPhone", async () => {
      await local("audio", track.id, undefined, true);
      offlineIds.delete(track.id);
      render();
    });
  add("Excluir da biblioteca", async () => {
    if (
      !(await confirmAction(
        "Excluir música?",
        "Ela será removida da biblioteca e dos downloads deste aparelho.",
        "Excluir música",
        true,
      ))
    )
      return;
    await api("tracks/" + track.id, { action: "delete" });
    await local("audio", track.id, undefined, true);
    offlineIds.delete(track.id);
    if (current?.id === track.id) {
      audio.pause();
      audio.removeAttribute("src");
      current = null;
      $("mini").hidden = true;
    }
    await refresh();
  });
  add("Cancelar", () => {});
  document.body.append(dialog);
  openSheet(dialog);
}
async function ensureSaved(t) {
  if (!library.tracks.some((x) => x.id === t.id)) {
    await api("tracks", { ...t, artists: t.artist, thumbnail: t.art });
    await refresh();
  }
}
async function refresh() {
  library = await api("library");
  onlineSession = true;
  await local("meta", "library", library);
  await reconcileDownloads();
  $("connection").hidden = true;
  render();
  drawIsland();
  if (current) {
    const updated = library.tracks.find((t) => t.id === current.id);
    if (
      updated &&
      JSON.stringify({ ...current, ...updated }) !== JSON.stringify(current)
    ) {
      current = { ...current, ...updated };
      drawPlayer();
    }
  }
}
async function saveTracks(tracks) {
  tracks = tracks.filter((t) => !offlineIds.has(t.id));
  if (!tracks.length) {
    notice("Essas músicas já estão neste aparelho.");
    return;
  }
  if (
    (await local("meta", "network")) !== "any" &&
    !(await confirmAction(
      "Salvar no aparelho?",
      "Confira se está no Wi-Fi. Se a rede mudar, a transferência poderá usar dados móveis.",
      "Salvar músicas",
    ))
  )
    return;
  const unprepared = tracks.filter((t) => t.status !== "ready");
  for (let i = 0; i < unprepared.length; i += 40) {
    const r = await api("prepare", {
      tracks: unprepared
        .slice(i, i + 40)
        .map((t) => ({ ...t, artists: t.artist, thumbnail: t.art })),
    });
    islandJobId = r.job_id;
  }
  for (const t of tracks) downloads.add(t.id);
  deviceBatch = [...downloads];
  await local("meta", "downloads", [...downloads]);
  await local("meta", "device-batch", deviceBatch);
  await refresh();
  expandIsland();
  await drain();
}
async function reconcileDownloads() {
  const stale = [...downloads].filter((id) => {
    const track = library.tracks.find((t) => t.id === id);
    return !track || track.status === "error";
  });
  if (!stale.length) return;
  for (const id of stale) downloads.delete(id);
  deviceBatch = deviceBatch.filter((id) => !stale.includes(id));
  await local("meta", "downloads", [...downloads]);
  await local("meta", "device-batch", deviceBatch);
}
async function drain() {
  if (saving || !navigator.onLine || document.hidden || !downloads.size) return;
  const ready = [...downloads].filter((id) =>
    library.tracks.some((t) => t.id === id && t.status === "ready"),
  );
  if (!ready.length) return;
  saving = true;
  const downloadOwner = currentUser?.id;
  try {
    for (const id of ready) {
      if (document.hidden) break;
      const t = library.tracks.find((t) => t.id === id);
      activeSave = t.title;
      activeSaveId = id;
      deviceBytes = 0;
      deviceSize = 0;
      drawIsland();
      downloadController = new AbortController();
      const response = await fetch("/media/" + id, {
        signal: downloadController.signal,
      });
      if (!response.ok)
        throw new Error(
          "Falha ao salvar no aparelho. Abra o app para retomar.",
        );
      deviceSize = Number(response.headers.get("Content-Length")) || 0;
      let blob;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let lastPaint = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          deviceBytes += value.byteLength;
          if (performance.now() - lastPaint > 120) {
            drawIsland();
            lastPaint = performance.now();
          }
        }
        blob = new Blob(chunks, { type: "audio/mp4" });
      } else blob = await response.blob();
      if (!blob.size || (deviceSize && blob.size !== deviceSize))
        throw new Error(
          "Transferência incompleta. O download será retomado ao voltar.",
        );
      if (currentUser?.id !== downloadOwner)
        throw new Error("A conta foi alterada.");
      await local("audio", id, blob);
      offlineIds.add(id);
      downloads.delete(id);
      await local("meta", "downloads", [...downloads]);
      render();
      drawIsland();
    }
    if (!downloads.size) notice("Músicas salvas neste aparelho.");
  } catch (error) {
    notice(
      error.name === "QuotaExceededError"
        ? "O aparelho está sem espaço para salvar a música. Libere espaço e tente novamente."
        : error.message,
    );
  } finally {
    saving = false;
    downloadController = null;
    activeSave = "";
    activeSaveId = null;
    deviceBytes = 0;
    deviceSize = 0;
    render();
    drawIsland();
  }
}
function savePlayer() {
  local("meta", "player", {
    id: current?.id,
    queue,
    position: audio.currentTime || 0,
    shuffle,
    repeat,
    context: playbackContext,
  }).catch(() => {});
}
async function play(track, list) {
  if (!window.applyingDeviceCommand && window.musicOutput?.remote()) {
    const ids = list
      ? list.map((t) => t.id)
      : musicOutput.remote().player.queue || [];
    const index = list ? ids.indexOf(track.id) : -1;
    await musicOutput.play(track, list ? ids.slice(index + 1) : ids);
    return true;
  }
  window.cancelMusicTransfer?.(track.id);
  const version = ++playVersion;
  track = library.tracks.find((t) => t.id === track.id) || track;
  if (["queued", "preparing"].includes(track.status)) {
    const job = (library.jobs || []).find(
      (j) =>
        j.track_ids?.includes(track.id) &&
        ["queued", "importing", "preparing"].includes(j.status),
    );
    if (job) {
      islandJobId = job.id;
      dismissedJobs.delete(job.id);
    }
    notice(
      "Esta música já está sendo preparada. Acompanhe o andamento na ilha.",
    );
    expandIsland();
    return;
  }
  if (!offlineIds.has(track.id) && track.status !== "ready") {
    const prepared = await api("prepare", {
      tracks: [{ ...track, artists: track.artist, thumbnail: track.art }],
    });
    islandJobId = prepared.job_id;
    dismissedJobs.delete(islandJobId);
    await refresh();
    notice(
      "Preparando na nuvem. Toque em reproduzir quando a faixa estiver pronta.",
    );
    return;
  }
  const blob = await local("audio", track.id);
  if (version !== playVersion) return false;
  if (list) {
    playbackContext = list.map((t) => t.id);
    const position = playbackContext.indexOf(track.id);
    queue = shuffle
      ? shuffleItems(playbackContext.filter((id) => id !== track.id))
      : playbackContext.slice(position + 1);
  }
  audio.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = blob ? URL.createObjectURL(blob) : "";
  audio.src = objectUrl || "/media/" + track.id;
  if (restoredPosition && current?.id === track.id) {
    const position = restoredPosition;
    restoredPosition = 0;
    audio.addEventListener(
      "loadedmetadata",
      () => {
        if (Number.isFinite(audio.duration))
          audio.currentTime = Math.min(position, audio.duration);
      },
      { once: true },
    );
  }
  restoredPosition = 0;
  if (current && current.id !== track.id) {
    playHistory.unshift(current.id);
    playHistory = playHistory.slice(0, 50);
    local("meta", "history", playHistory).catch(() => {});
  }
  current = track;
  drawPlayer();
  try {
    await audio.play();
  } catch (error) {
    if (version !== playVersion) return false;
    throw error;
  }
  if (version !== playVersion) return false;
  window.musicOutput?.claim();
  savePlayer();
  return true;
}
function drawPlayer() {
  const shown = window.getMusicDisplayTrack
    ? window.getMusicDisplayTrack()
    : current;
  if (!shown) {
    $("mini").hidden = true;
    return;
  }
  $("mini").hidden = false;
  $("mini-title").textContent = shown.title;
  $("mini-artist").textContent = shown.artist;
  $("mini-art").src = shown.art || "/artwork/" + shown.id;
  $("mini-art").onerror = () => {
    $("mini-art").onerror = null;
    $("mini-art").src = "/icon-192.png";
  };
  $("player-title").textContent = shown.title;
  $("player-artist").textContent = shown.artist;
  artwork(shown, $("cover"));
  $("player-backdrop").src = shown.art || "/artwork/" + shown.id;
  const latest = library.tracks.find((t) => t.id === shown.id) || shown;
  $("player-like").setAttribute("aria-pressed", String(!!latest.liked));
  drawQueue();
  window.paintMusicOutput?.();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: shown.title,
      artist: shown.artist,
      album: "Maré Música",
      artwork: shown.art
        ? [{ src: shown.art }]
        : [
            {
              src: location.origin + "/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
          ],
    });
  }
}
function shuffleItems(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
async function next(automatic = false) {
  if (
    !automatic &&
    !window.applyingDeviceCommand &&
    window.musicOutput?.remote()
  )
    return musicOutput.command("next");
  if (repeat === "one" && automatic && current) {
    audio.currentTime = 0;
    await audio.play();
    return;
  }
  queue = queue.filter((id) =>
    library.tracks.some(
      (t) => t.id === id && (t.status === "ready" || offlineIds.has(id)),
    ),
  );
  if (!queue.length && repeat === "all") {
    queue = playbackContext.filter((id) =>
      library.tracks.some(
        (t) => t.id === id && (t.status === "ready" || offlineIds.has(id)),
      ),
    );
    if (shuffle) {
      queue = shuffleItems(queue);
      if (queue.length > 1 && queue[0] === current?.id)
        [queue[0], queue[1]] = [queue[1], queue[0]];
    }
  }
  if (!queue.length) {
    audio.pause();
    savePlayer();
    return;
  }
  const id = queue.shift();
  const track = library.tracks.find((t) => t.id === id);
  if (track) await play(track);
  savePlayer();
}
function toggle() {
  if (!window.applyingDeviceCommand && window.musicOutput?.remote()) {
    musicOutput
      .command(
        musicOutput.remote().player.state === "playing" ? "pause" : "resume",
      )
      .catch((e) => notice(e.message));
    return;
  }
  if (current && !audio.getAttribute("src")) {
    play(current).catch((e) => notice(e.message));
    return;
  }
  if (current)
    audio.paused ? audio.play().catch((e) => notice(e.message)) : audio.pause();
}
function stamp(s) {
  s = Number.isFinite(s) ? s : 0;
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}
audio.onplay = audio.onpause = () => {
  if (window.musicOutput?.remote()) {
    window.paintMusicOutput?.();
    savePlayer();
    return;
  }
  $("mini-play").innerHTML = $("big-play").innerHTML = icon(
    audio.paused ? "play" : "pause",
  );
  $("mini").classList.toggle("playing", !audio.paused);
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  savePlayer();
};
function paintMobileSeek(percent, position) {
  $("seek").value = percent;
  $("seek").parentElement.style.setProperty("--seek-fill", percent + "%");
  $("seek-preview").textContent = stamp(position);
  $("elapsed").textContent = stamp(position);
}
audio.ontimeupdate = () => {
  if (window.musicOutput?.remote()) {
    window.paintMusicOutput?.();
    return;
  }
  $("duration").textContent = stamp(audio.duration);
  const actual = audio.duration
    ? (audio.currentTime / audio.duration) * 100
    : 0;
  if (!seeking) {
    paintMobileSeek(actual, audio.currentTime);
  }
  $("mini-progress").value = actual;
  if (Math.floor(audio.currentTime) % 5 === 0) savePlayer();
};
audio.onended = task(() => next(true));
audio.onerror = () =>
  notice(
    "Não foi possível tocar. Verifique se a música está pronta ou salva no aparelho.",
  );
$("seek").onchange = () => {
  if (window.musicOutput?.remote()) {
    const p = musicOutput.remote().player;
    musicOutput
      .command("seek", {
        position_ms: Math.round(
          ((p.duration_ms || 0) * Number($("seek").value)) / 100,
        ),
      })
      .catch((e) => notice(e.message));
  } else if (Number.isFinite(audio.duration))
    audio.currentTime = (audio.duration * Number($("seek").value)) / 100;
  seeking = false;
  $("seek").classList.remove("scrubbing");
  savePlayer();
};
$("seek").onpointerdown = () => {
  seeking = true;
  $("seek").classList.add("scrubbing");
};
$("seek").onpointerup = () => {
  seeking = false;
  $("seek").classList.remove("scrubbing");
};
$("seek").oninput = () => {
  seeking = true;
  const fraction = Number($("seek").value) / 100;
  const duration =
    window.musicOutput?.remote()?.player.duration_ms / 1000 ||
    audio.duration ||
    0;
  paintMobileSeek(100 * fraction, duration * fraction);
};
$("seek").onpointercancel = $("seek").onblur = () => {
  seeking = false;
  $("seek").classList.remove("scrubbing");
  audio.ontimeupdate();
};
$("mini-play").onclick = $("big-play").onclick = toggle;
$("next").onclick = $("forward").onclick = task(() => next(false));
$("previous").onclick = () => {
  if (!window.applyingDeviceCommand && window.musicOutput?.remote())
    return musicOutput.command("previous");
  audio.currentTime = 0;
};
$("shuffle").onclick = () => {
  shuffle = !shuffle;
  queue = shuffle
    ? shuffleItems(queue)
    : [...queue].sort(
        (a, b) => playbackContext.indexOf(a) - playbackContext.indexOf(b),
      );
  drawQueue();
  $("shuffle").setAttribute("aria-pressed", shuffle);
  savePlayer();
};
$("repeat").onclick = () => {
  repeat = { off: "all", all: "one", one: "off" }[repeat] || "off";
  $("repeat").setAttribute("aria-pressed", repeat !== "off");
  $("repeat").setAttribute(
    "aria-label",
    repeat === "one"
      ? "Repetir música"
      : repeat === "all"
        ? "Repetir playlist"
        : "Ativar repetição",
  );
  $("repeat").dataset.mode = repeat;
  savePlayer();
};
$("open-player").onclick = () => {
  openSheet($("player"));
  drawQueue();
};
$("save-current").onclick = task(() => {
  const shown = window.getMusicDisplayTrack
    ? window.getMusicDisplayTrack()
    : current;
  return shown && saveTracks([shown]);
});
$("search-form").onsubmit = task(async (e) => {
  e.preventDefault();
  const b = e.submitter;
  if (b?.disabled) return;
  if (b) b.disabled = true;
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  const version = ++searchVersion;
  try {
    const query = $("query").value.trim();
    let found;
    if (!navigator.onLine)
      found = library.tracks.filter(
        (t) =>
          offlineIds.has(t.id) &&
          (t.title + " " + t.artist)
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      );
    else
      found = (
        await api(
          "search?q=" + encodeURIComponent(query),
          undefined,
          controller.signal,
        )
      ).tracks;
    if (version !== searchVersion || view !== "search") return;
    results = found;
    $("query").blur();
    render();
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  } finally {
    if (b) b.disabled = false;
  }
});
$("import").onclick = () =>
  showEntry(
    "Importar do Spotify",
    "Link público de música, playlist ou álbum",
    async (url) => {
      notice("Importando playlist…");
      const result = await api("import", { url });
      islandJobId = result.job_id;
      dismissedJobs.delete(islandJobId);
      await refresh();
      expandIsland();
    },
  );
$("create").onclick = () =>
  showEntry("Nova playlist", "Nome da playlist", async (name) => {
    await api("playlists", { name });
    await refresh();
  });
$("download-all").onclick = task(() =>
  saveTracks(sourceTracks().filter((t) => t.status === "ready")),
);
for (const b of document.querySelectorAll("[data-view]"))
  b.onclick = () => {
    navigateView(b.dataset.view, null);
  };
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => closeSheet(b.closest("dialog"));
$("settings").onclick = task(async () => {
  openSheet($("preferences"));
  await loadInvites();
  $("preparation-state").textContent = library.preparation?.paused
    ? "A fonte de áudio recusou o acesso. Os downloads estão pausados e a fila foi preservada."
    : "Downloads disponíveis.";
  const s = await navigator.storage?.estimate();
  $("storage").textContent = s
    ? "Neste aparelho · " + Math.round(s.usage / 1048576) + " MB usados"
    : "";
});
$("theme").onchange = task(async () => {
  document.body.classList.toggle("light", $("theme").value === "light");
  await local("meta", "theme", $("theme").value);
});
$("network").onchange = task(() =>
  local("meta", "network", $("network").value),
);
$("persist").onclick = task(async () =>
  notice(
    (await navigator.storage?.persist?.())
      ? "Armazenamento persistente autorizado."
      : "O aparelho gerencia o espaço automaticamente. Mantenha espaço livre para preservar downloads.",
  ),
);
let syncing = false;
let downloadController = null;
async function sync() {
  if (document.hidden || !navigator.onLine || !onlineSession || syncing) return;
  syncing = true;
  try {
    await refresh();
    await drain();
  } catch {
    $("connection").hidden = false;
    $("connection").textContent = "Sem conexão · músicas salvas disponíveis";
  } finally {
    syncing = false;
  }
}
async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() =>
        notice("O modo offline será habilitado quando a conexão voltar."),
      );
  }
  const installed =
    navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (!installed && !isAdminEntry()) return;
  const poll = async () => {
    await sync();
    const active =
      (library.jobs || []).some((job) =>
        ["queued", "importing", "preparing"].includes(job.status),
      ) || downloads.size;
    setTimeout(poll, active && !document.hidden ? 2500 : 15000);
  };
  setTimeout(poll, 2500);
  $("install").hidden = true;
  try {
    const response = await api("me");
    if (isAdminEntry() && !response.user.is_admin) {
      $("login").hidden = false;
      notice("Use a conta de administrador para abrir este painel.");
      return;
    }
    await useAccount(response.user);
    await refresh();
    $("app").hidden = false;
  } catch (error) {
    if (error.status === 401) {
      $("login").hidden = false;
      return;
    }
    if (isAdminEntry()) {
      $("login").hidden = false;
      notice("Conecte à internet para abrir a administração.");
      return;
    }
    let remembered;
    try {
      remembered = JSON.parse(
        localStorage.getItem("mare-music:last-account") || "null",
      );
    } catch {}
    if (!remembered) {
      $("login").hidden = false;
      notice("Conecte à internet para entrar na sua conta.");
      return;
    }
    await useAccount(remembered);
    $("app").hidden = false;
    $("connection").hidden = false;
    $("connection").textContent = "Offline · músicas neste aparelho";
    render();
  }
  await restorePlayer();
  await drain();
  openAdminEntry();
}

async function restorePlayer() {
  history.replaceState(appRoute(), "", location.pathname);
  playHistory = (await local("meta", "history")) || [];
  const saved = await local("meta", "player");
  if (saved) {
    queue = saved.queue || [];
    shuffle = !!saved.shuffle;
    repeat =
      saved.repeat === true
        ? "one"
        : ["off", "all", "one"].includes(saved.repeat)
          ? saved.repeat
          : "off";
    playbackContext = Array.isArray(saved.context) ? saved.context : [];
    restoredPosition = saved.position || 0;
    current = library.tracks.find((t) => t.id === saved.id);
    $("shuffle").setAttribute("aria-pressed", shuffle);
    $("repeat").setAttribute("aria-pressed", repeat !== "off");
    $("repeat").dataset.mode = repeat;
    drawPlayer();
  }
  if (navigator.audioSession) navigator.audioSession.type = "playback";
  if ("mediaSession" in navigator)
    for (const [action, handler] of Object.entries({
      play: () =>
        window.musicOutput?.remote()
          ? musicOutput.command("resume")
          : audio.src
            ? audio.play()
            : current && play(current),
      pause: () =>
        window.musicOutput?.remote()
          ? musicOutput.command("pause")
          : audio.pause(),
      nexttrack: () => next(false),
      previoustrack: () => $("previous").onclick(),
      seekto: (e) => {
        if (Number.isFinite(e.seekTime)) {
          if (window.musicOutput?.remote())
            return musicOutput.command("seek", {
              position_ms: Math.round(e.seekTime * 1000),
            });
          audio.currentTime = e.seekTime;
        }
      },
    })) {
      try {
        navigator.mediaSession.setActionHandler(action, task(handler));
      } catch {}
    }
}
window.addEventListener("online", () => {
  onlineSession = true;
  sync();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) savePlayer();
  else sync();
});
document.addEventListener("DOMContentLoaded", () =>
  boot()
    .catch((e) =>
      notice("Não foi possível abrir o armazenamento. " + e.message),
    )
    .finally(() => window.finishMusicLaunch?.()),
);

$("resume-preparation").onclick = task(async () => {
  await api("resume", {});
  await refresh();
  notice("Nova tentativa iniciada.");
});

document.querySelector(".wordmark").onclick = (event) => {
  event.preventDefault();
  navigateView("library", null);
};
document.addEventListener("keydown", (event) => {
  if (
    event.code !== "Space" ||
    event.repeat ||
    $("app").hidden ||
    event.target.closest(
      "button,a,input,textarea,select,[contenteditable=true],[role=button]",
    )
  )
    return;
  if (document.querySelector("dialog[open]") && !$("player").open) return;
  event.preventDefault();
  toggle();
});
