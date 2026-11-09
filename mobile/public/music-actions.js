"use strict";

let activeConfirmation = false;
function confirmAction(
  title,
  message,
  accept = "Continuar",
  destructive = false,
) {
  if (activeConfirmation) return Promise.resolve(false);
  activeConfirmation = true;
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "music-confirm";
    const heading = document.createElement("h2");
    heading.id = "confirmation-title";
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.id = "confirmation-message";
    copy.textContent = message;
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.setAttribute("aria-describedby", copy.id);
    const actions = document.createElement("div");
    actions.className = "sheet-actions";
    const cancel = document.createElement("button");
    cancel.textContent = "Agora não";
    cancel.autofocus = true;
    const confirm = document.createElement("button");
    confirm.textContent = accept;
    confirm.className = destructive ? "danger" : "primary";
    let accepted = false;
    cancel.onclick = () => closeSheet(dialog);
    confirm.onclick = () => {
      accepted = true;
      closeSheet(dialog);
    };
    dialog.addEventListener(
      "close",
      () => {
        activeConfirmation = false;
        dialog.remove();
        resolve(accepted);
      },
      { once: true },
    );
    actions.append(cancel, confirm);
    dialog.append(heading, copy, actions);
    document.body.append(dialog);
    openSheet(dialog);
  });
}

async function addToQueue(track, next = false) {
  await ensureSaved(track);
  if (window.musicOutput?.remote()) {
    const ids = musicOutput.remote().player.queue || [];
    await musicOutput.command("queue", {
      queue: next
        ? [track.id, ...ids.filter((id) => id !== track.id)]
        : [...ids, track.id],
    });
    notice(next ? "Esta música toca a seguir" : "Adicionada ao fim da fila");
    return;
  }
  if (track.status !== "ready" && !offlineIds.has(track.id)) {
    await api("prepare", {
      tracks: [{ ...track, artists: track.artist, thumbnail: track.art }],
    });
    await refresh();
  }
  if (next) queue = [track.id, ...queue.filter((id) => id !== track.id)];
  else queue.push(track.id);
  await savePlayer();
  drawQueue();
  notice(next ? "Esta música toca a seguir" : "Adicionada ao fim da fila");
}

function choosePlaylist(track) {
  const existing = $("playlist-picker");
  if (existing?.open) return;
  existing?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "playlist-picker";
  dialog.className = "playlist-picker";
  dialog.innerHTML =
    '<header><div><h2>Adicionar à playlist</h2><p></p></div><button class="icon-button" aria-label="Fechar">' +
    icon("close") +
    '</button></header><input type="search" placeholder="Buscar playlist" aria-label="Buscar playlist" autocomplete="off"><div class="playlist-destinations"></div><button class="new-playlist">' +
    icon("plus") +
    'Nova playlist</button><p class="picker-status" role="status"></p>';
  dialog.querySelector("header p").textContent = track.title;
  dialog.querySelector("header button").onclick = () => closeSheet(dialog);
  const list = dialog.querySelector(".playlist-destinations");
  let saving = false;
  const paint = () => {
    const query = dialog.querySelector("input").value.toLocaleLowerCase();
    list.replaceChildren();
    for (const playlist of library.playlists.filter((p) =>
      p.name.toLocaleLowerCase().includes(query),
    )) {
      const added = playlist.tracks.includes(track.id);
      const button = document.createElement("button");
      button.className = "playlist-destination";
      button.disabled = added || saving;
      button.innerHTML =
        '<span class="destination-art">' +
        icon("playlist") +
        "</span><span><strong></strong><small></small></span><span>" +
        icon(added ? "check" : "plus") +
        "</span>";
      button.querySelector("strong").textContent = playlist.name;
      button.querySelector("small").textContent = added
        ? "Já adicionada"
        : playlist.tracks.length + " músicas";
      button.onclick = task(async () => {
        if (saving) return;
        saving = true;
        paint();
        try {
          await api(
            "playlists/" + encodeURIComponent(playlist.id) + "/tracks",
            { ...track, artists: track.artist, thumbnail: track.art },
          );
          await refresh();
          notice("Adicionada a “" + playlist.name + "”");
          closeSheet(dialog);
        } catch (error) {
          dialog.querySelector(".picker-status").textContent = error.message;
        } finally {
          saving = false;
          paint();
        }
      });
      list.append(button);
    }
    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = library.playlists.length
        ? "Nenhuma playlist com esse nome."
        : "Crie sua primeira playlist para guardar esta música.";
      list.append(empty);
    }
  };
  dialog.querySelector("input").oninput = paint;
  dialog.querySelector(".new-playlist").onclick = () =>
    showEntry("Nova playlist", "Nome da playlist", async (name) => {
      await ensureSaved(track);
      await api("playlists", { name: name.trim(), tracks: [track.id] });
      await refresh();
      closeSheet(dialog);
      notice("Playlist criada com esta música");
    });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  paint();
  openSheet(dialog);
}

// Keep the native select as the accessible value owner, with an in-app chooser.
for (const id of ["theme", "network"]) {
  const select = $(id);
  select.hidden = true;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "setting-picker";
  trigger.setAttribute("aria-haspopup", "dialog");
  const paint = () =>
    (trigger.innerHTML =
      "<span>" +
      select.selectedOptions[0].textContent +
      "</span>" +
      icon("down"));
  select.after(trigger);
  select.addEventListener("change", paint);
  trigger.onclick = () => {
    const dialog = document.createElement("dialog");
    dialog.className = "setting-options";
    const heading = document.createElement("h2");
    heading.textContent = id === "theme" ? "Aparência" : "Salvar no aparelho";
    dialog.append(heading);
    for (const option of select.options) {
      const button = document.createElement("button");
      button.className = "option";
      button.innerHTML =
        "<span>" +
        option.textContent +
        "</span>" +
        (option.selected ? icon("check") : "");
      button.setAttribute("aria-pressed", String(option.selected));
      button.onclick = () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        closeSheet(dialog);
      };
      dialog.append(button);
    }
    const cancel = document.createElement("button");
    cancel.className = "option";
    cancel.textContent = "Cancelar";
    cancel.onclick = () => closeSheet(dialog);
    dialog.append(cancel);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    openSheet(dialog);
  };
  trigger.refreshValue = paint;
  select.settingTrigger = trigger;
  paint();
}
