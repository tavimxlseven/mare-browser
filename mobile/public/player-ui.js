"use strict";
let playHistory = [];
let queueMode = "upcoming";

function drawQueue() {
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
    if (index >= 50) break;
    const t = library.tracks.find((t) => t.id === id);
    if (!t) continue;
    const line = row(t);
    if (queueMode === "upcoming") {
      const controls = document.createElement("span");
      controls.className = "queue-order";
      for (const [offset, name] of [
        [-1, "up"],
        [1, "down"],
      ]) {
        const button = document.createElement("button");
        button.innerHTML = icon(name);
        button.ariaLabel =
          (offset < 0 ? "Mover para cima " : "Mover para baixo ") + t.title;
        button.disabled = index + offset < 0 || index + offset >= queue.length;
        button.onclick = () => {
          const target = index + offset;
          [queue[index], queue[target]] = [queue[target], queue[index]];
          savePlayer();
          drawQueue();
        };
        controls.append(button);
      }
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
