window.attachMusicTools = function ({
  element,
  data,
  rows,
  invoke,
  icon,
  escape: esc,
  localFor,
  layout,
  decorateSlider,
  queue,
  queueChanged,
  currentCollection,
  redraw,
  notify,
  output = () => null,
}) {
  const $ = (selector) => element.querySelector(selector);
  let searching = false,
    term = "",
    timer = 0,
    busy = false,
    sleepDeadline = 0,
    sleepAtEnd = false;
  const searchInput = $(".spotify-search");
  searchInput.placeholder = "O que você quer ouvir?";
  searchInput.setAttribute("aria-label", "Pesquisar músicas e artistas");

  function modal(title, body) {
    const d = document.createElement("dialog");
    d.className = "music-dialog";
    d.innerHTML =
      "<header><h3>" +
      esc(title) +
      '</h3><button type="button" aria-label="Fechar">' +
      icon("close") +
      "</button></header>" +
      body;
    d.querySelector("header button").onclick = () => d.close();
    d.onclose = () => d.remove();
    element.append(d);
    d.showModal();
    if (
      layout.config.motion !== false &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      d.animate(
        [
          { opacity: 0, transform: "translateY(10px) scale(.98)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 200, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    return d;
  }

  async function search() {
    if (term.trim().length < 2) return;
    await invoke("search", { query: term });
    redraw();
  }

  searchInput.oninput = (event) => {
    term = event.target.value;
    searching = !!term;
    clearTimeout(timer);
    redraw();
    if (term.trim().length >= 2) timer = setTimeout(search, 450);
  };

  /* ── renderSearch ───────────────────────────────────────────────────── */
  function renderSearch() {
    const result = data().search || {};
    $(".music-heading").classList.remove("music-playlist-heading");
    $(".music-list-heading").hidden = true;
    $(".music-heading").innerHTML =
      '<div><small class="music-section-label">Descobrir</small><h2>' +
      esc(
        term
          ? "Resultados para \u201c" + term + "\u201d"
          : "Encontre sua próxima música",
      ) +
      '</h2><p>Busque pelo nome da música ou do artista.</p></div><button class="music-add" data-action="add">' +
      icon("plus") +
      " Importar playlist</button>";

    // tabs
    let html =
      '<div class="music-search-tabs"><button data-action="library">Sua biblioteca</button><button data-action="catalog_focus" aria-pressed="true">Buscar músicas</button></div>';

    // states: loading, error, results, empty
    if (result.query !== term.trim() || result.state === "loading") {
      html +=
        '<div class="music-empty" role="status"><span>' +
        icon("music") +
        "</span><h3>Buscando músicas…</h3><p>Consultando o catálogo.</p></div>";
    } else if (result.state === "error") {
      html +=
        '<div class="music-empty" role="alert"><span>' +
        icon("close") +
        "</span><h3>Não foi possível pesquisar</h3><p>" +
        esc(result.error) +
        '</p><button class="music-green" data-action="retry_search">Tentar novamente</button></div>';
    } else if (!result.items || result.items.length === 0) {
      html +=
        '<div class="music-empty"><span>' +
        icon("search") +
        "</span><h3>Nenhum resultado</h3><p>Tente outro título ou artista.</p></div>";
    } else {
      html +=
        '<div class="music-search-results">' +
        (result.items || [])
          .map((t) => {
            const local = localFor(t),
              ready = local?.available,
              stored = data().entries.some((entry) => entry.uri === t.uri);
            return (
              '<article class="music-search-row"><img src="' +
              esc(t.thumbnail) +
              '" alt="" loading="lazy"><div><strong>' +
              esc(t.title) +
              "</strong><small>" +
              esc(t.artists) +
              " · " +
              Math.floor(t.duration_ms / 60000) +
              ":" +
              String(Math.floor(t.duration_ms / 1000) % 60).padStart(2, "0") +
              "</small></div>" +
              (ready
                ? '<button data-action="play_local" data-id="' +
                  local.id +
                  '" data-uri="' +
                  esc(t.uri) +
                  '" aria-label="Reproduzir ' +
                  esc(t.title) +
                  '">' +
                  icon("play") +
                  "</button>"
                : '<button data-action="search_download" data-uri="' +
                  esc(t.uri) +
                  '" ' +
                  (busy || data().download?.state === "running"
                    ? "disabled"
                    : "") +
                  ' aria-label="Baixar ' +
                  esc(t.title) +
                  '">' +
                  icon("download") +
                  "</button>") +
              '<button data-action="search_add" data-uri="' +
              esc(t.uri) +
              '" ' +
              (stored || busy ? "disabled " : "") +
              'aria-label="' +
              (stored ? "Já na biblioteca: " : "Adicionar ") +
              esc(t.title) +
              ' à biblioteca">' +
              icon(stored ? "check" : "plus") +
              "</button></article>"
            );
          })
          .join("") +
        "</div>";
    }

    html +=
      '<p class="music-search-source">Metadados Spotify fornecidos pelo XWolf. Busca sem conectar uma conta; os downloads continuam pelo componente interno.</p>';
    $(".spotify-library").innerHTML = html;
  }

  /* ── sleepDialog ────────────────────────────────────────────────────── */
  function sleepDialog() {
    const d = modal(
      "Temporizador",
      '<p>Pause a música automaticamente.</p><div class="music-destinations">' +
        [15, 30, 60]
          .map(
            (n) =>
              '<button data-sleep="' + n + '">Em ' + n + " minutos</button>",
          )
          .join("") +
        '<button data-sleep="end">Ao terminar esta faixa</button><button data-sleep="off">Desativar temporizador</button></div>',
    );
    d.querySelectorAll("[data-sleep]").forEach(
      (button) =>
        (button.onclick = () => {
          const value = button.dataset.sleep;
          sleepAtEnd = value === "end";
          sleepDeadline = /^\d+$/.test(value)
            ? Date.now() + Number(value) * 60000
            : 0;
          d.close();
          notify(
            value === "off"
              ? "Temporizador desativado."
              : "Temporizador definido.",
          );
        }),
    );
  }

  /* ── songMenu ───────────────────────────────────────────────────────── */
  function playlistPicker(row) {
    const imported = data().entries.filter(
      (entry) => entry.kind === "playlist",
    );
    const choices = [
      ...data().collections.map((c) => ({
        key: "c:" + c.id,
        name: c.name,
        detail: c.uris.length + " músicas",
        added: c.uris.includes(row.uri),
      })),
      ...imported.map((p) => ({
        key: p.uri,
        name: p.title,
        detail: "Importada · cópia no Maré",
        added:
          (data().playlist_additions?.[p.uri] || []).includes(row.uri) ||
          (data().playlist?.uri === p.uri &&
            data().playlist.tracks?.some((t) => t.uri === row.uri)),
      })),
    ];
    const d = modal(
      "Adicionar à playlist",
      "<p>" +
        esc(row.title) +
        '</p><input class="music-destination-search" type="search" placeholder="Buscar playlist" aria-label="Buscar playlist"><div class="music-destinations"></div><form class="music-create-destination"><label>Nova playlist<input name="name" maxlength="60" required placeholder="Nome da playlist"></label><button class="music-green">Criar e adicionar</button></form><p role="status"></p>',
    );
    d.classList.add("music-playlist-picker");
    const list = d.querySelector(".music-destinations");
    let saving = false;
    const addTo = async (key) => {
      if (saving) return;
      saving = true;
      paint();
      const result = await invoke("add_to_playlist", {
        uri: row.uri,
        ...(key.startsWith("c:")
          ? { collection: Number(key.slice(2)) }
          : { playlist: key }),
      });
      saving = false;
      if (result) {
        d.close();
        redraw();
        notify("Música adicionada à playlist.");
      } else {
        d.querySelector("[role=status]").textContent =
          "Não foi possível adicionar. Tente novamente.";
        paint();
      }
    };
    const paint = () => {
      const term = d
        .querySelector(".music-destination-search")
        .value.toLocaleLowerCase();
      list.innerHTML =
        choices
          .filter((c) => c.name.toLocaleLowerCase().includes(term))
          .map(
            (c) =>
              '<button data-target-playlist="' +
              esc(c.key) +
              '" ' +
              (c.added || saving ? "disabled" : "") +
              '><span class="music-destination-art">' +
              icon("library") +
              "</span><span><strong>" +
              esc(c.name) +
              "</strong><small>" +
              (c.added ? "Já adicionada" : esc(c.detail)) +
              "</small></span>" +
              icon(c.added ? "check" : "plus") +
              "</button>",
          )
          .join("") || "<p>Nenhuma playlist encontrada. Crie uma abaixo.</p>";
      list
        .querySelectorAll("[data-target-playlist]")
        .forEach(
          (button) =>
            (button.onclick = () => addTo(button.dataset.targetPlaylist)),
        );
      d.querySelector("form button").disabled = saving;
    };
    d.querySelector(".music-destination-search").oninput = paint;
    d.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      paint();
      const result = await invoke("create_collection", {
        name: event.target.elements.name.value.trim(),
      });
      saving = false;
      if (result) await addTo("c:" + result.collections.at(-1).id);
      else paint();
    };
    paint();
  }
  function songMenu(row, x, y) {
    element.querySelector(".music-context")?.remove();
    const menu = document.createElement("div");
    menu.className = "music-context";
    menu.setAttribute("role", "menu");
    const playable =
      !!row.local?.available ||
      (!!output()?.remote() && row.uri?.startsWith("spotify:track:"));
    const menuGlyph = {
      play: "play",
      play_next: "next",
      queue: "queue",
      favorite: "heart",
      collection: "folder",
      remove_collection: "close",
      download: "download",
      details: "info",
      artist: "search",
      share: "share",
      sleep: "clock",
      delete: "trash",
      remove: "unlink",
    };
    const item = (action, title, disabled = false) =>
      '<button role="menuitem" class="' +
      (["delete", "remove"].includes(action) ? "danger" : "") +
      '" data-song-menu="' +
      action +
      '" ' +
      (disabled ? "disabled" : "") +
      ">" +
      icon(menuGlyph[action] || "music") +
      "<span>" +
      esc(title) +
      "</span></button>";
    menu.innerHTML =
      item("play", "Reproduzir", !playable) +
      item("play_next", "Tocar a seguir", !playable) +
      item("queue", "Adicionar à fila", !playable) +
      item(
        "favorite",
        row.favorite ? "Remover das curtidas" : "Adicionar às músicas curtidas",
        !row.uri,
      ) +
      item("collection", "Adicionar à playlist", !row.uri) +
      (currentCollection()
        ? item("remove_collection", "Remover desta playlist")
        : "") +
      "<hr>" +
      item(
        "download",
        row.local?.available ? "Download confirmado" : "Baixar música",
        !!row.local?.available || !row.uri,
      ) +
      item("details", "Detalhes da faixa") +
      item("artist", "Buscar artista", !row.artists) +
      item("share", "Copiar link", !row.uri) +
      item("sleep", "Temporizador") +
      (row.local?.available
        ? "<hr>" + item("delete", "Excluir download…")
        : "") +
      (row.uri ? item("remove", "Remover link da biblioteca…") : "");
    element.append(menu);
    menu.style.left = Math.max(8, Math.min(x, innerWidth - 290)) + "px";
    menu.style.top =
      Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + "px";
    menu.querySelector("button:not(:disabled)")?.focus();
    menu.onkeydown = (event) => {
      if (event.key === "Escape") {
        menu.remove();
        return;
      }
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const buttons = [...menu.querySelectorAll("button:not(:disabled)")],
          at = buttons.indexOf(document.activeElement);
        buttons[
          (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
        ].focus();
      }
    };
    menu.onclick = async (event) => {
      const action = event.target.closest("[data-song-menu]")?.dataset.songMenu;
      if (!action) return;
      menu.remove();
      if (action === "remove") {
        element
          .querySelector(
            '[data-action="remove"][data-uri="' + CSS.escape(row.uri) + '"]',
          )
          ?.click();
        return;
      }
      if (
        output()?.remote() &&
        ["play", "queue", "play_next"].includes(action)
      ) {
        const id = row.uri.split(":").at(-1),
          ids = output().remote().player.queue || [];
        if (action === "play")
          await output().play({
            id,
            title: row.title,
            artist: row.artists,
            art: row.thumbnail,
          });
        else
          await output().command("queue", {
            queue:
              action === "play_next"
                ? [id, ...ids.filter((i) => i !== id)]
                : [...ids, id],
          });
        notify(
          action === "play_next"
            ? "Esta música toca a seguir."
            : "Fila atualizada no dispositivo de saída.",
        );
        return;
      }
      if (action === "queue" || action === "play_next") {
        if (action === "play_next") queue.playNext(row.local.id);
        else queue.add(row.local.id);
        queueChanged(row);
        notify(
          action === "play_next"
            ? "Esta música toca a seguir."
            : "Música adicionada ao fim da fila.",
        );
        return;
      }
      if (action === "play") {
        [...element.querySelectorAll("[data-action=play_local]")]
          .find((b) => Number(b.dataset.id) === row.local.id)
          ?.click();
        return;
      }
      if (action === "remove_collection") {
        await invoke("remove_from_collection", {
          uri: row.uri,
          id: currentCollection(),
        });
        redraw();
        return;
      }
      if (action === "sleep") return sleepDialog();
      if (action === "details")
        return modal(
          "Detalhes da faixa",
          "<p><strong>" +
            esc(row.title) +
            "</strong></p><p>" +
            esc(row.artists || row.local?.artists || "Artista não informado") +
            "</p><p>" +
            (row.uri?.startsWith("youtube:") ? "YouTube" : "Spotify") +
            " · " +
            (row.local?.available ? "Baixada" : "Não baixada") +
            "</p>",
        );
      if (action === "artist") {
        searching = true;
        term = row.artists;
        searchInput.value = term;
        redraw();
        return search();
      }
      if (action === "share") {
        const link =
          row.url ||
          (row.uri.startsWith("spotify:")
            ? "https://open.spotify.com/" +
              row.uri.split(":").slice(1).join("/")
            : "https://www.youtube.com/watch?v=" + row.uri.split(":").at(-1));
        window.mare.copy(link);
        return;
      }
      if (action === "favorite" || action === "collection") {
        if (
          !data().entries.some((t) => t.uri === row.uri) &&
          !(await invoke("save_link", {
            url: row.uri,
            title: row.title,
            artists: row.artists,
            thumbnail: row.thumbnail,
          }))
        )
          return;
        if (action === "favorite") {
          await invoke("favorite", { uri: row.uri });
          redraw();
          return;
        }
        return playlistPicker(row);
      }
      const wanted = action === "delete" ? "delete_local" : "download";
      const button = [
        ...element.querySelectorAll("[data-action=" + wanted + "]"),
      ].find((b) =>
        action === "delete"
          ? Number(b.dataset.id) === row.local.id
          : b.dataset.uri === row.uri,
      );
      button?.click();
    };
  }

  const context = (event) => {
    const article = event.target.closest(".spotify-item");
    if (!article) return;
    event.preventDefault();
    const index = [...element.querySelectorAll(".spotify-item")].indexOf(
      article,
    );
    if (rows()[index]) songMenu(rows()[index], event.clientX, event.clientY);
  };
  const dismiss = (event) => {
    if (!event.target.closest(".music-context"))
      element.querySelector(".music-context")?.remove();
  };
  element.addEventListener("contextmenu", context);
  element.addEventListener("pointerdown", dismiss);

  return {
    showMenu: songMenu,
    get searching() {
      return searching;
    },
    get term() {
      return term;
    },
    renderSearch,
    async handle(button, event) {
      const action = button.dataset.action;
      if (
        button.dataset.filter ||
        button.dataset.collection ||
        ["library", "open_playlist", "refresh_playlist"].includes(action)
      ) {
        searching = false;
      }
      if (action === "track_menu") {
        const row = rows()[Number(button.dataset.row)],
          rect = button.getBoundingClientRect();
        if (row) songMenu(row, rect.right, rect.bottom);
        return true;
      }
      if (action === "search_add" || action === "search_download") {
        busy = true;
        redraw();
        try {
          await invoke("import_search", {
            uri: button.dataset.uri,
            download: action === "search_download",
          });
        } finally {
          busy = false;
          redraw();
        }
        return true;
      }
      if (action === "catalog_focus" || action === "retry_search") {
        searching = true;
        searchInput.focus();
        await search();
        return true;
      }
      if (action === "queue_list" || action === "queue_details") {
        const details = action === "queue_details";
        $(".music-queue").classList.toggle("mode-details", details);
        $(".music-queue [data-action=queue_list]").setAttribute(
          "aria-selected",
          String(!details),
        );
        $(".music-queue [data-action=queue_details]").setAttribute(
          "aria-selected",
          String(details),
        );
        return true;
      }
      if (action === "sleep_timer") {
        sleepDialog();
        return true;
      }
      return false;
    },
    configure(d) {
      const c = layout.config;
      const group = (label, key, choices) =>
        `<fieldset class="music-preference-group"><legend>${label}</legend><div class="music-choice-row" role="group" aria-label="${label}">${choices.map(([value, name]) => `<button type="button" data-preference="${key}" data-value="${value}" aria-pressed="${c[key] === value}">${name}</button>`).join("")}</div></fieldset>`;
      const range = (label, key, min, max, unit) =>
        `<label class="music-setting-range">${label}<output data-output="${key}">${c[key]}${unit}</output><input type="range" data-preference-range="${key}" min="${min}" max="${max}" step="1" value="${c[key]}" aria-label="${label}"></label>`;
      const target = d.querySelector(".music-appearance-options");
      target.innerHTML =
        group("Tema", "theme", [
          ["light", "Claro"],
          ["dark", "Escuro"],
          ["system", "Sistema"],
        ]) +
        group("Cor de destaque", "accent", [
          ["rose", "Rosa"],
          ["blue", "Azul"],
          ["green", "Verde"],
          ["violet", "Violeta"],
        ]) +
        range("Tamanho do texto", "textSize", 12, 16, "px") +
        range("Tamanho das capas", "artworkSize", 120, 220, "px") +
        range("Cantos das capas", "coverRadius", 0, 24, "px") +
        range("Cantos dos painéis", "radius", 0, 24, "px") +
        `<label class="music-setting-switch"><span>Lista compacta<small>Mais músicas no mesmo espaço.</small></span><input data-preference-toggle="compact" type="checkbox" ${c.compact ? "checked" : ""}></label><label class="music-setting-switch"><span>Mostrar capas na lateral</span><input data-preference-toggle="showArtwork" type="checkbox" ${c.showArtwork !== false ? "checked" : ""}></label><label class="music-setting-switch"><span>Animações suaves<small>Respeita a preferência de movimento reduzido do sistema.</small></span><input data-preference-toggle="motion" type="checkbox" ${c.motion !== false ? "checked" : ""}></label><small>Arraste as divisórias para ajustar a biblioteca e a fila. Use as setas no teclado para ajustes finos.</small><button type="button" class="music-secondary" data-reset-appearance>Restaurar aparência</button>`;
      for (const button of target.querySelectorAll("[data-preference]"))
        button.onclick = () => {
          layout.update({ [button.dataset.preference]: button.dataset.value });
          for (const other of target.querySelectorAll(
            `[data-preference=${button.dataset.preference}]`,
          ))
            other.setAttribute("aria-pressed", String(other === button));
        };
      for (const input of target.querySelectorAll("[data-preference-range]")) {
        decorateSlider(input, (value) => value + "px");
        input.oninput = () => {
          const key = input.dataset.preferenceRange;
          layout.update({ [key]: Number(input.value) });
          target.querySelector(`[data-output=${key}]`).textContent =
            input.value + "px";
        };
      }
      for (const input of target.querySelectorAll("[data-preference-toggle]"))
        input.onchange = () =>
          layout.update({ [input.dataset.preferenceToggle]: input.checked });
      const paper = d.querySelector(".music-wallpaper-options");
      paper.innerHTML = `<fieldset class="music-preference-group"><legend>Escolha um fundo</legend><div class="music-wallpaper-grid">${[
        ["none", "Sem fundo"],
        ["mist", "Névoa"],
        ["sunset", "Pôr do sol"],
        ["ocean", "Oceano"],
        ["custom", "Sua imagem"],
      ]
        .map(
          ([value, name]) =>
            `<button type="button" data-wallpaper-choice="${value}" aria-pressed="${c.wallpaper === value}" ${value === "custom" && !layout.hasCustomWallpaper ? "disabled" : ""}><span class="music-wallpaper-preview" data-preview="${value}"></span>${name}</button>`,
        )
        .join(
          "",
        )}</div></fieldset><label class="music-upload-button music-secondary"><input type="file" accept="image/png,image/jpeg,image/webp" data-wallpaper-upload hidden>${icon("plus")} Escolher imagem…</label><small>PNG, JPEG ou WebP, até 12 MB. A imagem é reduzida antes de salvar.</small><p role="status" class="music-wallpaper-status"></p>${group(
        "Ajuste da imagem",
        "wallpaperFit",
        [
          ["cover", "Preencher"],
          ["contain", "Ajustar"],
        ],
      )}${range("Opacidade dos painéis", "panelOpacity", 85, 100, "%")}${layout.hasCustomWallpaper ? '<button type="button" class="music-secondary" data-remove-wallpaper>Remover imagem salva</button>' : ""}`;
      for (const button of paper.querySelectorAll("[data-wallpaper-choice]"))
        button.onclick = () => {
          layout.update({ wallpaper: button.dataset.wallpaperChoice });
          for (const other of paper.querySelectorAll("[data-wallpaper-choice]"))
            other.setAttribute("aria-pressed", String(other === button));
        };
      for (const button of paper.querySelectorAll("[data-preference]"))
        button.onclick = () => {
          layout.update({ [button.dataset.preference]: button.dataset.value });
          for (const other of paper.querySelectorAll(
            `[data-preference=${button.dataset.preference}]`,
          ))
            other.setAttribute("aria-pressed", String(other === button));
        };
      const opacity = paper.querySelector("[data-preference-range]");
      decorateSlider(opacity, (value) => value + "%");
      opacity.oninput = () => {
        layout.update({ panelOpacity: Number(opacity.value) });
        paper.querySelector("[data-output=panelOpacity]").textContent =
          opacity.value + "%";
      };
      paper.querySelector("[data-wallpaper-upload]").onchange = async (
        event,
      ) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const status = paper.querySelector("[role=status]");
        status.textContent = "Preparando imagem…";
        event.target.disabled = true;
        try {
          await layout.importWallpaper(file);
          this.configure(d);
        } catch (error) {
          status.textContent =
            error.message || "Não foi possível abrir essa imagem.";
          event.target.disabled = false;
          event.target.value = "";
        }
      };
      paper
        .querySelector("[data-remove-wallpaper]")
        ?.addEventListener("click", () => {
          layout.clearWallpaper();
          this.configure(d);
        });
      target.querySelector("[data-reset-appearance]").onclick = () => {
        layout.update({
          theme: "light",
          accent: "rose",
          textSize: 13,
          artworkSize: 160,
          coverRadius: 12,
          radius: 18,
          compact: false,
          motion: true,
          showArtwork: true,
          library: 260,
          queue: 300,
        });
        this.configure(d);
      };
    },
    tick() {
      if (sleepDeadline && Date.now() >= sleepDeadline) {
        sleepDeadline = 0;
        invoke("pause");
        notify("Temporizador concluído.");
      }
    },
    beforeAdvance() {
      if (!sleepAtEnd) return true;
      sleepAtEnd = false;
      notify("Temporizador concluído.");
      return false;
    },
    dispose() {
      clearTimeout(timer);
      element.removeEventListener("contextmenu", context);
      element.removeEventListener("pointerdown", dismiss);
      element.querySelector(".music-context")?.remove();
    },
  };
};
