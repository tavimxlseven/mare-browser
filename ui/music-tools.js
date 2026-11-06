window.attachMusicTools = function ({
  element,
  data,
  rows,
  invoke,
  icon,
  escape: esc,
  localFor,
  layout,
  queue,
  queueChanged,
  redraw,
  notify,
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
  function renderSearch() {
    const result = data().search || {};
    $(".music-heading").classList.remove("music-playlist-heading");
    $(".music-list-heading").hidden = true;
    $(".music-heading").innerHTML =
      "<div><small>Descobrir</small><h2>" +
      esc(
        term ? "Resultados para “" + term + "”" : "Encontre sua próxima música",
      ) +
      '</h2><p>Busque pelo nome da música ou do artista.</p></div><button class="music-add" data-action="add">' +
      icon("plus") +
      " Importar playlist</button>";
    let html =
      '<div class="music-search-tabs"><button data-action="library">Sua biblioteca</button><button data-action="catalog_focus" aria-pressed="true">Buscar músicas</button></div>';
    if (result.state === "loading")
      html +=
        '<div class="music-empty" role="status"><h3>Buscando músicas…</h3><p>Consultando o catálogo.</p></div>';
    else if (result.state === "error")
      html +=
        '<div class="music-empty" role="alert"><h3>Não foi possível pesquisar</h3><p>' +
        esc(result.error) +
        '</p><button class="music-green" data-action="retry_search">Tentar novamente</button></div>';
    else
      html +=
        '<div class="music-search-results">' +
        (result.items || [])
          .map((t) => {
            const local = localFor(t),
              ready = local?.available;
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
              '" aria-label="Adicionar ' +
              esc(t.title) +
              ' à biblioteca">' +
              icon("plus") +
              "</button></article>"
            );
          })
          .join("") +
        "</div>";
    html +=
      '<p class="music-search-source">Resultados públicos do YouTube. Confira a gravação e o canal antes de adicionar. As músicas baixadas ficam na sua biblioteca, sem conectar uma conta Spotify.</p>';
    $(".spotify-library").innerHTML = html;
  }
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
  function songMenu(row, x, y) {
    element.querySelector(".music-context")?.remove();
    const menu = document.createElement("div");
    menu.className = "music-context";
    menu.setAttribute("role", "menu");
    const item = (action, title, disabled = false) =>
      '<button role="menuitem" data-song-menu="' +
      action +
      '" ' +
      (disabled ? "disabled" : "") +
      ">" +
      esc(title) +
      "</button>";
    menu.innerHTML =
      item("play", "Reproduzir", !row.local?.available) +
      item("queue", "Adicionar à fila", !row.local?.available) +
      item(
        "favorite",
        row.favorite ? "Remover das curtidas" : "Adicionar às músicas curtidas",
        !row.uri,
      ) +
      item("collection", "Adicionar à playlist", !row.uri) +
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
      (row.local?.available ? "<hr>" + item("delete", "Excluir download") : "");
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
      if (action === "queue") {
        queue.add(row.local.id);
        queueChanged();
        notify("Música adicionada à fila.");
        return;
      }
      if (action === "play") {
        element.querySelectorAll("[data-action=play_local]").forEach((b) => {
          if (Number(b.dataset.id) === row.local.id) b.click();
        });
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
          !(await invoke("save_link", { url: row.uri, title: row.title }))
        )
          return;
        if (action === "favorite") {
          await invoke("favorite", { uri: row.uri });
          redraw();
          return;
        }
        const d = modal(
          "Adicionar à playlist",
          '<div class="music-destinations">' +
            data()
              .collections.map(
                (c) =>
                  '<button data-target-collection="' +
                  c.id +
                  '">' +
                  esc(c.name) +
                  "</button>",
              )
              .join("") +
            "</div><p>Crie uma playlist pelo botão + da biblioteca.</p>",
        );
        d.querySelectorAll("[data-target-collection]").forEach(
          (button) =>
            (button.onclick = async () => {
              if (
                await invoke("set_collection", {
                  uri: row.uri,
                  collection: Number(button.dataset.targetCollection),
                })
              ) {
                d.close();
                redraw();
              }
            }),
        );
        return;
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
      d.insertAdjacentHTML(
        "afterbegin",
        '<section class="music-layout-settings"><h4>Aparência</h4><label>Cantos dos painéis<input data-layout-radius type="range" min="0" max="24" value="' +
          layout.config.radius +
          '"></label><label class="music-checkbox"><input data-layout-compact type="checkbox" ' +
          (layout.config.compact ? "checked" : "") +
          "> Lista compacta</label><small>Arraste as divisórias para ajustar a biblioteca e a fila. Use as setas com a divisória selecionada; dê dois cliques para restaurar.</small></section>",
      );
      d.querySelector("[data-layout-radius]").oninput = (e) =>
        layout.update({ radius: Number(e.target.value) });
      d.querySelector("[data-layout-compact]").onchange = (e) =>
        layout.update({ compact: e.target.checked });
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
