"use strict";
// Library UI is driven by persisted server jobs. The count advances on complete files.
let renderSignature = "";
let islandJobId = null;
let dismissedJobs = new Set();
let deviceBatch = [];
let deviceBytes = 0;
let deviceSize = 0;
let activeSaveId = null;

function collectionArt(playlist, target) {
  target.replaceChildren();
  target.classList.remove("mosaic");
  if (playlist?.art) {
    const image = new Image();
    image.src = playlist.art;
    image.alt = "";
    image.loading = "lazy";
    image.onerror = () => {
      image.onerror = null;
      target.innerHTML = icon("playlist");
    };
    target.append(image);
    return;
  }
  const ids = playlist?.tracks || [];
  const covers = [
    ...new Set(
      ids
        .map((id) => library.tracks.find((t) => t.id === id)?.art)
        .filter(Boolean),
    ),
  ].slice(0, 4);
  if (!covers.length) {
    target.innerHTML = icon(playlist?.id === "liked" ? "heart" : "playlist");
    return;
  }
  target.classList.toggle("mosaic", covers.length > 1);
  for (const src of covers) {
    const img = new Image();
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    target.append(img);
  }
}
function animateView() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const animation of document.querySelector("main").getAnimations()) {
    animation.finished.catch(() => {});
    animation.cancel();
  }
  const transition = document.querySelector("main").animate(
    [
      { opacity: 0.4, transform: "translateY(7px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  transition.finished.catch(() => {});
}
function showPlaylist(id) {
  navigateView("library", id);
}
function updatePlaylistHeader() {
  const p =
    view === "library" && library.playlists.find((p) => p.id === selected);
  $("playlist-header").hidden = !p;
  $("library-actions").hidden = view !== "library" || !!p;
  $("collections").hidden = view !== "library" || !!p;
  if (!p) return;
  $("playlist-name").textContent = p.name;
  const tracks = sourceTracks();
  const ready = tracks.filter((t) => t.status === "ready").length;
  const saved = tracks.filter((t) => offlineIds.has(t.id)).length;
  $("playlist-count").textContent =
    tracks.length +
    " músicas · " +
    ready +
    " prontas" +
    (saved ? " · " + saved + " no aparelho" : "");
  collectionArt(p, $("playlist-art"));
  $("playlist-play").disabled = !tracks.some(
    (t) => t.status === "ready" || offlineIds.has(t.id),
  );
  $("prepare-all").hidden = ready === tracks.length;
  const actionable = tracks.some(
    (t) => !["ready", "queued", "preparing"].includes(t.status),
  );
  $("prepare-all").disabled = !actionable;
  $("prepare-all").textContent = actionable ? "Preparar" : "Em preparação";
  $("download-all").disabled = !tracks.some(
    (t) => t.status === "ready" && !offlineIds.has(t.id),
  );
}
function statusLabel(t) {
  if (offlineIds.has(t.id)) return "Neste aparelho";
  return (
    {
      ready: "Pronta para ouvir",
      queued: "Na fila da nuvem",
      preparing: "Preparando na nuvem",
      error: "Falha ao preparar",
    }[t.status] || "Ainda não preparada"
  );
}
function visibleJobs() {
  const seen = new Set();
  return [...(library.jobs || [])]
    .sort((a, b) => Number(b.kind === "import") - Number(a.kind === "import"))
    .filter((job) => {
      if (dismissedJobs.has(job.id)) return false;
      const key = job.track_ids?.length
        ? [...job.track_ids].sort().join(",")
        : job.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function selectedJob() {
  const jobs = visibleJobs();
  const pinned = jobs.find(
    (j) => j.id === islandJobId && !dismissedJobs.has(j.id),
  );
  return (
    pinned ||
    jobs.find(
      (j) =>
        !dismissedJobs.has(j.id) &&
        !["complete", "partial", "error"].includes(j.status),
    ) ||
    jobs.find((j) => !dismissedJobs.has(j.id))
  );
}
function drawIsland() {
  const job = selectedJob();
  const deviceActive = saving || downloads.size > 0;
  $("island").hidden = !job && !deviceActive;
  if ($("island").hidden) {
    collapseActivity();
    return;
  }
  const active = saving
    ? library.tracks.find((t) => t.id === activeSaveId)
    : job?.current;
  const first = job?.track_ids
    ?.map((id) => library.tracks.find((t) => t.id === id))
    .find(Boolean);
  artwork(active || first, $("island-art"));
  const importing =
    job && ["queued", "importing"].includes(job.status) && !job.total;
  const paused = job?.status === "paused";
  let title = job?.name || "Salvando no aparelho";
  let detail,
    percent = 0;
  if (saving) {
    title = activeSave;
    detail = "Salvando no aparelho";
    const complete = deviceBatch.filter((id) => offlineIds.has(id)).length;
    percent = deviceBatch.length
      ? (100 * (complete + (deviceSize ? deviceBytes / deviceSize : 0))) /
        deviceBatch.length
      : 0;
  } else if (importing) {
    title = "Importando playlist";
    detail = "Lendo as músicas do Spotify";
  } else if (paused) {
    detail = "Preparação pausada · fila preservada";
    percent = job.total ? ((job.ready + job.failed) / job.total) * 100 : 0;
  } else if (job?.status === "error") {
    detail = job.message;
  } else if (job) {
    percent = job.total ? ((job.ready + job.failed) / job.total) * 100 : 0;
    detail =
      job.ready +
      " de " +
      job.total +
      " prontas" +
      (job.failed ? " · " + job.failed + " falharam" : "");
    if (job.status === "complete") detail = "Tudo pronto para ouvir e salvar";
    if (job.current) title = job.current.title;
  } else detail = downloads.size + " para salvar neste iPhone";
  $("job-title").textContent = title;
  $("job-detail").textContent = detail;
  $("job-ring").setAttribute(
    "stroke-dashoffset",
    String(100 - Math.max(0, Math.min(100, percent))),
  );
  $("job-percent").textContent = importing ? "" : Math.floor(percent) + "%";
  $("island").classList.toggle("indeterminate", !!importing);
  $("island").classList.toggle("is-paused", !!paused);
  $("island").classList.toggle(
    "is-complete",
    job?.status === "complete" && !saving,
  );
  $("job-progress").value = percent;
  $("job-meter").hidden = !!importing || job?.status === "error";
  $("job-caption").textContent = saving
    ? "Salvando arquivos completos no celular"
    : paused
      ? "A fila continua salva na VPS"
      : job
        ? job.ready +
          " prontas · " +
          job.failed +
          " falhas · " +
          job.total +
          " no total"
        : "Arquivos pendentes são retomados ao abrir o app";
  const detailSignature = JSON.stringify({
    id: job?.id,
    status: job?.status,
    ready: job?.ready,
    failed: job?.failed,
    current: active?.id,
    offline: [...offlineIds],
    pending: [...downloads],
    jobs: visibleJobs().map(j => [j.id, j.status, j.ready, j.failed]),
  });
  if ($("job-list").dataset.signature !== detailSignature) {
    $("job-list").dataset.signature = detailSignature;
    $("job-list").replaceChildren();
    const jobs = visibleJobs();
    if (jobs.length > 1 && !paused) {
      const selector = document.createElement("div");
      selector.className = "job-tabs";
      for (const other of jobs.slice(0, 8)) {
        const b = document.createElement("button");
        b.textContent = other.name;
        b.title = other.name;
        b.classList.toggle("selected", other.id === job?.id);
        b.onclick = () => {
          islandJobId = other.id;
          dismissedJobs.delete(other.id);
          drawIsland();
        };
        selector.append(b);
      }
      $("job-list").append(selector);
    }
    if (active) {
      const now = document.createElement("div");
      now.className = "job-current";
      const cover = document.createElement("div");
      cover.className = "art";
      artwork(active, cover);
      const copy = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = active.title;
      const artist = document.createElement("small");
      artist.textContent = active.artist;
      copy.append(name, artist);
      now.append(cover, copy);
      $("job-list").append(now);
    }
    const summary = document.createElement("p");
    summary.className = "job-explanation";
    summary.textContent = importing
      ? "Pode continuar navegando. A playlist aparecerá na biblioteca quando a leitura terminar."
      : job?.message ||
        "A preparação continua na VPS mesmo com o app fechado. Salve no aparelho quando as faixas estiverem prontas.";
    $("job-list").append(summary);
    const ids = job?.track_ids || [...downloads];
    const remaining = ids
      .map((id) => library.tracks.find((t) => t.id === id))
      .filter(Boolean)
      .sort(
        (a, b) => Number(b.status === "error") - Number(a.status === "error"),
      );
    for (const t of remaining.slice(0, 10)) {
      const line = document.createElement("div");
      line.className = "job-track";
      const name = document.createElement("span");
      name.textContent = t.title;
      const state = document.createElement("small");
      state.textContent = statusLabel(t);
      if (t.status === "error") {
        line.classList.add("job-track-error");
        state.textContent = t.error || "Falha ao preparar. Tente novamente.";
      }
      line.append(name, state);
      $("job-list").append(line);
    }
    if (remaining.length > 10) {
      const more = document.createElement("p");
      more.className = "hint";
      more.textContent =
        "Mais " + (remaining.length - 10) + " músicas na biblioteca";
      $("job-list").append(more);
    }
  }
  const ready = (job?.track_ids || [])
    .map((id) => library.tracks.find((t) => t.id === id))
    .filter((t) => t?.status === "ready" && !offlineIds.has(t.id));
  $("island-save").hidden = !ready.length;
  $("island-save").disabled = saving;
  $("island-retry").hidden =
    !paused && job?.status !== "partial" && job?.status !== "error";
  $("island-dismiss").hidden =
    !job;
  $("island-dismiss").textContent = paused ? "Dispensar avisos · manter fila" : "Dispensar aviso";
}
function expandIsland() {
  $("island-body").hidden = false;
  $("island-toggle").setAttribute("aria-expanded", "true");
  $("island").classList.add("expanded");
}
function hideSheet(dialog) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    dialog.close();
    return;
  }
  dialog.classList.add("closing");
  clearTimeout(dialog.closeTimer);
  dialog.closeTimer = setTimeout(() => {
    dialog.close();
    dialog.classList.remove("closing");
  }, 170);
}
$("playlist-back").onclick = () => showPlaylist(null);
$("playlist-play").onclick = task(() => {
  const tracks = sourceTracks().filter(
    (t) => t.status === "ready" || offlineIds.has(t.id),
  );
  if (tracks.length) return play(tracks[0], tracks);
});
$("prepare-all").onclick = task(async () => {
  if ($("prepare-all").disabled) return;
  $("prepare-all").disabled = true;
  const playlistId = selected;
  try {
    const result = await api("playlists/" + selected + "/prepare", {});
    islandJobId = result.job_id;
    dismissedJobs.delete(islandJobId);
    await refresh();
    if (view === "library" && selected === playlistId) expandIsland();
  } finally {
    updatePlaylistHeader();
  }
});
$("jobs-open").onclick = () => {
  const jobs = library.jobs || [];
  if (!jobs.length && !downloads.size) {
    notice("Nenhuma preparação por aqui. Importe uma playlist para começar.");
    return;
  }
  dismissedJobs.clear();
  drawIsland();
  expandIsland();
};
$("island-toggle").onclick = () => {
  const open = $("island-body").hidden;
  $("island-body").hidden = !open;
  $("island-toggle").setAttribute("aria-expanded", String(open));
  $("island").classList.toggle("expanded", open);
};
$("island-dismiss").onclick = task(async () => {
  const job = selectedJob();
  const jobs = job?.status === "paused" ? visibleJobs().filter(j => j.status === "paused") : job ? [job] : [];
  for (const item of jobs) {
    await api("jobs/" + encodeURIComponent(item.id) + "/dismiss", {});
    dismissedJobs.add(item.id);
  }
  islandJobId = null;
  await local("meta", "dismissed-jobs", [...dismissedJobs]);
  drawIsland();
});
$("island-save").onclick = task(() => {
  const job = selectedJob();
  return saveTracks(
    (job?.track_ids || [])
      .map((id) => library.tracks.find((t) => t.id === id))
      .filter((t) => t?.status === "ready"),
  );
});
$("island-retry").onclick = task(async () => {
  const job = selectedJob();
  if (!job) return;
  if (job.status === "error") {
    const r = await api("import", { url: job.source });
    islandJobId = r.job_id;
  } else {
    await api("resume", {});
    const tracks = job.track_ids
      .map((id) => library.tracks.find((t) => t.id === id))
      .filter((t) => t && t.status !== "ready");
    for (let i = 0; i < tracks.length; i += 40)
      await api("prepare", {
        tracks: tracks
          .slice(i, i + 40)
          .map((t) => ({ ...t, artists: t.artist, thumbnail: t.art })),
      });
  }
  await refresh();
});
$("clear-activity").onclick = task(async () => {
  const button = $("clear-activity");
  button.disabled = true;
  try {
    await api("jobs/cleanup", {});
    islandJobId = null;
    await refresh();
    notice("Atividades concluídas e com falha removidas.");
  } finally {
    button.disabled = false;
  }
});
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => closeSheet(b.closest("dialog"));

document.addEventListener("pointerdown", (event) => {
  if (!$("island").contains(event.target) && !$("island-body").hidden) {
    $("island-body").hidden = true;
    $("island-toggle").setAttribute("aria-expanded", "false");
    $("island").classList.remove("expanded");
  }
});
