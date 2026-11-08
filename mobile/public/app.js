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
  repeat = false,
  restoredPosition = 0;
let downloads = new Set(),
  saving = false,
  activeSave = "",
  onlineSession = false;
const audio = $("audio");
const database = new Promise((resolve, reject) => {
  const open = indexedDB.open("mare-music", 1);
  open.onupgradeneeded = () => {
    for (const name of ["meta", "audio"]) open.result.createObjectStore(name);
  };
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});
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
async function api(path, data) {
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) onlineSession = false;
    throw new Error(result.error || "Não foi possível concluir.");
  }
  return result;
}
function task(fn) {
  return (...args) =>
    Promise.resolve(fn(...args)).catch((e) => notice(e.message));
}
function artwork(track, target) {
  target.replaceChildren();
  if (track?.art) {
    const img = new Image();
    img.src = track.art;
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
  if (selected) {
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
          ? " · No iPhone"
          : track.status === "ready"
            ? " · Na nuvem"
            : "");
  title.append(name, artist);
  title.onclick = task(() => play(track, list));
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
    for (const p of [
      { id: null, name: "Todas as músicas" },
      { id: "liked", name: "Curtidas" },
      ...library.playlists,
    ]) {
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
  const playlist = library.playlists.find((p) => p.id === selected);
  $("list-title").textContent =
    selected === "liked"
      ? "Músicas curtidas"
      : playlist?.name || (view === "search" ? "Resultados" : "Suas músicas");
  $("download-all").hidden = !playlist || view !== "library";
  updatePlaylistHeader();
  const list = sourceTracks();
  $("tracks").replaceChildren(...list.map((t) => row(t, list)));
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
    const button = e.submitter;
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
  $("entry").showModal();
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
      dialog.close();
      await fn();
    });
    dialog.append(b);
  };
  add("Salvar no iPhone", () => saveTracks([track]));
  add(track.liked ? "Remover das curtidas" : "Curtir", async () => {
    await ensureSaved(track);
    await api("tracks/" + track.id, { liked: !track.liked });
    await refresh();
  });
  add("Adicionar à fila", () => {
    queue.push(track.id);
    savePlayer();
    drawQueue();
    notice("Adicionada à fila");
  });
  add("Adicionar à playlist", () =>
    showEntry("Adicionar à playlist", "Nome da playlist", async (name) => {
      await ensureSaved(track);
      const p = library.playlists.find(
        (p) => p.name.toLowerCase() === name.trim().toLowerCase(),
      );
      await api("playlists", {
        id: p?.id,
        name: name.trim(),
        tracks: [...new Set([...(p?.tracks || []), track.id])],
      });
      await refresh();
    }),
  );
  if (offlineIds.has(track.id))
    add("Remover download deste iPhone", async () => {
      await local("audio", track.id, undefined, true);
      offlineIds.delete(track.id);
      render();
    });
  add("Excluir da biblioteca", async () => {
    if (!confirm("Excluir esta música da biblioteca e do iPhone?")) return;
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
  dialog.showModal();
}
async function ensureSaved(t) {
  if (!library.tracks.some((x) => x.id === t.id)) {
    await api("prepare", {
      tracks: [{ ...t, artists: t.artist, thumbnail: t.art }],
    });
    await refresh();
  }
}
async function refresh() {
  library = await api("library");
  onlineSession = true;
  await local("meta", "library", library);
  $("connection").hidden = true;
  render();
  drawIsland();
}
async function saveTracks(tracks) {
  tracks = tracks.filter((t) => !offlineIds.has(t.id));
  if (!tracks.length) {
    notice("Essas músicas já estão neste iPhone.");
    return;
  }
  if (
    (await local("meta", "network")) !== "any" &&
    !confirm(
      "Salvar no iPhone agora? Confirme que está no Wi-Fi. Se a rede mudar, o iPhone pode usar dados móveis.",
    )
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
async function drain() {
  if (saving || !navigator.onLine || document.hidden || !downloads.size) return;
  const ready = [...downloads].filter((id) =>
    library.tracks.some((t) => t.id === id && t.status === "ready"),
  );
  if (!ready.length) return;
  saving = true;
  try {
    for (const id of ready) {
      if (document.hidden) break;
      const t = library.tracks.find((t) => t.id === id);
      activeSave = t.title;
      activeSaveId = id;
      deviceBytes = 0;
      deviceSize = 0;
      drawIsland();
      const response = await fetch("/media/" + id);
      if (!response.ok)
        throw new Error("Falha ao salvar no iPhone. Abra o app para retomar.");
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
      await local("audio", id, blob);
      offlineIds.add(id);
      downloads.delete(id);
      await local("meta", "downloads", [...downloads]);
      render();
      drawIsland();
    }
    if (!downloads.size) notice("Músicas salvas neste iPhone.");
  } catch (error) {
    notice(
      error.name === "QuotaExceededError"
        ? "O iPhone está sem espaço para salvar a música. Libere espaço e tente novamente."
        : error.message,
    );
  } finally {
    saving = false;
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
  }).catch(() => {});
}
async function play(track, list) {
  track = library.tracks.find((t) => t.id === track.id) || track;
  if (list) queue = list.map((t) => t.id).filter((id) => id !== track.id);
  if (!offlineIds.has(track.id) && track.status !== "ready") {
    await api("prepare", {
      tracks: [{ ...track, artists: track.artist, thumbnail: track.art }],
    });
    await refresh();
    notice(
      "Preparando na nuvem. Toque em reproduzir quando a faixa estiver pronta.",
    );
    return;
  }
  const blob = await local("audio", track.id);
  audio.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = blob ? URL.createObjectURL(blob) : "";
  audio.src = objectUrl || "/media/" + track.id;
  if (restoredPosition) {
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
  current = track;
  drawPlayer();
  await audio.play();
  savePlayer();
}
function drawPlayer() {
  if (!current) return;
  $("mini").hidden = false;
  $("mini-title").textContent = current.title;
  $("mini-artist").textContent = current.artist;
  $("mini-art").src = current.art || "/icon-192.png";
  $("player-title").textContent = current.title;
  $("player-artist").textContent = current.artist;
  artwork(current, $("cover"));
  drawQueue();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: "Maré Música",
      artwork: current.art
        ? [{ src: current.art }]
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
function drawQueue() {
  $("queue").replaceChildren();
  for (const id of queue.slice(0, 30)) {
    const t = library.tracks.find((t) => t.id === id);
    if (t) $("queue").append(row(t));
  }
}
async function next() {
  if (repeat && current) {
    audio.currentTime = 0;
    await audio.play();
    return;
  }
  if (!queue.length) {
    audio.pause();
    return;
  }
  const index = shuffle ? Math.floor(Math.random() * queue.length) : 0;
  const [id] = queue.splice(index, 1);
  const t = library.tracks.find((t) => t.id === id);
  if (t) await play(t);
  savePlayer();
}
function toggle() {
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
  $("mini-play").innerHTML = $("big-play").innerHTML = icon(
    audio.paused ? "play" : "pause",
  );
  $("mini").classList.toggle("playing", !audio.paused);
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  savePlayer();
};
audio.ontimeupdate = () => {
  $("elapsed").textContent = stamp(audio.currentTime);
  $("duration").textContent = stamp(audio.duration);
  $("seek").value = audio.duration
    ? (audio.currentTime / audio.duration) * 100
    : 0;
  $("mini-progress").value = Number($("seek").value);
  if (Math.floor(audio.currentTime) % 5 === 0) savePlayer();
};
audio.onended = task(next);
audio.onerror = () =>
  notice(
    "Não foi possível tocar. Verifique se a música está pronta ou salva no iPhone.",
  );
$("seek").onchange = () => {
  if (Number.isFinite(audio.duration))
    audio.currentTime = (audio.duration * Number($("seek").value)) / 100;
  savePlayer();
};
$("mini-play").onclick = $("big-play").onclick = toggle;
$("next").onclick = $("forward").onclick = task(next);
$("previous").onclick = () => {
  audio.currentTime = 0;
};
$("shuffle").onclick = () => {
  shuffle = !shuffle;
  $("shuffle").setAttribute("aria-pressed", shuffle);
  savePlayer();
};
$("repeat").onclick = () => {
  repeat = !repeat;
  $("repeat").setAttribute("aria-pressed", repeat);
  savePlayer();
};
$("open-player").onclick = () => {
  $("player").showModal();
  drawQueue();
};
$("save-current").onclick = task(() => current && saveTracks([current]));
$("search-form").onsubmit = task(async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    results = (
      await api("search?q=" + encodeURIComponent($("query").value.trim()))
    ).tracks;
    render();
  } finally {
    b.disabled = false;
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
    view = b.dataset.view;
    selected = null;
    render();
    animateView();
  };
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => b.closest("dialog").close();
$("settings").onclick = task(async () => {
  $("preferences").showModal();
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
      : "O iPhone gerencia o espaço automaticamente. Mantenha espaço livre para preservar downloads.",
  ),
);
$("login-form").onsubmit = task(async (e) => {
  e.preventDefault();
  await api("login", { password: $("password").value });
  $("password").value = "";
  $("login").hidden = true;
  $("app").hidden = false;
  await refresh();
});
$("logout").onclick = task(async () => {
  if (!confirm("Sair e apagar músicas salvas deste iPhone?")) return;
  await api("logout", {});
  audio.pause();
  const db = await database;
  const tx = db.transaction(["meta", "audio"], "readwrite");
  tx.objectStore("meta").clear();
  tx.objectStore("audio").clear();
  tx.oncomplete = () => location.reload();
});
let syncing = false;
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
  if (!installed) return;
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
  library = (await local("meta", "library")) || library;
  downloads = new Set((await local("meta", "downloads")) || []);
  deviceBatch = (await local("meta", "device-batch")) || [...downloads];
  dismissedJobs = new Set((await local("meta", "dismissed-jobs")) || []);
  selected = (await local("meta", "selected")) || null;
  const db = await database;
  offlineIds = new Set(
    await new Promise((resolve, reject) => {
      const r = db.transaction("audio").objectStore("audio").getAllKeys();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }),
  );
  $("theme").value = (await local("meta", "theme")) || "dark";
  document.body.classList.toggle("light", $("theme").value === "light");
  $("network").value = (await local("meta", "network")) || "wifi";
  try {
    await refresh();
    $("app").hidden = false;
  } catch (e) {
    if (navigator.onLine) {
      $("login").hidden = false;
      notice(e.message);
      return;
    }
    if (!library.tracks.length) {
      $("login").hidden = false;
      notice("Conecte à internet para o primeiro acesso.");
      return;
    }
    $("app").hidden = false;
    $("connection").hidden = false;
    $("connection").textContent = "Offline · músicas neste iPhone";
    render();
  }
  const saved = await local("meta", "player");
  if (saved) {
    queue = saved.queue || [];
    shuffle = !!saved.shuffle;
    repeat = !!saved.repeat;
    restoredPosition = saved.position || 0;
    current = library.tracks.find((t) => t.id === saved.id);
    $("shuffle").setAttribute("aria-pressed", shuffle);
    $("repeat").setAttribute("aria-pressed", repeat);
    drawPlayer();
  }
  if (navigator.audioSession) navigator.audioSession.type = "playback";
  if ("mediaSession" in navigator)
    for (const [action, handler] of Object.entries({
      play: () => (audio.src ? audio.play() : current && play(current)),
      pause: () => audio.pause(),
      nexttrack: next,
      previoustrack: () => (audio.currentTime = 0),
      seekto: (e) => {
        if (Number.isFinite(e.seekTime)) audio.currentTime = e.seekTime;
      },
    })) {
      try {
        navigator.mediaSession.setActionHandler(action, task(handler));
      } catch {}
    }
  await drain();
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
  boot().catch((e) =>
    notice("Não foi possível abrir o armazenamento. " + e.message),
  ),
);

$("resume-preparation").onclick = task(async () => {
  await api("resume", {});
  await refresh();
  notice("Nova tentativa iniciada.");
});
