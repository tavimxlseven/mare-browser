// The Rust worker owns metadata, downloads and local playback. No iframe/player site.
window.createSpotifyView = function ({ request, send, notify, icon, isOpen }) {
  const element = document.createElement("div");
  element.className = "spotify-app";
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const $ = (selector) => element.querySelector(selector);
  const glyph = {
    play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="5"/>',
    previous: '<path d="M5 5v14m14-14L8 12l11 7Z"/>',
    next: '<path d="M19 5v14M5 5l11 7-11 7Z"/>',
    queue: '<path d="M3 5h14M3 10h14M3 15h8m5-1 5 4-5 4Z"/>',
    volume:
      '<path d="m11 4-6 5H2v6h3l6 5Zm4 4c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
    shuffle:
      '<path d="M3 5h3l12 14h3m-4-4 4 4-4 3M3 19h3L18 5h3m-4-3 4 3-4 4"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 11V6h18M7 22l-4-4 4-4m14-1v5H3"/>',
    heart: '<path d="M12 21 3.5 12C-3 5 7-1 12 6c5-7 15-1 8.5 6Z"/>',
    library: '<path d="M4 3v18M9 3v18m5-18 6 18"/>',
  };
  const svg = (name) =>
    glyph[name]
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph[name]}</svg>`
      : icon(name);
  let data = { entries: [], collections: [], local_tracks: [], player: {} },
    filter = "all",
    query = "",
    signature = "",
    shuffle = false,
    repeat = false,
    polling = false,
    disposed = false,
    autoStarting = false,
    lastPlaying = null;
  element.innerHTML = `<aside class="music-library music-panel"><header><strong>${svg("library")} Sua biblioteca</strong><button data-action="collection" aria-label="Criar coleção">${svg("plus")}</button></header><div class="music-filters"><button data-filter="all">Tudo</button><button data-filter="playlists">Playlists</button><button data-filter="downloaded">Baixadas</button></div><div class="music-library-tools"><button data-action="search" aria-label="Pesquisar na biblioteca">${svg("search")}</button><span>Recentes ${svg("down")}</span></div><button class="music-liked" data-filter="favorites"><span>${svg("heart")}</span><div><strong>Músicas curtidas</strong><small>Curtidas locais</small></div></button><div class="music-collections"></div><div class="music-library-footer"><span>${icon("spotify")} Spotify para Maré</span><small>Biblioteca independente</small></div></aside>
  <section class="music-main music-panel"><header class="music-toolbar"><label>${svg("search")}<input class="spotify-search" type="search" placeholder="Pesquisar na sua biblioteca" aria-label="Pesquisar na biblioteca"></label><button class="music-account" data-action="account">Conectar conta</button><button data-action="settings" aria-label="Configurações de música">${svg("settings")}</button></header><div class="music-scroll"><div class="music-heading"><div><small class="music-section-label">Sua música</small><h2>Sua biblioteca</h2><p class="music-subtitle">Seus links e músicas baixadas, em um só lugar.</p></div><button class="music-add" data-action="add">${svg("plus")} Adicionar link</button></div><div class="music-list-heading"><span>#</span><span>Título</span><span>Origem</span><span></span></div><div class="spotify-library"></div></div><div class="music-download" hidden role="status"><span class="music-download-spinner"></span><div><strong></strong><small></small></div><button data-action="cancel_download" aria-label="Cancelar download">${svg("close")}</button></div></section>
  <aside class="music-queue music-panel"><header><strong>Fila</strong><button data-action="queue" aria-label="Fechar fila">${svg("close")}</button></header><h3>Tocando agora</h3><div class="music-now"><div class="music-now-art">${svg("music")}</div><strong>Nada tocando</strong><small>Escolha uma faixa baixada.</small></div><h3>A seguir</h3><div class="music-next"></div><p class="music-queue-note">A música continua ao trocar de aba. Feche a aba do app para encerrar a reprodução.</p></aside>
  <footer class="spotify-player"><div class="music-track"><div class="music-track-art">${svg("music")}</div><div><strong>Nenhuma faixa selecionada</strong><small>Escolha uma música baixada</small></div></div><div class="music-transport"><div><button data-action="shuffle" aria-label="Reprodução aleatória" aria-pressed="false">${svg("shuffle")}</button><button data-action="previous" aria-label="Faixa anterior">${svg("previous")}</button><button class="music-play" data-action="play" aria-label="Reproduzir">${svg("play")}</button><button data-action="next" aria-label="Próxima faixa">${svg("next")}</button><button data-action="repeat" aria-label="Repetir fila" aria-pressed="false">${svg("repeat")}</button></div><label class="music-timeline"><span class="music-position">0:00</span><input type="range" min="0" max="1" value="0" step="1000" class="music-seek" aria-label="Posição da música"><span class="music-duration">0:00</span></label></div><div class="music-volume"><button data-action="queue" aria-label="Mostrar fila">${svg("queue")}</button>${svg("volume")}<input type="range" min="0" max="100" value="80" class="music-volume-slider" aria-label="Volume"></div></footer>`;
  async function invoke(method, params = {}) {
    try {
      const result = await request(method, params);
      update(result);
      return result;
    } catch (error) {
      notify(error.message);
      return null;
    }
  }
  const time = (value) => {
    const seconds = Math.floor((value || 0) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  function reveal() {
    const list = $(".spotify-library");
    list.getAnimations().forEach((animation) => animation.cancel());
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      list.animate(
        [
          { opacity: 0.6, transform: "translateY(5px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 170, easing: "cubic-bezier(.2,.7,.25,1)" },
      );
  }
  function dialog(title, body) {
    const d = document.createElement("dialog");
    d.className = "music-dialog";
    d.innerHTML = `<header><h3>${esc(title)}</h3><button type="button" data-dismiss aria-label="Fechar">${svg("close")}</button></header>${body}`;
    element.append(d);
    d.querySelector("[data-dismiss]").onclick = () => d.close();
    d.onclose = () => d.remove();
    d.showModal();
    return d;
  }
  function addDialog() {
    const d = dialog(
      "Adicionar do Spotify",
      `<form class="spotify-import"><label>Link da faixa, álbum ou playlist<input name="url" required placeholder="https://open.spotify.com/…" spellcheck="false" autofocus></label><label>Nome para salvar sem conexão<input name="title" maxlength="160" placeholder="Opcional"></label><p>Importa o título e a capa públicos. Use o botão de download na biblioteca para baixar o áudio pelo Sunnify.</p><div><button type="button" data-save>Salvar sem conexão</button><button class="music-green">Importar link</button></div><small role="status"></small></form>`,
    );
    const form = d.querySelector("form");
    async function add(method) {
      form
        .querySelectorAll("button")
        .forEach((button) => (button.disabled = true));
      form.querySelector("[role=status]").textContent = "Adicionando…";
      const result = await invoke(method, {
        url: form.elements.url.value,
        title: form.elements.title.value || "Link salvo",
      });
      if (result) d.close();
      else
        form
          .querySelectorAll("button")
          .forEach((button) => (button.disabled = false));
    }
    form.onsubmit = (event) => {
      event.preventDefault();
      add("import_link");
    };
    d.querySelector("[data-save]").onclick = () => {
      if (form.reportValidity()) add("save_link");
    };
  }
  function collectionDialog() {
    const d = dialog(
      "Criar coleção",
      `<form class="spotify-new"><label>Nome da coleção<input name="name" required maxlength="60" autofocus></label><button class="music-green">Criar</button></form>`,
    );
    d.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      if (
        await invoke("create_collection", {
          name: event.target.elements.name.value,
        })
      )
        d.close();
    };
  }
  function moveDialog(uri) {
    const d = dialog(
      "Organizar link",
      `<div class="music-destinations"><button data-destination="">Sem coleção</button>${data.collections.map((c) => `<button data-destination="${c.id}">${svg("folder")} ${esc(c.name)}</button>`).join("")}</div>`,
    );
    d.querySelectorAll("[data-destination]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (
            await invoke("set_collection", {
              uri,
              collection: button.dataset.destination
                ? Number(button.dataset.destination)
                : null,
            })
          )
            d.close();
        }),
    );
  }
  function settingsDialog() {
    const p = data.presence || {};
    const d = dialog(
      "Configurações de música",
      `<section><h4>Downloads</h4><p>O Sunnify acompanha este app e é executado sem janela apenas durante o download. Ele busca áudio no YouTube usando metadados do Spotify. Não usa seu login do Spotify.</p><small>${data.sunnify_available ? "Componente interno disponível" : "Componente ausente neste pacote"}</small><button data-scan>${svg("reload")} Atualizar arquivos baixados</button></section><form class="music-presence"><h4>Discord Rich Presence</h4><p>Compartilhar a música local que você está ouvindo. Usa o Discord instalado; não solicita seu token.</p><label>Application ID do Maré no Discord<input name="client_id" inputmode="numeric" value="${esc(p.client_id || "")}" placeholder="ID público do aplicativo"></label><label class="music-checkbox"><input type="checkbox" name="enabled" ${p.enabled ? "checked" : ""}> Mostrar música no meu perfil</label><small>Estado: ${esc(p.state || "disabled")}. Sem um ID registrado, a integração permanece desativada.</small><button class="music-green">Salvar presença</button></form>`,
    );
    d.querySelector("[data-scan]").onclick = () => invoke("scan_local");
    d.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      if (
        await invoke("presence_config", {
          client_id: event.target.elements.client_id.value,
          enabled: event.target.elements.enabled.checked,
        })
      )
        d.close();
    };
  }
  async function accountDialog() {
    if (!data.account?.configured) {
      const d = dialog(
        "Conectar ao Spotify",
        `<p>O login é opcional e usa a autorização oficial do Spotify para importar suas playlists e músicas curtidas.</p><p>Esta build ainda precisa de um Client ID registrado pelo mantenedor do Maré. Seus links, downloads e arquivos locais funcionam sem conta.</p><button class="music-green" data-ok>Entendi</button>`,
      );
      d.querySelector("[data-ok]").onclick = () => d.close();
      return;
    }
    if (data.account.state === "awaiting_authorization") {
      const waiting = dialog(
        "Autorizar no Spotify",
        '<p>Conclua a autorização na aba privada do Spotify ou cancele esta tentativa.</p><button class="music-green" data-reopen>Abrir login</button><button data-cancel-account>Cancelar</button>',
      );
      waiting.querySelector("[data-reopen]").onclick = () =>
        send({
          cmd: "new_tab",
          url: data.account.authorization_url,
          private: true,
        });
      waiting.querySelector("[data-cancel-account]").onclick = async () => {
        if (await invoke("account_disconnect")) waiting.close();
      };
      return;
    }
    const d = dialog(
      "Sua conta Spotify",
      `<p>${data.account_connected ? "Importe novamente sua biblioteca ou desconecte esta sessão." : "Autorize o acesso somente de leitura às suas playlists e músicas curtidas. A senha é digitada apenas no site do Spotify."}</p><button class="music-green" data-connect>${data.account_connected ? "Importar biblioteca" : "Entrar no Spotify"}</button>${data.account_connected ? "<button data-disconnect>Desconectar</button>" : ""}`,
    );
    if (data.account.error)
      d.querySelector("[data-connect]").insertAdjacentHTML(
        "beforebegin",
        `<p role="alert">${esc(data.account.error)}</p>`,
      );
    if (data.account.truncated)
      d.querySelector("[data-connect]").insertAdjacentHTML(
        "beforebegin",
        '<p role="status">Foram importados até 500 itens por categoria. Sua conta contém mais itens.</p>',
      );
    d.querySelector("[data-connect]").onclick = async () => {
      const result = await invoke(
        data.account_connected ? "account_import" : "account_begin",
      );
      if (result?.account?.authorization_url)
        send({
          cmd: "new_tab",
          url: result.account.authorization_url,
          private: true,
        });
      if (result) d.close();
    };
    d.querySelector("[data-disconnect]")?.addEventListener(
      "click",
      async () => {
        if (await invoke("account_disconnect")) d.close();
      },
    );
  }
  function libraryItems() {
    const used = new Set(),
      tracks = data.local_tracks || [];
    const items = data.entries.map((entry) => {
      let local = tracks.find((t) => t.available && t.source_uri === entry.uri);
      if (
        !local &&
        entry.kind === "track" &&
        data.entries.filter(
          (e) =>
            e.title.trim().toLocaleLowerCase() ===
            entry.title.trim().toLocaleLowerCase(),
        ).length === 1
      )
        local = tracks.find(
          (t) =>
            t.available &&
            !t.source_uri &&
            t.title.trim().toLocaleLowerCase() ===
              entry.title.trim().toLocaleLowerCase(),
        );
      if (local && entry.kind === "track") used.add(local.id);
      return {
        ...entry,
        local,
        confirmed:
          (data.completed_sources || []).includes(entry.uri) ||
          (entry.kind === "track" && !!local),
      };
    });
    for (const track of tracks.filter((t) => !used.has(t.id)))
      items.push({
        title: track.title,
        kind: "local",
        local: track,
        confirmed: track.available,
        thumbnail: "",
        favorite: false,
      });
    return items;
  }
  function renderLibrary() {
    const busy = downloadRequestPending || data.download?.state === "running";
    const next = JSON.stringify([
      data.entries,
      data.collections,
      data.local_tracks,
      data.completed_sources,
      data.download?.state,
      filter,
      query,
      busy,
    ]);
    if (next === signature) return;
    signature = next;
    const collection = data.collections.find(
      (c) => String(c.id) === String(filter),
    );
    $("h2").textContent =
      collection?.name ||
      {
        all: "Sua biblioteca",
        playlists: "Suas playlists",
        favorites: "Músicas curtidas",
        downloaded: "Músicas baixadas",
      }[filter] ||
      "Sua biblioteca";
    $(".music-section-label").textContent = collection
      ? "Coleção"
      : "Sua música";
    $(".music-subtitle").textContent =
      filter === "downloaded"
        ? "Downloads confirmados, prontos para ouvir."
        : "Baixe uma vez e reproduza aqui, na sua biblioteca.";
    element
      .querySelectorAll("[data-filter]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.filter === filter),
        ),
      );
    $(".music-collections").innerHTML = data.collections
      .map(
        (c) =>
          `<button data-collection="${c.id}" aria-pressed="${String(c.id) === String(filter)}"><span>${svg("folder")}</span><div><strong>${esc(c.name)}</strong><small>Coleção</small></div></button>`,
      )
      .join("");
    const items = libraryItems().filter(
      (e) =>
        (filter === "all" ||
          (filter === "playlists"
            ? e.kind === "playlist"
            : filter === "favorites"
              ? e.favorite
              : filter === "downloaded"
                ? e.local?.available
                : String(e.collection) === String(filter))) &&
        (e.title + " " + (e.local?.artists || ""))
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    );
    $(".spotify-library").innerHTML = items
      .map((e, index) => {
        const ready = !!e.local?.available,
          downloadable =
            !!e.uri && ["track", "playlist", "album"].includes(e.kind),
          downloading =
            data.download?.state === "running" &&
            data.download?.url?.endsWith(e.uri?.split(":").slice(1).join("/"));
        const primary = ready
          ? `data-action="play_local" data-id="${e.local.id}"`
          : downloadable
            ? `data-action="prepare" data-uri="${esc(e.uri)}" ${busy ? "disabled" : ""}`
            : "disabled";
        return `<article class="music-row spotify-item ${ready ? "is-downloaded" : ""}" ${ready ? `data-local="${e.local.id}"` : ""}><button class="music-row-play" ${primary} aria-label="${ready ? "Reproduzir" : downloadable ? "Baixar e reproduzir" : "Reprodução indisponível"} ${esc(e.title)}">${svg("play")}</button><div class="music-row-title"><span class="spotify-art">${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : svg("music")}</span><div class="spotify-item-info"><strong>${esc(e.title)}</strong><small>${esc(e.local?.artists || { track: "Música", playlist: "Playlist", album: "Álbum", artist: "Artista", show: "Podcast", episode: "Episódio", local: "Música baixada" }[e.kind] || e.kind)}</small></div></div><small class="music-availability">${downloading ? "Baixando…" : e.confirmed ? "Baixada" : ready ? "Disponível" : "Spotify"}</small><div class="music-row-actions">${e.uri ? `<button data-action="favorite" data-uri="${esc(e.uri)}" aria-label="Curtir ${esc(e.title)}" aria-pressed="${e.favorite}">${svg("heart")}</button>` : ""}${downloadable ? `<button data-action="download" data-uri="${esc(e.uri)}" title="${e.confirmed ? "Download confirmado" : "Baixar"}" aria-label="${e.confirmed ? "Download confirmado" : "Baixar"} ${esc(e.title)}" ${e.confirmed || busy ? "disabled" : ""}>${svg(e.confirmed ? "check" : "download")}</button>` : ""}${e.uri ? `<button data-action="move" data-uri="${esc(e.uri)}" aria-label="Organizar em coleção">${svg("folder")}</button><button data-action="remove" data-uri="${esc(e.uri)}" aria-label="Remover link da biblioteca">${svg("close")}</button>` : ""}</div></article>`;
      })
      .join("");
    if (!items.length)
      $(".spotify-library").innerHTML =
        `<div class="music-empty"><span>${svg("music")}</span><h3>${query ? "Nenhum resultado" : "Sua biblioteca começa aqui"}</h3><p>Adicione uma música ou playlist. Depois do download confirmado, o play fica disponível na própria biblioteca.</p><button class="music-green" data-action="add">Adicionar link</button></div>`;
  }
  let downloadRequestPending = false,
    visualFrame = 0,
    observedAt = 0,
    observedPosition = 0;
  function smoothProgress(now) {
    visualFrame = 0;
    if (
      disposed ||
      data.player?.state !== "playing" ||
      !element.getClientRects().length
    )
      return;
    const position = Math.min(
        data.player.duration_ms || 0,
        observedPosition + now - observedAt,
      ),
      seek = $(".music-seek");
    if (document.activeElement !== seek) seek.value = String(position);
    const label = time(position);
    if ($(".music-position").textContent !== label)
      $(".music-position").textContent = label;
    visualFrame = requestAnimationFrame(smoothProgress);
  }

  function renderPlayer() {
    observedAt = performance.now();
    observedPosition = data.player?.position_ms || 0;
    if (
      data.player?.state === "playing" &&
      !visualFrame &&
      element.getClientRects().length &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      visualFrame = requestAnimationFrame(smoothProgress);
    if (data.player?.state !== "playing" && visualFrame) {
      cancelAnimationFrame(visualFrame);
      visualFrame = 0;
    }
    const player = data.player || {},
      track = data.local_tracks.find((t) => t.id === player.track_id),
      playing = player.state === "playing";
    $(".music-track strong").textContent =
      track?.title || "Nenhuma faixa selecionada";
    $(".music-track small").textContent =
      track?.artists ||
      (track ? "Arquivo local" : "Escolha uma música baixada");
    $(".music-now strong").textContent = track?.title || "Nada tocando";
    $(".music-now small").textContent =
      track?.artists ||
      (track ? "Arquivo local" : "Escolha uma faixa baixada.");
    const entry = data.entries.find(
      (e) =>
        e.uri === track?.source_uri ||
        (!track?.source_uri &&
          e.title.toLocaleLowerCase() === track?.title?.toLocaleLowerCase()),
    );
    for (const selector of [".music-track-art", ".music-now-art"]) {
      const art = $(selector),
        url = entry?.thumbnail || "";
      if (art.dataset.cover !== url) {
        art.dataset.cover = url;
        art.innerHTML = url
          ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">`
          : svg("music");
      }
    }
    $(".music-play").innerHTML = svg(playing ? "pause" : "play");
    $(".music-play").setAttribute(
      "aria-label",
      playing ? "Pausar" : "Reproduzir",
    );
    $(".music-play").disabled = !data.local_tracks.some((t) => t.available);
    for (const action of ["previous", "next"])
      $(`[data-action=${action}]`).disabled = !data.local_tracks.some(
        (t) => t.available,
      );
    $(".music-position").textContent = time(player.position_ms);
    $(".music-duration").textContent = time(player.duration_ms);
    const seek = $(".music-seek");
    seek.disabled = !track;
    seek.max = String(Math.max(1, player.duration_ms || 1));
    if (document.activeElement !== seek) seek.value = player.position_ms || 0;
    if (document.activeElement !== $(".music-volume-slider"))
      $(".music-volume-slider").value = player.volume ?? 80;
    const queueSignature = JSON.stringify([data.local_tracks, player.track_id]);
    if ($(".music-next").dataset.signature !== queueSignature) {
      $(".music-next").dataset.signature = queueSignature;
      const index = data.local_tracks.findIndex(
        (t) => t.id === player.track_id,
      );
      $(".music-next").innerHTML =
        data.local_tracks
          .slice(index + 1, index + 9)
          .map(
            (t) =>
              `<button data-action="play_local" data-id="${t.id}"><span>${svg("music")}</span><div><strong>${esc(t.title)}</strong><small>${esc(t.artists || "Arquivo local")}</small></div></button>`,
          )
          .join("") || "<small>A fila está vazia.</small>";
    }
    if (playing) lastPlaying = player.track_id;
    if (
      lastPlaying === player.track_id &&
      player.state === "stopped" &&
      player.duration_ms > 0 &&
      player.position_ms >= player.duration_ms - 600 &&
      !autoStarting
    ) {
      lastPlaying = null;
      step(1, true);
    }
  }
  function renderDownload() {
    const d = data.download || {},
      active = d.state === "running";
    $(".music-download").hidden =
      !active && !["failed", "completed", "cancelled"].includes(d.state);
    $(".music-download-spinner").hidden = !active;
    $(".music-download [data-action]").hidden = !active;
    $(".music-download strong").textContent = active
      ? "Baixando em segundo plano…"
      : {
          failed: "O download não foi concluído",
          completed: "Download concluído",
          cancelled: "Download cancelado",
        }[d.state] || "";
    $(".music-download small").textContent =
      d.error ||
      d.event?.message ||
      (active
        ? "Você pode continuar usando suas abas."
        : d.state === "completed"
          ? "Pronta para ouvir na sua biblioteca."
          : "Seus arquivos concluídos foram preservados.");
    $(".music-account").textContent = data.account_connected
      ? "Sua conta"
      : "Conectar conta";
  }
  async function step(direction, automatic = false) {
    const tracks = data.local_tracks.filter((t) => t.available);
    if (!tracks.length) return;
    let index = tracks.findIndex((t) => t.id === data.player?.track_id);
    index = shuffle
      ? Math.floor(Math.random() * tracks.length)
      : index + direction;
    if (index >= tracks.length) {
      if (!repeat && automatic) return;
      index = 0;
    }
    if (index < 0) index = tracks.length - 1;
    autoStarting = true;
    try {
      await invoke("play_local", { id: tracks[index].id });
    } finally {
      autoStarting = false;
    }
  }
  element.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.filter) {
      filter = button.dataset.filter;
      renderLibrary();
      reveal();
      return;
    }
    if (button.dataset.collection) {
      filter = button.dataset.collection;
      renderLibrary();
      reveal();
      return;
    }
    const action = button.dataset.action,
      uri = button.dataset.uri;
    if (action === "add") return addDialog();
    if (action === "collection") return collectionDialog();
    if (action === "move") return moveDialog(uri);
    if (action === "settings") return settingsDialog();
    if (action === "account") return accountDialog();
    if (action === "search") return $(".spotify-search").focus();
    if (action === "queue") {
      element.classList.toggle("queue-hidden");
      return;
    }
    if (action === "shuffle" || action === "repeat") {
      if (action === "shuffle") shuffle = !shuffle;
      else repeat = !repeat;
      button.setAttribute(
        "aria-pressed",
        String(action === "shuffle" ? shuffle : repeat),
      );
      return;
    }
    if (action === "next" || action === "previous")
      return step(action === "next" ? 1 : -1);
    if (action === "play") {
      if (data.player?.state === "playing") return invoke("pause");
      if (data.player?.state === "paused") return invoke("resume");
      if (
        data.player?.track_id != null &&
        data.player.position_ms > 0 &&
        data.player.position_ms < data.player.duration_ms
      )
        return invoke("resume");
      const track =
        data.local_tracks.find(
          (t) => t.id === data.player?.track_id && t.available,
        ) || data.local_tracks.find((t) => t.available);
      if (track) return invoke("play_local", { id: track.id });
      return;
    }
    if (action === "play_local")
      return invoke("play_local", { id: Number(button.dataset.id) });
    if (action === "open") {
      send({ cmd: "spotify_open", url: uri });
      return;
    }
    if (action === "download" || action === "prepare") {
      if (downloadRequestPending || data.download?.state === "running") {
        notify("Aguarde o download atual ou cancele-o.");
        return;
      }
      downloadRequestPending = true;
      renderLibrary();
      try {
        await invoke("download", {
          url: uri,
          play_after: action === "prepare",
        });
      } finally {
        downloadRequestPending = false;
        renderLibrary();
      }
      return;
    }
    if (action === "favorite" || action === "remove")
      return invoke(action, { uri });
    if (action === "cancel_download") return invoke(action);
  });
  $(".spotify-search").oninput = (event) => {
    query = event.target.value;
    renderLibrary();
  };
  $(".music-seek").onchange = (event) =>
    invoke("seek", { position_ms: Number(event.target.value) });
  $(".music-volume-slider").onchange = (event) =>
    invoke("volume", { value: Number(event.target.value) });
  function update(result) {
    if (
      disposed ||
      !result ||
      (!Array.isArray(result.entries) && !result.player)
    )
      return;
    const libraryChanged =
      Array.isArray(result.entries) ||
      Array.isArray(result.local_tracks) ||
      result.download?.state !== data.download?.state;
    data = { ...data, ...result };
    data.local_tracks ||= [];
    if (libraryChanged) renderLibrary();
    renderPlayer();
    renderDownload();
  }
  const timer = setInterval(async () => {
    if (disposed || !isOpen()) {
      clearInterval(timer);
      return;
    }
    if (polling) return;
    polling = true;
    try {
      update(
        await request("playback_status", { revision: data.library_revision }),
      );
    } catch {
    } finally {
      polling = false;
    }
  }, 1000);
  renderLibrary();
  renderPlayer();
  renderDownload();
  return {
    element,
    update,
    load: () => invoke("list"),
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(visualFrame);
      clearInterval(timer);
      element.querySelectorAll("dialog").forEach((d) => {
        d.close();
        d.remove();
      });
    },
  };
};
