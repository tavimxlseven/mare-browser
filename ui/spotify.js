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

    polling = false,
    disposed = false,
    autoStarting = false,
    lastPlaying = null;
  element.innerHTML = `<aside class="music-library music-panel"><header><strong>${svg("library")} Sua biblioteca</strong><button data-action="collection" aria-label="Criar coleção">${svg("plus")}</button></header><div class="music-filters"><button data-filter="all">Tudo</button><button data-filter="playlists">Playlists</button><button data-filter="downloaded">Baixadas</button></div><div class="music-library-tools"><button data-action="search" aria-label="Pesquisar na biblioteca">${svg("search")}</button><span>Recentes ${svg("down")}</span></div><button class="music-liked" data-filter="favorites"><span>${svg("heart")}</span><div><strong>Músicas curtidas</strong><small>Curtidas locais</small></div></button><div class="music-collections"></div><div class="music-library-footer"><span>${icon("spotify")} Spotify para Maré</span><small>Biblioteca independente</small></div></aside>
  <section class="music-main music-panel"><header class="music-toolbar"><label>${svg("search")}<input class="spotify-search" type="search" placeholder="Pesquisar na sua biblioteca" aria-label="Pesquisar na biblioteca"></label><button class="music-account" data-action="account" hidden>Conectar conta</button><button data-action="settings" aria-label="Configurações de música">${svg("settings")}</button></header><div class="music-scroll"><div class="music-heading"><div><small class="music-section-label">Sua música</small><h2>Sua biblioteca</h2><p class="music-subtitle">Seus links e músicas baixadas, em um só lugar.</p></div><button class="music-add" data-action="add">${svg("plus")} Adicionar link</button></div><div class="music-list-heading"><span>#</span><span>Título</span><span>Origem</span><span></span></div><div class="spotify-library"></div></div><div class="music-download" hidden role="status"><span class="music-download-spinner"></span><div><strong></strong><small></small></div><button data-action="cancel_download" aria-label="Cancelar download">${svg("close")}</button></div></section>
  <aside class="music-queue music-panel"><header><strong>Fila</strong><button data-action="queue" aria-label="Fechar fila">${svg("close")}</button></header><h3>Tocando agora</h3><div class="music-now"><div class="music-now-art">${svg("music")}</div><strong>Nada tocando</strong><small>Escolha uma faixa baixada.</small></div><h3>A seguir</h3><div class="music-next"></div><p class="music-queue-note">A música continua ao trocar de aba. Feche a aba do app para encerrar a reprodução.</p></aside>
  <footer class="spotify-player"><div class="music-track"><div class="music-track-art">${svg("music")}</div><div><strong>Nenhuma faixa selecionada</strong><small>Escolha uma música baixada</small></div></div><div class="music-transport"><div><button data-action="shuffle" aria-label="Reprodução aleatória" aria-pressed="false">${svg("shuffle")}</button><button data-action="previous" aria-label="Faixa anterior">${svg("previous")}</button><button class="music-play" data-action="play" aria-label="Reproduzir">${svg("play")}</button><button data-action="next" aria-label="Próxima faixa">${svg("next")}</button><button data-action="repeat" aria-label="Repetir fila" aria-pressed="false">${svg("repeat")}</button></div><label class="music-timeline"><span class="music-position">0:00</span><input type="range" min="0" max="1" value="0" step="1000" class="music-seek" aria-label="Posição da música"><span class="music-duration">0:00</span></label></div><div class="music-volume"><button data-action="queue" aria-label="Mostrar fila">${svg("queue")}</button>${svg("volume")}<input type="range" min="0" max="100" value="80" class="music-volume-slider" aria-label="Volume"></div></footer>`;
  const playback = new window.MareMusicQueue();
  const musicLayout = window.attachMusicLayout(element);
  async function invoke(method, params = {}) {
    try {
      const result = await request(method, params);
      update(result);
      return result;
    } catch (error) {
      if (!disposed && isOpen()) notify(error.message);
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
        { duration: 230, easing: "cubic-bezier(.16,1,.3,1)" },
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
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      d.animate(
        [
          { opacity: 0, transform: "translateY(10px) scale(.98)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 210, easing: "cubic-bezier(.16,1,.3,1)" },
      );
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
      `<section><h4>Downloads</h4><p>O Sunnify acompanha este app e é executado sem janela apenas durante o download. Ele busca áudio no YouTube usando metadados do Spotify. Não usa seu login do Spotify.</p><small>${data.sunnify_available ? "Componente interno disponível" : "Componente ausente neste pacote"}</small><button data-scan>${svg("reload")} Atualizar arquivos baixados</button></section><form class="music-presence"><h4>Discord Rich Presence</h4><p>Compartilhe a música que você está ouvindo pelo Discord instalado. A integração do Maré já está configurada para todos os usuários e não precisa de bot ou token.</p><label class="music-checkbox"><input type="checkbox" name="enabled" ${p.enabled ? "checked" : ""}> Mostrar música no meu perfil</label><small>Estado: ${esc({ disabled: "Desativada", discord_closed: "Abra o Discord no computador", connecting: "Conectando…", ready: "Pronta para compartilhar", active: "Música compartilhada", rejected: "O Discord recusou a atividade" }[p.state] || "Aguardando o Discord")}.</small><button class="music-green">Salvar presença</button></form>`,
    );
    d.querySelector("[data-scan]").onclick = () => invoke("scan_local");
    d.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      if (
        await invoke("presence_config", {
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
        `<p>O login é opcional e usa a autorização oficial do Spotify para importar suas playlists e músicas curtidas.</p><p>Esta build ainda precisa de um Client ID registrado pelo mantenedor do Maré. Você não precisa cadastrar um aplicativo pessoal. Enquanto isso, adicione playlists por link e ouça as músicas baixadas sem conectar sua conta.</p><button class="music-green" data-ok>Entendi</button>`,
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
  const normalized = (value) =>
    String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  let selectedPlaylist = null,
    currentRows = [],
    queueIds = [];
  const queueMeta = new Map();
  let coverObserver = null,
    coverTimer = 0;
  const requestedCovers = new Set(),
    coverBatch = new Set();
  function watchCovers() {
    coverObserver?.disconnect();
    coverObserver = new IntersectionObserver(
      (items) => {
        for (const item of items) {
          const uri = item.target.dataset.artworkUri;
          if (
            item.isIntersecting &&
            uri &&
            !data.artwork?.[uri] &&
            !requestedCovers.has(uri)
          ) {
            requestedCovers.add(uri);
            coverBatch.add(uri);
          }
        }
        if (coverBatch.size && !coverTimer)
          coverTimer = setTimeout(() => {
            coverTimer = 0;
            const uris = [...coverBatch].slice(0, 24);
            for (const uri of uris) coverBatch.delete(uri);
            invoke("artwork", { uris }).then((result) => {
              if (result?.artwork_requests)
                for (const uri of uris)
                  if (!result.artwork_requests.includes(uri))
                    requestedCovers.delete(uri);
            });
          }, 60);
      },
      { root: $(".music-scroll"), rootMargin: "120px" },
    );
    element
      .querySelectorAll("[data-artwork-uri]")
      .forEach((row) => coverObserver.observe(row));
  }
  function localFor(entry, scope) {
    const tracks = (data.local_tracks || []).filter((t) => t.available);
    const exact = tracks.find(
      (t) => t.track_uri === entry.uri || t.source_uri === entry.uri,
    );
    if (exact) return exact;
    const matches = tracks.filter(
      (t) =>
        (!t.source_uri || t.source_uri === scope) &&
        normalized(t.title) === normalized(entry.title) &&
        (!entry.artists ||
          !t.artists ||
          normalized(t.artists) === normalized(entry.artists)),
    );
    return matches.length === 1 ? matches[0] : null;
  }
  function rowsForView() {
    if (selectedPlaylist) {
      const p = data.playlist;
      const source = p?.uri === selectedPlaylist ? p.tracks || [] : [];
      return source.map((e) => {
        const local = localFor(e, selectedPlaylist);
        return {
          ...e,
          kind: "track",
          local,
          thumbnail: data.artwork?.[e.uri] || "",
        };
      });
    }
    const used = new Set();
    const rows = data.entries
      .filter((e) => e.kind === "track")
      .map((e) => {
        const local = localFor(e);
        if (local) used.add(local.id);
        return { ...e, local };
      });
    for (const t of data.local_tracks || []) {
      if (
        !used.has(t.id) &&
        !/^spotify:(playlist|album):/.test(t.source_uri || "")
      )
        rows.push({
          title: t.title,
          artists: t.artists,
          kind: "local",
          local: t,
          thumbnail: t.artwork || "",
          uri: t.track_uri || null,
        });
    }
    return rows;
  }
  function renderLibrary() {
    const busy = downloadRequestPending || data.download?.state === "running";
    const next = JSON.stringify([
      data.artwork,
      data.entries,
      data.collections,
      data.local_tracks,
      data.completed_sources,
      data.playlist,
      data.download?.state,
      selectedPlaylist,
      filter,
      query,
      busy,
    ]);
    if (next === signature) return;
    signature = next;
    coverObserver?.disconnect();
    const playlists = data.entries.filter((e) =>
      ["playlist", "album"].includes(e.kind),
    );
    $(".music-collections").innerHTML =
      `<button data-filter="downloaded" aria-pressed="${filter === "downloaded"}"><span>${svg("download")}</span><div><strong>Músicas baixadas</strong><small>Músicas avulsas</small></div></button>` +
      playlists
        .map(
          (e) =>
            `<button data-action="open_playlist" data-uri="${esc(e.uri)}" aria-pressed="${selectedPlaylist === e.uri}"><span class="music-sidebar-art">${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy">` : svg("music")}</span><div><strong>${esc(e.title)}</strong><small>${e.kind === "album" ? "Álbum" : "Playlist"}</small></div></button>`,
        )
        .join("") +
      data.collections
        .map(
          (c) =>
            `<button data-collection="${c.id}"><span>${svg("folder")}</span><div><strong>${esc(c.name)}</strong><small>Coleção</small></div></button>`,
        )
        .join("");
    element
      .querySelectorAll("[data-filter]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.filter === filter && !selectedPlaylist),
        ),
      );
    const entry = data.entries.find((e) => e.uri === selectedPlaylist),
      p = data.playlist?.uri === selectedPlaylist ? data.playlist : null;
    const home =
      !selectedPlaylist && ["all", "playlists"].includes(filter) && !query;
    $(".music-list-heading").hidden = home;
    $(".music-heading").classList.toggle(
      "music-playlist-heading",
      !!selectedPlaylist,
    );
    $(".music-heading").innerHTML = selectedPlaylist
      ? `<button class="music-cover-back" data-action="library" aria-label="Voltar à biblioteca">${svg("back")}</button><div class="music-playlist-cover">${entry?.thumbnail ? `<img src="${esc(entry.thumbnail)}" alt="">` : svg("music")}</div><div><small>Playlist</small><h2>${esc(entry?.title || p?.name || "Playlist")}</h2><p>${esc(p?.owner || "Sua biblioteca")} ${p?.state === "ready" ? `· ${p.tracks.length} músicas` : ""}</p><div class="music-playlist-controls"><button class="music-green" data-action="download" data-uri="${esc(selectedPlaylist)}" ${busy || p?.state !== "ready" || data.completed_sources?.includes(selectedPlaylist) ? "disabled" : ""}>${svg("download")}${data.completed_sources?.includes(selectedPlaylist) ? "Baixada" : "Baixar playlist"}</button><button data-action="refresh_playlist" aria-label="Atualizar playlist">${svg("reload")}</button></div></div>`
      : `<div><small>Sua música</small><h2>${filter === "favorites" ? "Músicas curtidas" : filter === "downloaded" ? "Músicas baixadas" : data.collections.find((c) => String(c.id) === String(filter))?.name || "Sua biblioteca"}</h2><p>${filter === "downloaded" ? "Suas músicas avulsas, prontas para baixar e ouvir." : "Suas playlists e músicas, em um só lugar."}</p></div><button class="music-add" data-action="add">${svg("plus")} Adicionar link</button>`;
    if (home) {
      $(".spotify-library").innerHTML =
        `<div class="music-album-grid"><button class="music-album-card" data-filter="downloaded"><span class="music-downloads-cover">${svg("download")}</span><strong>Músicas baixadas</strong><small>Suas músicas avulsas</small></button>${playlists.map((e) => `<button class="music-album-card" data-action="open_playlist" data-uri="${esc(e.uri)}"><span>${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy">` : svg("music")}</span><strong>${esc(e.title)}</strong><small>${e.kind === "album" ? "Álbum" : "Playlist"}</small></button>`).join("")}</div>`;
      currentRows = [];
      return;
    }
    if (selectedPlaylist && p?.state !== "ready") {
      $(".spotify-library").innerHTML =
        `<div class="music-empty" role="status"><span>${svg(p?.state === "error" ? "close" : "music")}</span><h3>${p?.state === "error" ? "Não foi possível abrir a playlist" : "Carregando músicas…"}</h3><p>${esc(p?.error || "Buscando as faixas da playlist.")}</p>${p?.state === "error" ? '<button class="music-green" data-action="refresh_playlist">Tentar novamente</button>' : ""}</div>`;
      currentRows = [];
      return;
    }
    currentRows = rowsForView().filter(
      (e) =>
        (selectedPlaylist ||
          filter === "downloaded" ||
          filter === "all" ||
          (filter === "favorites"
            ? e.favorite
            : String(e.collection) === String(filter))) &&
        normalized(
          e.title + " " + (e.artists || e.local?.artists || ""),
        ).includes(normalized(query)),
    );
    $(".spotify-library").innerHTML =
      currentRows
        .map((e, i) => {
          const ready = !!e.local?.available;
          return `<article class="music-row spotify-item ${ready ? "is-downloaded" : ""}" data-artwork-uri="${esc(e.uri || "")}"><button class="music-row-play" data-action="play_local" data-id="${e.local?.id || 0}" data-uri="${esc(e.uri || "")}" data-art="${esc(e.thumbnail || (!selectedPlaylist ? e.local?.artwork : "") || "")}" ${ready ? "" : "disabled"} aria-label="${ready ? "Reproduzir" : "Baixe para reproduzir"} ${esc(e.title)}">${ready ? svg("play") : `<span>${i + 1}</span>`}</button><div class="music-row-title"><span class="spotify-art">${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy" decoding="async">` : svg("music")}</span><div class="spotify-item-info"><strong>${esc(e.title)}</strong><small>${esc(e.artists || e.local?.artists || "Música")}</small></div></div><small class="music-availability">${ready ? "Baixada" : data.download?.url?.endsWith(e.uri?.split(":").slice(1).join("/")) && busy ? "Baixando…" : "Não baixada"}</small><div class="music-row-actions">${e.uri ? `<button data-action="download" data-uri="${esc(e.uri)}" ${ready || busy ? "disabled" : ""} aria-label="${ready ? "Download confirmado" : "Baixar"} ${esc(e.title)}">${svg(ready ? "check" : "download")}</button>` : ""}${ready ? `<button data-action="delete_local" data-id="${e.local.id}" aria-label="Excluir download de ${esc(e.title)}">${svg("trash")}</button>` : ""}${data.entries.some((x) => x.uri === e.uri) ? `<button data-action="favorite" data-uri="${esc(e.uri)}" aria-label="Curtir ${esc(e.title)}" aria-pressed="${!!e.favorite}">${svg("heart")}</button><button data-action="remove" data-uri="${esc(e.uri)}" aria-label="Remover link">${svg("close")}</button>` : ""}</div></article>`;
        })
        .join("") ||
      '<div class="music-empty"><h3>Nenhuma música aqui ainda</h3><p>Adicione uma música para baixar e ouvir.</p><button class="music-green" data-action="add">Adicionar link</button></div>';
    watchCovers();
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
        (e.kind === "track" && e.uri === track?.source_uri) ||
        (!track?.source_uri &&
          e.title.toLocaleLowerCase() === track?.title?.toLocaleLowerCase()),
    );
    for (const selector of [".music-track-art", ".music-now-art"]) {
      const art = $(selector),
        url =
          data.artwork?.[track?.track_uri || track?.source_uri] ||
          (track?.source_uri?.startsWith("spotify:track:")
            ? track?.artwork
            : "") ||
          entry?.thumbnail ||
          "";
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
    const queueSignature = JSON.stringify([
      data.local_tracks,
      player.track_id,
      data.artwork,
      queueIds,
    ]);
    if ($(".music-next").dataset.signature !== queueSignature) {
      $(".music-next").dataset.signature = queueSignature;
      const upcoming = playback.upcoming();
      $(".music-next").innerHTML = upcoming.map((id, index) => {
        const t = data.local_tracks.find(t => t.id === id);
        if (!t?.available) return "";
        const at = playback.position + index + 1;
        const art = data.artwork?.[t.track_uri || queueMeta.get(t.id)?.uri || t.source_uri] || t.artwork || "";
        return '<article class="music-queue-row" draggable="true" data-queue-index="'+at+'"><button data-action="queue_play" data-index="'+at+'" aria-label="Reproduzir '+esc(t.title)+'"><span>'+ (art ? '<img src="'+esc(art)+'" alt="" loading="lazy">' : svg("music")) +'</span><div><strong>'+esc(t.title)+'</strong><small>'+esc(t.artists||"Música baixada")+'</small></div></button><div class="music-queue-actions"><button data-action="queue_up" data-index="'+at+'" aria-label="Subir na fila">'+svg("up")+'</button><button data-action="queue_remove" data-index="'+at+'" aria-label="Remover da fila">'+svg("close")+'</button></div></article>';
      }).join("") || '<small>A fila está vazia.</small>';
      $(".music-queue h3:last-of-type").textContent = 'A seguir · ' + upcoming.length;
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
  let downloadExpanded = false,
    downloadDismissed = "";
  function renderDownload() {
    const d = data.download || {},
      active = d.state === "running",
      key = (d.url || "") + d.state,
      panel = $(".music-download");
    panel.hidden =
      (!active && !["failed", "completed", "cancelled"].includes(d.state)) ||
      downloadDismissed === key;
    const entry = data.entries.find((e) => e.url === d.url),
      done = d.completed_tracks || 0,
      total = d.total_tracks || 0,
      finished = d.state === "completed";
    panel.classList.toggle("is-expanded", downloadExpanded);
    panel.classList.toggle("is-complete", finished);
    const title = active
      ? entry?.title || "Baixando música"
      : {
          completed: "Download concluído",
          failed: "Download interrompido",
          cancelled: "Download cancelado",
        }[d.state] || "";
    panel.innerHTML = `<button class="music-download-toggle" data-action="download_panel" aria-expanded="${downloadExpanded}"><span class="music-island-art">${entry?.thumbnail ? `<img src="${esc(entry.thumbnail)}" alt="">` : svg(finished ? "check" : "download")}</span><span><strong>${esc(title)}</strong><small>${active ? (total ? `${done} de ${total} músicas` : "Preparando os arquivos…") : finished ? "Pronta para ouvir" : esc(d.error || d.event?.message || "Você pode tentar novamente.")}</small><progress ${total || finished ? `value="${finished ? 1 : Math.min(1, done / total)}"` : ""} max="1" aria-label="Progresso das músicas concluídas"></progress></span>${svg(downloadExpanded ? "down" : "plus")}</button><button class="music-island-close" data-action="${active ? "cancel_download" : "dismiss_download"}" aria-label="${active ? "Cancelar download" : "Fechar progresso"}">${svg("close")}</button>${downloadExpanded ? `<div class="music-island-detail"><strong>${d.last_track?.title ? "Última faixa concluída" : "Download em andamento"}</strong><p>${esc(d.last_track?.title || "As faixas ficam disponíveis para ouvir assim que os arquivos são finalizados.")}</p><small>${active ? "Baixando em segundo plano. Você pode continuar navegando." : finished ? "As músicas estão disponíveis na biblioteca." : esc(d.error || "Os arquivos concluídos foram preservados.")}</small></div>` : ""}`;
    $(".music-account").textContent = data.account_connected
      ? "Sua conta"
      : "Conectar conta";
  }

  async function playQueued(id) {
    if (id == null) return;
    const meta=queueMeta.get(id);
    queueIds=[...playback.order];
    autoStarting=true;
    try { await invoke("play_local", {id,track_uri:meta?.uri,artwork:data.artwork?.[meta?.uri]||meta?.artwork||""}); }
    finally {autoStarting=false;renderPlayer();}
  }
  async function step(direction, automatic = false) {
    if (direction < 0 && data.player?.position_ms > 3000) return invoke("seek",{position_ms:0});
    if (!playback.order.length) playback.start(data.local_tracks.filter(t=>t.available).map(t=>t.id),data.player?.track_id || data.local_tracks.find(t=>t.available)?.id);
    return playQueued(direction > 0 ? playback.next(automatic) : playback.previous());
  }
  let draggingQueue=null;
  element.addEventListener("dragstart",event=>{const row=event.target.closest("[data-queue-index]");if(row){draggingQueue=Number(row.dataset.queueIndex);event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",String(draggingQueue));}});
  element.addEventListener("dragover",event=>{if(draggingQueue!==null&&event.target.closest("[data-queue-index]"))event.preventDefault();});
  element.addEventListener("drop",event=>{const row=event.target.closest("[data-queue-index]");if(row&&draggingQueue!==null){event.preventDefault();playback.move(draggingQueue,Number(row.dataset.queueIndex));queueIds=[...playback.order];renderPlayer();}draggingQueue=null;});
  element.addEventListener("dragend",()=>draggingQueue=null);
  element.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.filter) {
      selectedPlaylist = null;
      filter = button.dataset.filter;
      renderLibrary();
      reveal();
      return;
    }
    if (button.dataset.collection) {
      selectedPlaylist = null;
      filter = button.dataset.collection;
      renderLibrary();
      reveal();
      return;
    }
    const action = button.dataset.action,
      uri = button.dataset.uri;
    if (action === "library") {
      selectedPlaylist = null;
      filter = "all";
      renderLibrary();
      return;
    }
    if (action === "open_playlist" || action === "refresh_playlist") {
      const previousPlaylist = selectedPlaylist;
      const previousFilter = filter;
      selectedPlaylist = uri || selectedPlaylist;
      filter = "playlist";
      renderLibrary();
      const result = await invoke("open_playlist", {
        uri: selectedPlaylist,
        refresh: action === "refresh_playlist",
      });
      if (!result) {
        selectedPlaylist = previousPlaylist;
        filter = previousFilter;
      }
      renderLibrary();
      reveal();
      return;
    }
    if (action === "download_panel") {
      downloadExpanded = !downloadExpanded;
      renderDownload();
      return;
    }
    if (action === "dismiss_download") {
      downloadDismissed = (data.download?.url || "") + data.download?.state;
      renderDownload();
      return;
    }
    if (action === "add") return addDialog();
    if (action === "collection") return collectionDialog();
    if (action === "move") return moveDialog(uri);
    if (action === "settings") return settingsDialog();
    if (action === "account") return accountDialog();
    if (action === "search") return $(".spotify-search").focus();
    if (action === "queue") {
      musicLayout.toggleQueue();
      const queue = $(".music-queue");
      if (
        !element.classList.contains("queue-hidden") &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        queue.animate(
          [
            { opacity: 0, transform: "translateX(12px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 220, easing: "cubic-bezier(.16,1,.3,1)" },
        );
      return;
    }
    if (action === "shuffle" || action === "repeat") {
      if (action === "shuffle") playback.setShuffle(!playback.shuffled);
      else playback.repeat = ({off:"all",all:"one",one:"off"})[playback.repeat];
      queueIds=[...playback.order];
      button.setAttribute("aria-pressed",String(action === "shuffle" ? playback.shuffled : playback.repeat!=="off"));
      if (action === "repeat") {button.dataset.mode=playback.repeat;button.setAttribute("aria-label",playback.repeat==="one"?"Repetir faixa":playback.repeat==="all"?"Repetir fila":"Ativar repetição");}
      renderPlayer();return;
    }
    if (action === "queue_play") return playQueued(playback.selectAt(Number(button.dataset.index)));
    if (action === "queue_remove" || action === "queue_up") {
      const index=Number(button.dataset.index);
      if (action === "queue_remove") playback.removeAt(index); else playback.move(index,index-1);
      queueIds=[...playback.order];renderPlayer();return;
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
      if (track) {playback.start(data.local_tracks.filter(t=>t.available).map(t=>t.id),track.id);queueIds=[...playback.order];return invoke("play_local", { id: track.id });}
      return;
    }
    if (action === "play_local") {
      if (currentRows.some((e) => e.local?.id === Number(button.dataset.id))) {
        queueIds = currentRows
          .filter((e) => e.local?.available)
          .map((e) => e.local.id);
        queueMeta.clear();
        for (const row of currentRows.filter((e) => e.local?.available))
          queueMeta.set(row.local.id, { uri: row.uri, artwork: row.thumbnail });
      }
      playback.start(queueIds.length ? queueIds : data.local_tracks.filter(t=>t.available).map(t=>t.id),Number(button.dataset.id));
      queueIds=[...playback.order];
      return invoke("play_local", {
        id: Number(button.dataset.id),
        artwork:
          data.artwork?.[
            uri || queueMeta.get(Number(button.dataset.id))?.uri
          ] ||
          button.dataset.art ||
          "",
        track_uri: uri || queueMeta.get(Number(button.dataset.id))?.uri,
      });
    }
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
          play_after: false,
          total_tracks:
            selectedPlaylist === uri ? data.playlist?.tracks?.length : 1,
        });
      } finally {
        downloadRequestPending = false;
        renderLibrary();
      }
      return;
    }
    if (action === "delete_local") {
      const id = Number(button.dataset.id);
      const track = data.local_tracks.find((t) => t.id === id);
      if (!track) return;
      const d = dialog(
        "Excluir música baixada?",
        "<p>O arquivo de áudio será apagado do computador. O link e a playlist continuam na biblioteca, e você pode baixar novamente.</p><p><strong>" +
          esc(track.title) +
          '</strong></p><button class="music-green" data-confirm-delete>Excluir download</button>',
      );
      d.querySelector("[data-confirm-delete]").onclick = async (event) => {
        event.target.disabled = true;
        if (await invoke("delete_local", { id })) {
          playback.prune(new Set(data.local_tracks.filter(t=>t.available).map(t=>t.id)));
          queueIds=[...playback.order];
          queueMeta.delete(id);
          d.close();
        } else event.target.disabled = false;
      };
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
      (!Array.isArray(result.entries) && !result.player && !result.artwork)
    )
      return;
    const libraryChanged =
      result.artwork !== undefined ||
      result.playlist !== undefined ||
      Array.isArray(result.entries) ||
      Array.isArray(result.local_tracks) ||
      result.download?.state !== data.download?.state;
    data = { ...data, ...result };
    data.local_tracks ||= [];
    playback.prune(new Set(data.local_tracks.filter(t=>t.available).map(t=>t.id)));
    queueIds=[...playback.order];
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
        await request("playback_status", {
          revision: data.library_revision,
          artwork_revision: data.artwork_revision,
        }),
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
      musicLayout.dispose();
      cancelAnimationFrame(visualFrame);
      coverObserver?.disconnect();
      clearTimeout(coverTimer);
      clearInterval(timer);
      element.querySelectorAll("dialog").forEach((d) => {
        d.close();
        d.remove();
      });
    },
  };
};
