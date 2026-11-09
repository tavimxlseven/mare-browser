"use strict";
let playHistory = [];
let queueMode = "upcoming";
let queueBeforeDrag = [];
const queueSort = attachMusicSort($("queue"), {
  onStart: () => {
    queueBeforeDrag = [
      ...(window.musicOutput?.remote()?.player.queue || queue),
    ];
  },
  onCommit: (keys) => {
    if (window.musicOutput?.remote()) {
      musicOutput
        .command("queue", {
          queue: keys
            .map((key) => queueBeforeDrag[Number(key)])
            .filter(Boolean),
        })
        .catch((e) => notice(e.message));
      return;
    }
    queue = keys.map((key) => queueBeforeDrag[Number(key)]).filter(Boolean);
    savePlayer();
    drawQueue();
  },
});
const playlistSort = attachMusicSort($("tracks"), {
  onCommit: async (order) => {
    const playlist = library.playlists.find((p) => p.id === selected);
    if (!playlist) return;
    try {
      await api("playlists/" + encodeURIComponent(playlist.id) + "/reorder", {
        order,
      });
      playlist.tracks = order;
      await local("meta", "library", library);
      render(true);
    } catch (error) {
      notice(error.message);
      await refresh();
    }
  },
});
function dragHandle(name) {
  const button = document.createElement("button");
  button.className = "sort-handle";
  button.dataset.sortHandle = "";
  button.ariaLabel = "Reordenar " + name + ". Use as setas para mover.";
  button.innerHTML = icon("grip");
  return button;
}
async function selectQueue(index) {
  if (window.musicOutput?.remote()) {
    const ids = musicOutput.remote().player.queue || [];
    const track = library.tracks.find((t) => t.id === ids[index]);
    if (track) await musicOutput.play(track, ids.slice(index + 1));
    return;
  }
  const before = [...queue];
  const track = library.tracks.find((t) => t.id === before[index]);
  if (track && (await play(track))) {
    queue = before.slice(index + 1);
    savePlayer();
    drawQueue();
  }
}

function drawQueue() {
  if (queueSort.dragging) return;
  const container = $("queue");
  container.replaceChildren();
  const remote = window.musicOutput?.remote();
  if (remote) queueMode = "upcoming";
  $("history-tab").disabled = !!remote;
  $("shuffle").disabled = $("repeat").disabled = !!remote;
  const ids = remote
    ? remote.player.queue || []
    : queueMode === "history"
      ? playHistory
      : queue;
  $("clear-history").hidden = queueMode !== "history" || !ids.length;
  $("upcoming-tab").setAttribute(
    "aria-selected",
    String(queueMode === "upcoming"),
  );
  $("history-tab").setAttribute(
    "aria-selected",
    String(queueMode === "history"),
  );
  if (!ids.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      queueMode === "history"
        ? "As músicas que você ouvir aparecem aqui."
        : "Adicione músicas à fila pelas opções de cada faixa.";
    container.append(empty);
    return;
  }
  for (const [index, id] of ids.entries()) {
    const t = library.tracks.find((t) => t.id === id);
    if (!t) continue;
    const line = row(t);
    if (queueMode === "upcoming") {
      line.dataset.sortKey = String(index);
      line.querySelector(".title").onclick = task(() => selectQueue(index));
      const controls = document.createElement("span");
      controls.className = "queue-order";
      controls.append(dragHandle(t.title));
      line.querySelector(".track-state")?.remove();
      line.append(controls);
    }
    container.append(line);
  }
}
let queueEntrance = [];
function revealQueueSurface(surface) {
  queueEntrance.forEach((animation) => animation.cancel());
  queueEntrance = [];
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (typeof surface.animate !== "function") return;
  queueEntrance.push(
    surface.animate(
      [
        { opacity: 0, transform: "translateY(14px) scale(.985)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      { duration: 280, easing: "cubic-bezier(.22,.8,.25,1)" },
    ),
  );
  if (surface.id === "queue-view") {
    surface.querySelectorAll("#queue > .track").forEach((row, index) => {
      if (index >= 8) return;
      queueEntrance.push(
        row.animate(
          [
            { opacity: 0, transform: "translateX(12px)" },
            { opacity: 1, transform: "translateX(0)" },
          ],
          {
            duration: 230,
            delay: index * 18,
            fill: "backwards",
            easing: "cubic-bezier(.22,.8,.25,1)",
          },
        ),
      );
    });
  }
}
$("player-queue").onclick = () => {
  const visible = $("queue-view").hidden;
  $("queue-view").hidden = !visible;
  $("album-view").hidden = visible;
  $("player").classList.toggle("queue-mode", visible);
  $("player-queue").setAttribute("aria-pressed", String(visible));
  drawQueue();
  revealQueueSurface($(visible ? "queue-view" : "album-view"));
};
$("upcoming-tab").onclick = () => {
  queueMode = "upcoming";
  drawQueue();
  revealQueueSurface($("queue-view"));
};
$("history-tab").onclick = () => {
  queueMode = "history";
  drawQueue();
  revealQueueSurface($("queue-view"));
};
$("clear-history").onclick = task(async () => {
  playHistory = [];
  await local("meta", "history", []);
  drawQueue();
});
$("player-like").onclick = task(async () => {
  const shown = window.getMusicDisplayTrack
    ? window.getMusicDisplayTrack()
    : current;
  if (!shown) return;
  const t = library.tracks.find((t) => t.id === shown.id) || shown;
  await api("tracks/" + t.id, { liked: !t.liked });
  await refresh();
});
$("player-more").onclick = () => {
  const shown = window.getMusicDisplayTrack
    ? window.getMusicDisplayTrack()
    : current;
  if (shown) options(shown);
};
$("previous").onclick = task(async () => {
  if (!window.applyingDeviceCommand && window.musicOutput?.remote())
    return musicOutput.command("previous");
  if (audio.currentTime > 3 || !playHistory.length) {
    audio.currentTime = 0;
    return;
  }
  const id = playHistory.shift();
  const t = library.tracks.find((t) => t.id === id);
  if (current) queue.unshift(current.id);
  if (t) {
    current = null;
    await play(t);
  }
  await local("meta", "history", playHistory);
});
for (const button of document.querySelectorAll("[data-library-filter]")) {
  button.onclick = () => {
    const filter = button.dataset.libraryFilter;
    if (filter === "playlists") {
      $("collections").scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
      return;
    }
    showPlaylist(filter === "liked" ? "liked" : "all");
  };
}

$("playlist-options").onclick = () => {
  const playlist = library.playlists.find((p) => p.id === selected);
  if (!playlist) return;
  let editedCover;
  showEntry("Editar playlist", "Nome da playlist", async (name) => {
    await api("playlists/" + encodeURIComponent(playlist.id) + "/metadata", {
      name,
      ...(editedCover !== undefined ? { art: editedCover } : {}),
    });
    await refresh();
  });
  const form = $("entry-form");
  form.querySelector(".primary").textContent = "Salvar alterações";
  const editor = document.createElement("div");
  editor.id = "playlist-cover-editor";
  editor.innerHTML =
    '<div class="playlist-cover-preview"></div><label class="cover-upload">Escolher capa<input type="file" accept="image/png,image/jpeg,image/webp" hidden></label><button type="button" class="cover-reset">Usar capa automática</button><small role="status"></small>';
  form.prepend(editor);
  const paint = (art) => {
    const container = editor.querySelector(".playlist-cover-preview");
    container.replaceChildren();
    if (art) {
      const image = new Image();
      image.src = art;
      image.alt = "Capa da playlist";
      container.append(image);
    } else container.innerHTML = icon("playlist");
  };
  paint(playlist.art);
  editor.querySelector("[type=file]").onchange = async (event) => {
    const save = form.querySelector(".primary"),
      status = editor.querySelector("[role=status]");
    save.disabled = true;
    status.textContent = "Preparando capa…";
    try {
      editedCover = await window.prepareMusicCover(event.target.files?.[0]);
      paint(editedCover);
      status.textContent = "Capa pronta para salvar.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      save.disabled = false;
      event.target.value = "";
    }
  };
  editor.querySelector(".cover-reset").onclick = () => {
    editedCover = "";
    paint("");
  };
  let remove = $("delete-playlist");
  if (!remove) {
    remove = document.createElement("button");
    remove.id = "delete-playlist";
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Excluir playlist";
    form.append(remove);
  }
  remove.hidden = false;
  remove.onclick = task(async () => {
    if (
      !(await confirmAction(
        "Excluir playlist?",
        "As músicas continuam na sua biblioteca.",
        "Excluir playlist",
        true,
      ))
    )
      return;
    await api("playlists/" + playlist.id + "/delete", {});
    selected = null;
    closeSheet($("entry"));
    await refresh();
  });
  $("entry-value").value = playlist.name;
  $("entry-value").maxLength = 100;
};

attachMusicHold(document.body, {
  selector: ".track",
  sorter: (row) =>
    row.dataset.sortKey !== undefined
      ? row.closest("#queue")
        ? queueSort
        : playlistSort
      : null,
  menu: (row) => {
    const track = library.tracks.find((t) => t.id === row.dataset.trackId);
    if (track) options(track);
  },
});
