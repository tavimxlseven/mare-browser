"use strict";
let playHistory = [];
let queueMode = "upcoming";
let queueBeforeDrag = [];
const queueSort = attachMusicSort($("queue"), {
  onStart: () => {
    queueBeforeDrag = [...queue];
  },
  onCommit: (keys) => {
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
  const ids = queueMode === "history" ? playHistory : queue;
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
$("player-queue").onclick = () => {
  const visible = $("queue-view").hidden;
  $("queue-view").hidden = !visible;
  $("album-view").hidden = visible;
  $("player").classList.toggle("queue-mode", visible);
  $("player-queue").setAttribute("aria-pressed", String(visible));
  drawQueue();
};
$("upcoming-tab").onclick = () => {
  queueMode = "upcoming";
  drawQueue();
};
$("history-tab").onclick = () => {
  queueMode = "history";
  drawQueue();
};
$("clear-history").onclick = task(async () => {
  playHistory = [];
  await local("meta", "history", []);
  drawQueue();
});
$("player-like").onclick = task(async () => {
  if (!current) return;
  const t = library.tracks.find((t) => t.id === current.id) || current;
  await api("tracks/" + t.id, { liked: !t.liked });
  await refresh();
});
$("player-more").onclick = () => current && options(current);
$("previous").onclick = task(async () => {
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
  showEntry("Renomear playlist", "Novo nome", async (name) => {
    await api("playlists", { id: playlist.id, name, tracks: playlist.tracks });
    await refresh();
  });
  const form = $("entry-form");
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
};

attachMusicHold(document.body,{
 selector:'.track',
 sorter:row=>row.dataset.sortKey!==undefined?(row.closest('#queue')?queueSort:playlistSort):null,
 menu:row=>{const track=library.tracks.find(t=>t.id===row.dataset.trackId);if(track)options(track);}
});
