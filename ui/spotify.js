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
    devices:
      '<rect x="2" y="4" width="13" height="11" rx="2"/><path d="M5 20h7m-3-5v5"/><rect x="17" y="8" width="5" height="12" rx="1.5"/>',
    computer:
      '<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M8 21h8m-4-4v4"/>',
    phone:
      '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
    grip: '<path d="M5 8h14M5 12h14M5 16h14"/>',
    settings:
      '<path d="M4 7h4m6 0h6M4 17h9m6 0h1"/><circle cx="11" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-5 4 3 3-5 5 7"/>',
    play: '<path d="M6.2 4.8c0-1.2 1.2-1.8 2.2-1.2l12 7.2c1 .6 1 1.9 0 2.5l-12 7.1c-1 .6-2.2 0-2.2-1.2Z" fill="currentColor" stroke="none"/>',
    pause:
      '<g fill="currentColor" stroke="none"><rect x="5.6" y="3.9" width="4.9" height="16.2" rx="1.4"/><rect x="13.5" y="3.9" width="4.9" height="16.2" rx="1.4"/></g>',
    previous:
      '<g fill="currentColor" stroke="none"><rect x="4" y="5" width="3" height="14" rx="1.2"/><path d="M18.8 4.7c.9-.5 1.7 0 1.7 1v12.6c0 1-.8 1.5-1.7 1l-10-6.3q-1.5-1 0-2Z"/></g>',
    next: '<g fill="currentColor" stroke="none"><rect x="17" y="5" width="3" height="14" rx="1.2"/><path d="M5.2 4.7c-.9-.5-1.7 0-1.7 1v12.6c0 1 .8 1.5 1.7 1l10-6.3q1.5-1 0-2Z"/></g>',
    queue:
      '<path d="M4 5h16M4 10.8h16M4 16.6h7" stroke-width="2"/><path d="M14.7 14.2q0-.9.8-.4l5.2 3.2q.7.4 0 .9L15.5 21q-.8.4-.8-.5Z" fill="currentColor" stroke="none"/>',
    volume:
      '<path d="M12 4.2 6.5 8.6H3.7v6.8h2.8l5.5 4.4Z" fill="currentColor" stroke-width="1.2"/><path d="M15.5 8.4a5.3 5.3 0 0 1 0 7.2m3-10a9 9 0 0 1 0 12.8"/>',
    quiet:
      '<path d="M12 4.2 6.5 8.6H3.7v6.8h2.8l5.5 4.4Z" fill="currentColor" stroke-width="1.2"/><path d="M16 8.6a5 5 0 0 1 0 6.8"/>',
    muted:
      '<path d="m12 4.2-5.5 4.4H3.7v6.8h2.8l5.5 4.4Z" fill="currentColor" stroke-width="1.2"/><path d="m16.2 9.5 5 5m0-5-5 5"/>',
    shuffle:
      '<path d="M2.8 6h2.6c4.5 0 7.1 12 11.8 12H21m-3-3 3 3-3 3M2.8 18h2.6c1.8 0 3.4-2.1 4.7-4.1m3.3-4.6C14.7 7 15.9 6 17.5 6H21m-3-3 3 3-3 3" stroke-width="2"/>',
    repeat:
      '<path d="M4 11a5 5 0 0 1 5-5h10m-3-3 3 3-3 3m4 4a5 5 0 0 1-5 5H5m3 3-3-3 3-3" stroke-width="2"/>',
    heart: '<path d="M12 21 3.5 12C-3 5 7-1 12 6c5-7 15-1 8.5 6Z"/>',
    library:
      '<rect x="3" y="4" width="12" height="16" rx="2.4" fill="currentColor" fill-opacity=".15"/><circle cx="9" cy="12" r="2.6"/><path d="M18 5.5v13M21 7v10"/>',
    clock:
      '<circle cx="12" cy="13" r="8"/><path d="M9.5 2.3h5M12 9v4l2.6 1.7"/>',
    transfer: '<path d="M12 4v15m-5-5 5 5 5-5" stroke-width="2.4"/>',
  };
  Object.assign(glyph, {
    edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
    minus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    unlink:
      '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-.8.8M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l.8-.8"/><path d="m4 4 16 16"/>',
  });
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
  let sessionLoaded = false,
    sessionSignature = "";
  let pendingVolume = null,
    volumeTimer = 0,
    volumeSending = false,
    lastAudibleVolume = 80;

  function saveSessionSoon() {
    if (!sessionLoaded || disposed) return;
    flushSession();
  }
  function flushSession() {
    if (!sessionLoaded || disposed) return;
    const state = {
      ...playback.snapshot(),
      filter,
      playlist: selectedPlaylist,
    };
    const value = JSON.stringify(state);
    if (value === sessionSignature) return;
    sessionSignature = value;
    request("save_session", {
      ...state,
      revision: data.library_revision,
    }).catch(() => {
      sessionSignature = "";
      if (!disposed) notify("Não foi possível salvar a fila. Tente novamente.");
    });
  }
  function paintVolume(value) {
    const n = Math.max(0, Math.min(100, Math.round(value)));
    for (const input of element.querySelectorAll(
      ".music-volume-slider,[data-settings-volume]",
    )) {
      input.value = n;
      input.style.setProperty("--range-fill", n + "%");
      if (input.parentElement.classList.contains("music-scrubber")) {
        input.parentElement.style.setProperty("--range-fill", n + "%");
        input.parentElement.querySelector("output").textContent = n + "%";
      }
      input.setAttribute("aria-valuetext", n + "%");
    }
    for (const output of element.querySelectorAll(
      ".music-volume-value,[data-settings-volume-value]",
    ))
      output.textContent = n + "%";
    const mute = $("[data-action=mute]");
    const speaker = n === 0 ? "muted" : n < 50 ? "quiet" : "volume";
    if (mute && mute.dataset.speaker !== speaker) {
      mute.innerHTML = svg(speaker);
      mute.dataset.speaker = speaker;
    }
    mute?.setAttribute("aria-pressed", String(n === 0));
    mute?.setAttribute(
      "aria-label",
      n === 0 ? "Restaurar volume" : "Silenciar",
    );
  }
  function setVolume(value, immediate = false) {
    pendingVolume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    if (pendingVolume) lastAudibleVolume = pendingVolume;
    paintVolume(pendingVolume);
    if (immediate) {
      clearTimeout(volumeTimer);
      volumeTimer = 0;
      return flushVolume();
    }
    if (!volumeTimer)
      volumeTimer = setTimeout(() => {
        volumeTimer = 0;
        void flushVolume();
      }, 70);
  }
  async function flushVolume() {
    if (volumeSending || pendingVolume === null || disposed) return;
    volumeSending = true;
    const value = pendingVolume;
    pendingVolume = null;
    try {
      if (!cloudApplying && (await cloudOutput.command("volume", { value })))
        return;
      const result = await request("volume", {
        value,
        revision: data.library_revision,
      });
      if (!disposed && pendingVolume === null) update(result);
    } catch (error) {
      if (!disposed) notify(error.message);
    } finally {
      volumeSending = false;
      if (pendingVolume !== null && !disposed) void flushVolume();
    }
  }
  function bindVolume(input) {
    decorateSlider(input);
    input.oninput = (e) => setVolume(e.target.value);
    input.onchange = (e) => setVolume(e.target.value, true);
    input.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        setVolume(Number(input.value) + (event.deltaY < 0 ? 1 : -1), true);
      },
      { passive: false },
    );
  }

  /* ── Shell HTML ─────────────────────────────────────────────────────── */
  const listHeading =
    '<div class="music-list-heading"><span>#</span><span>Título</span><span>Download</span><span></span></div>';
  element.innerHTML = `<aside class="music-library music-panel" aria-label="Biblioteca"><header><strong>${svg("noise")}<span>Noise Music</span></strong><button data-action="collection" aria-label="Criar playlist" title="Criar playlist">${svg("plus")}</button></header><div class="music-filters" role="group" aria-label="Filtros da biblioteca"><button data-filter="all">Tudo</button><button data-filter="playlists">Playlists</button><button data-filter="downloaded">Baixadas</button></div><div class="music-library-tools"><label class="music-library-filter">${svg("search")}<input class="music-library-search" type="search" placeholder="Filtrar na biblioteca" aria-label="Filtrar sua biblioteca" autocomplete="off"></label><button data-action="search" aria-label="Ir para a busca de músicas" title="Buscar músicas">${svg("compass")}</button></div><nav class="music-library-nav" aria-label="Coleções"><button class="music-liked" data-filter="favorites"><span>${svg("heart")}</span><div><strong>Músicas curtidas</strong><small>Suas favoritas</small></div></button><div class="music-collections"></div></nav><div class="music-library-footer"><button data-action="settings" class="music-settings-open">${svg("settings")} Ajustes de música</button></div></aside>
  <section class="music-main music-panel" aria-label="Conteúdo"><header class="music-toolbar"><label class="music-search-field">${svg("search")}<input class="spotify-search" type="search" placeholder="Pesquisar na sua biblioteca" aria-label="Pesquisar na biblioteca" autocomplete="off"></label><button class="music-account" data-action="account" hidden>Conectar conta</button><button data-action="settings" aria-label="Configurações de música" title="Configurações de música">${svg("settings")}</button></header><div class="music-scroll"><div class="music-heading"><div><small class="music-section-label">Sua música</small><h2>Sua biblioteca</h2><p class="music-subtitle">Seus links e músicas baixadas, em um só lugar.</p></div><button class="music-add" data-action="add">${svg("plus")} Adicionar link</button></div>${listHeading}<div class="spotify-library"></div></div><div class="music-download" hidden role="status"></div></section>
  <aside class="music-queue music-panel" aria-label="Fila de reprodução"><header><div class="music-queue-tabs" role="tablist" aria-label="Painel de reprodução"><button data-action="queue_list" role="tab" aria-selected="true">Fila</button><button data-action="queue_details" role="tab" aria-selected="false" tabindex="-1">Tocando agora</button></div><button data-action="queue" aria-label="Fechar fila" title="Fechar fila">${svg("close")}</button></header><section class="music-now-section"><h3>Tocando agora</h3><div class="music-now"><div class="music-now-art">${svg("music")}</div><div class="music-now-text"><strong>Nada tocando</strong><small>Escolha uma faixa baixada.</small></div></div></section><section class="music-next-section"><h3 class="music-next-title">A seguir</h3><div class="music-next"></div></section></aside>
  <footer class="spotify-player"><div class="music-track"><div class="music-track-art">${svg("music")}</div><div><strong>Nenhuma faixa selecionada</strong><small>Escolha uma música baixada</small><small class="music-output-label">Este PC</small></div></div><div class="music-transport"><div class="music-controls"><button data-action="shuffle" aria-label="Reprodução aleatória" aria-pressed="false" title="Aleatório">${svg("shuffle")}</button><button data-action="previous" aria-label="Faixa anterior" title="Anterior">${svg("previous")}</button><button class="music-play" data-action="play" aria-label="Reproduzir" title="Reproduzir">${svg("play")}</button><button data-action="next" aria-label="Próxima faixa" title="Próxima">${svg("next")}</button><button data-action="repeat" aria-label="Ativar repetição" aria-pressed="false" title="Repetir">${svg("repeat")}</button></div><label class="music-timeline"><span class="music-position">0:00</span><input type="range" min="0" max="1" value="0" step="1000" class="music-seek" aria-label="Posição da música"><span class="music-duration">0:00</span></label></div><div class="music-volume"><button data-action="devices" class="music-device-toggle" aria-label="Dispositivos e saída de áudio">${svg("devices")}</button><button data-action="sleep_timer" aria-label="Temporizador" title="Temporizador">${svg("clock")}</button><button data-action="queue" aria-label="Mostrar fila" aria-pressed="true" title="Fila">${svg("queue")}</button><button data-action="mute" aria-label="Silenciar">${svg("volume")}</button><input type="range" min="0" max="100" value="80" class="music-volume-slider" aria-label="Volume"></div></footer>`;

  const playback = new window.MareMusicQueue();
  element.insertAdjacentHTML(
    "beforeend",
    `<section class="music-stage" hidden aria-label="Tocando agora"><img class="music-stage-background" alt=""><button data-action="stage_close" class="music-stage-close" aria-label="Voltar à biblioteca">${svg("back")}</button><div class="music-stage-body"><div class="music-stage-cover">${svg("music")}</div><div class="music-stage-copy"><p>Noise Music</p><h2>Nenhuma música selecionada</h2><p class="music-stage-artist">Sua biblioteca</p><button data-action="devices" class="music-stage-output">${svg("devices")}<span class="music-output-label">Este PC</span></button><label class="music-stage-timeline"><input class="music-stage-seek" type="range" min="0" max="1" value="0" aria-label="Posição da música"><span class="music-stage-position">0:00</span><span class="music-stage-duration">0:00</span></label><div class="music-stage-controls"><button data-action="shuffle" aria-label="Aleatório">${svg("shuffle")}</button><button data-action="previous" aria-label="Anterior">${svg("previous")}</button><button data-action="play" class="music-stage-play" aria-label="Reproduzir">${svg("play")}</button><button data-action="next" aria-label="Próxima">${svg("next")}</button><button data-action="repeat" aria-label="Repetir">${svg("repeat")}</button></div><div class="music-stage-volume">${svg("volume")}<input data-stage-volume data-settings-volume type="range" min="0" max="100" value="80" aria-label="Volume"></div></div></div></section>`,
  );
  const trackButton = document.createElement("button");
  trackButton.className = "music-track-open";
  trackButton.dataset.action = "stage_open";
  element.addEventListener("keydown", (event) => {
    const stage = $(".music-stage");
    if (stage.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      $(".music-stage-close").click();
    } else if (event.key === "Tab") {
      const controls = [
        ...stage.querySelectorAll(
          "button:not(:disabled), input:not(:disabled)",
        ),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  trackButton.ariaLabel = "Abrir player";
  $(".music-track").append(trackButton);
  const musicLayout = window.attachMusicLayout(element);
  function syncQueueToggle() {
    const open = element.classList.contains("music-narrow")
      ? element.classList.contains("queue-expanded")
      : !element.classList.contains("queue-hidden");
    const button = $(".spotify-player [data-action=queue]");
    button?.setAttribute("aria-pressed", String(open));
    button?.setAttribute("aria-expanded", String(open));
  }
  element.addEventListener("music-layout", syncQueueToggle);
  syncQueueToggle();
  const musicTools = window.attachMusicTools({
    element,
    data: () => data,
    rows: () => currentRows,
    invoke,
    icon: svg,
    escape: esc,
    localFor,
    layout: musicLayout,
    decorateSlider,
    queue: playback,
    output: () => cloudOutput,
    currentCollection: () =>
      data.collections.find((c) => String(c.id) === String(filter))?.id,
    queueChanged: (row) => {
      if (row?.local)
        queueMeta.set(row.local.id, { uri: row.uri, artwork: row.thumbnail });
      queueIds = [...playback.order];
      syncCloudQueue();
      renderPlayer();
    },
    redraw: () => {
      signature = "";
      renderLibrary();
    },
    notify,
  });

  async function invoke(method, params = {}) {
    try {
      if (!cloudApplying) {
        if (
          ["pause", "resume", "seek", "volume"].includes(method) &&
          (await cloudOutput.command(
            method,
            method === "volume" ? { value: params.value } : params,
          ))
        )
          return data;
        if (method === "play_local" && cloudOutput.remote()) {
          const track = data.local_tracks.find((t) => t.id === params.id);
          const id = (params.track_uri || track?.track_uri || "")
            .split(":")
            .at(-1);
          if (!id || id.length !== 22)
            throw Error(
              "Esta faixa local só pode tocar neste PC. Selecione este PC em Dispositivos.",
            );
          await cloudOutput.play(
            {
              id,
              title: track?.title,
              artist: track?.artists,
              art: params.artwork || track?.artwork,
            },
            cloudPlayer().queue,
          );
          return data;
        }
      }
      const result = await request(method, params);
      if (["play_local", "resume"].includes(method)) cloudOutput.claim();
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
    if (
      musicLayout.config.motion !== false &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      list.animate(
        [
          { opacity: 0.5, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 200, easing: "cubic-bezier(.16,1,.3,1)" },
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
    if (
      musicLayout.config.motion !== false &&
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
      else {
        form.querySelector("[role=status]").textContent =
          "Não foi possível adicionar este link. Confira o endereço e tente novamente.";
        form
          .querySelectorAll("button")
          .forEach((button) => (button.disabled = false));
      }
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
      "Criar playlist",
      `<form class="spotify-new"><label>Nome da playlist<input name="name" required maxlength="60" autofocus></label><button class="music-green">Criar</button></form>`,
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

  function editPlaylistDialog(target) {
    const source = target.uri
      ? data.entries.find((e) => e.uri === target.uri)
      : data.collections.find((c) => c.id === target.id);
    if (!source) return;
    let cover;
    const d = dialog(
      "Editar playlist",
      `<form class="music-playlist-editor"><div class="music-playlist-editor-preview">${source.thumbnail ? `<img src="${esc(source.thumbnail)}" alt="Capa da playlist">` : svg("music")}</div><label>Nome da playlist<input name="name" maxlength="100" required value="${esc(source.title || source.name)}"></label><label class="music-cover-upload music-secondary">${svg("image")} Escolher capa<input type="file" accept="image/png,image/jpeg,image/webp" hidden></label><p>A capa e o nome ficam na sua biblioteca do Noise. A playlist original do Spotify permanece como está.</p><small role="status"></small><div class="music-dialog-actions"><button type="button" data-clear>Capa automática</button><button class="music-green" type="submit">Salvar</button></div></form>`,
    );
    const form = d.querySelector("form"),
      status = form.querySelector("[role=status]"),
      save = form.querySelector("[type=submit]");
    const paint = (art) => {
      form.querySelector(".music-playlist-editor-preview").innerHTML = art
        ? `<img src="${esc(art)}" alt="Capa da playlist">`
        : svg("music");
    };
    form.querySelector("[type=file]").onchange = async (event) => {
      save.disabled = true;
      status.textContent = "Preparando capa…";
      try {
        cover = await window.prepareMusicCover(event.target.files?.[0]);
        paint(cover);
        status.textContent = "Capa pronta para salvar.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        save.disabled = false;
        event.target.value = "";
      }
    };
    form.querySelector("[data-clear]").onclick = () => {
      cover = "";
      paint("");
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      save.disabled = true;
      const result = await invoke("edit_playlist", {
        ...target,
        name: form.elements.name.value,
        ...(cover !== undefined ? { art: cover } : {}),
      });
      if (result) d.close();
      else {
        status.textContent = "Não foi possível salvar a playlist.";
        save.disabled = false;
      }
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
      "Ajustes de música",
      `<div class="music-settings-shell"><nav class="music-settings-nav" aria-label="Seções dos ajustes"><button data-settings-tab="appearance" aria-current="page">${svg("settings")} Aparência</button><button data-settings-tab="wallpaper">${svg("image")} Fundo</button><button data-settings-tab="playback">${svg("volume")} Reprodução</button><button data-settings-tab="integrations">${svg("share")} Conexões</button><button data-settings-tab="downloads">${svg("download")} Downloads</button></nav><div class="music-settings-content"><section data-settings-pane="appearance"><h4>Do seu jeito</h4><p>Cores, tamanhos e espaço para sua biblioteca.</p><div class="music-appearance-options"></div></section><section data-settings-pane="wallpaper" hidden><h4>Seu fundo</h4><p>Uma imagem para deixar a música com a sua cara. O arquivo fica somente neste computador.</p><div class="music-wallpaper-options"></div></section><section data-settings-pane="playback" hidden><h4>Reprodução</h4><p>Sua fila, playlist, posição e volume são salvos neste computador. Ao reabrir, a música aguarda seu play.</p><label class="music-setting-range">Volume <output data-settings-volume-value>${data.player?.volume ?? 80}%</output><input data-settings-volume type="range" min="0" max="100" step="1" value="${data.player?.volume ?? 80}" aria-label="Volume da reprodução"></label><small>Ajuste fino em volumes baixos. Use as setas para mudar 1% ou a roda do mouse sobre o controle.</small><div class="music-session-summary"><strong>Continuar de onde parou</strong><p>A fila é restaurada com a ordem aleatória e o modo de repetição. Faixas removidas do disco são descartadas da fila.</p></div></section><section data-settings-pane="integrations" hidden><h4>Conexões</h4><form class="music-presence"><label class="music-setting-switch"><span>Discord Rich Presence<small>Mostrar a música no seu perfil do Discord desktop.</small></span><input type="checkbox" name="enabled" ${p.enabled ? "checked" : ""}></label><small role="status" data-presence-status>${esc({ disabled: "Desativada", discord_closed: "Abra o Discord no computador", connecting: "Conectando…", ready: "Pronta para compartilhar", active: "Música compartilhada", rejected: "O Discord recusou a atividade" }[p.state] || "Aguardando o Discord")}</small></form><section class="music-cloud-settings"></section><section class="music-remote-settings"></section></section><section data-settings-pane="downloads" hidden><h4>Downloads</h4><p>As músicas ficam na biblioteca deste computador e liberam o play quando o download termina.</p><div class="music-component-status"><span class="music-status-dot"></span>${data.sunnify_available ? "Downloads disponíveis" : "Componente de download ausente"}</div><button class="music-secondary" data-scan>${svg("reload")} Atualizar músicas baixadas</button><small>Os arquivos concluídos são preservados. A busca online depende da disponibilidade do catálogo.</small></section></div></div>`,
    );
    d.classList.add("music-settings-dialog");
    musicTools.configure(d);
    for (const tab of d.querySelectorAll("[data-settings-tab]"))
      tab.onclick = () => {
        for (const b of d.querySelectorAll("[data-settings-tab]"))
          b.setAttribute("aria-current", b === tab ? "page" : "false");
        for (const pane of d.querySelectorAll("[data-settings-pane]"))
          pane.hidden = pane.dataset.settingsPane !== tab.dataset.settingsTab;
        d.querySelector(".music-settings-content").scrollTop = 0;
      };
    renderRemoteSettings();
    renderCloudSettings();
    d.querySelector("[data-scan]").onclick = async (event) => {
      event.currentTarget.disabled = true;
      await invoke("scan_local");
      if (d.isConnected) event.target.closest("button").disabled = false;
    };
    d.querySelector("[name=enabled]").onchange = async (event) => {
      const input = event.target;
      input.disabled = true;
      const result = await invoke("presence_config", {
        enabled: input.checked,
      });
      if (!result) input.checked = !input.checked;
      input.disabled = false;
      d.querySelector("[data-presence-status]").textContent = result
        ? input.checked
          ? "Compartilhamento ativado"
          : "Compartilhamento desativado"
        : "Não foi possível salvar. Tente novamente.";
    };
    bindVolume(d.querySelector("[data-settings-volume]"));
  }

  let cloudCommandsBusy = false,
    cloudApplying = 0,
    cloudPublishedAt = 0,
    cloudPublishedKey = "",
    pendingCloudPlayer = null,
    cloudQueue = null;
  const cloudSeen = new Set();
  function cloudPlayer() {
    const player = data.player || {},
      track = data.local_tracks?.find((t) => t.id === player.track_id);
    const id = track?.track_uri?.split(":").at(-1);
    return {
      track_id: id?.length === 22 ? id : null,
      title: track?.title || "",
      artist: track?.artists || "",
      art: track?.artwork || data.artwork?.[track?.track_uri] || "",
      state: player.state || "stopped",
      position_ms: Math.round(player.position_ms || 0),
      duration_ms: Math.round(player.duration_ms || 0),
      volume: player.volume ?? 80,
      activation: cloudOutput.activation(),
      queue:
        cloudQueue ||
        playback
          .upcoming()
          .map((id) =>
            data.local_tracks
              .find((t) => t.id === id)
              ?.track_uri?.split(":")
              .at(-1),
          )
          .filter((id) => id?.length === 22),
    };
  }
  const cloudOutput = window.createMusicOutput({
    getState: () => data.cloud || {},
    localPlayer: cloudPlayer,
    send: (target, command) => request("cloud_command", { target, command }),
    receive: receiveCloudPlayer,
  });
  function visiblePlayer() {
    const remote = cloudOutput.remote();
    return remote
      ? { ...remote.player, track_id: "remote:" + remote.player.track_id }
      : data.player || {};
  }
  function visibleTrack() {
    const remote = cloudOutput.remote(),
      p = remote?.player;
    return remote
      ? p.track_id
        ? {
            id: "remote:" + p.track_id,
            title: p.title,
            artists: p.artist,
            artwork: p.art,
            track_uri: "spotify:track:" + p.track_id,
            available: true,
          }
        : null
      : data.local_tracks.find((t) => t.id === data.player?.track_id);
  }
  function syncCloudQueue(removed = null) {
    if (!cloudQueue) return;
    const canonical = (id) =>
      data.local_tracks
        .find((t) => t.id === id)
        ?.track_uri?.split(":")
        .at(-1);
    const ready = new Set(
      data.local_tracks
        .filter((t) => t.available)
        .map((t) => t.track_uri?.split(":").at(-1)),
    );
    cloudQueue = [
      ...playback
        .upcoming()
        .map(canonical)
        .filter((id) => id?.length === 22),
      ...cloudQueue.filter((id) => !ready.has(id) && id !== removed),
    ];
  }
  async function receiveCloudPlayer(player) {
    cloudApplying++;
    try {
      return await receiveCloudPlayerLocal(player);
    } finally {
      cloudApplying--;
    }
  }
  async function receiveCloudPlayerLocal(player) {
    if (player.action === "pause") {
      await invoke("pause");
      return;
    }
    const uri = "spotify:track:" + player.track_id;
    const local = data.local_tracks.find(
      (t) => t.available && (t.track_uri === uri || t.source_uri === uri),
    );
    if (!local) {
      pendingCloudPlayer = player;
      if (data.download?.state === "running") return { pending: true };
      const result = await invoke("download", { url: uri, play_after: false });
      if (!result) {
        pendingCloudPlayer = null;
        throw Error(
          "Aguarde o download atual antes de transferir a reprodução.",
        );
      }
      notify("Baixando no PC para continuar a reprodução.");
      return { pending: true };
    }
    pendingCloudPlayer = null;
    cloudQueue = (player.queue || []).filter((id) =>
      /^[A-Za-z0-9]{22}$/.test(id),
    );
    playback.start(
      [
        local.id,
        ...cloudQueue
          .map(
            (id) =>
              data.local_tracks.find(
                (t) => t.available && t.track_uri === "spotify:track:" + id,
              )?.id,
          )
          .filter(Boolean),
      ],
      local.id,
    );
    queueIds = [...playback.order];
    const started = await invoke("play_local", {
      id: local.id,
      track_uri: uri,
      artwork: player.art || "",
    });
    if (!started)
      throw Error("Não foi possível iniciar a reprodução neste PC.");
    await invoke("seek", { position_ms: Math.max(0, player.position_ms || 0) });
    if (player.state !== "playing") await invoke("pause");
    renderPlayer();
    if (player.source && player.source !== data.cloud?.id)
      await request("cloud_command", {
        target: player.source,
        command: {
          action: "pause",
          expected_activation: player.activation || 0,
        },
      });
  }
  function mountCloudPanel(section, accountEntry = false) {
    if (!section.devicePanel)
      section.devicePanel = window.createMusicDevices(section, {
        desktop: true,
        accountEntry,
        getState: () => data.cloud || {},
        localPlayer: cloudPlayer,
        icon: svg,
        output: cloudOutput,
        notify,
        connect: (origin, username, password) =>
          invoke("cloud_login", { origin, username, password }),
        send: (target, command) =>
          request("cloud_command", { target, command }),
        receive: receiveCloudPlayer,
        disconnect: () => invoke("cloud_disconnect"),
      });
    section.devicePanel.render();
  }
  function renderCloudSettings() {
    if (data.cloud) {
      let gate = $(".music-account-gate");
      if (!data.cloud.connected && !gate) {
        for (const dialog of element.querySelectorAll("dialog")) {
          dialog.close();
          dialog.remove();
        }
        element.querySelector(".music-context")?.remove();
        gate = document.createElement("section");
        gate.className = "music-account-gate";
        gate.setAttribute("aria-label", "Entrar na conta do Noise Music");
        gate.innerHTML =
          '<div class="music-account-card"><div class="music-account-mark">' +
          svg("music") +
          '</div><section class="music-cloud-settings"></section></div>';
        element.append(gate);
        for (const child of element.children)
          if (child !== gate) child.inert = true;
      } else if (data.cloud.connected && gate) {
        gate.remove();
        for (const child of element.children) child.inert = false;
      }
    }
    for (const section of element.querySelectorAll(".music-cloud-settings"))
      mountCloudPanel(section, !!section.closest(".music-account-gate"));
  }
  async function processCloud() {
    renderCloudSettings();
    for (const d of element.querySelectorAll("dialog")) d.outputPanel?.render();
    if (!data.cloud?.connected || cloudCommandsBusy) return;
    const player = cloudPlayer();
    const key = JSON.stringify([
      player.track_id,
      player.state,
      player.activation,
      player.queue,
      player.volume,
    ]);
    if (
      key !== cloudPublishedKey ||
      performance.now() - cloudPublishedAt > 500
    ) {
      cloudPublishedKey = key;
      cloudPublishedAt = performance.now();
      request("cloud_publish", { player }).catch(() => {
        cloudPublishedKey = "";
      });
    }
    cloudCommandsBusy = true;
    try {
      if (cloudOutput.remote() && data.player?.state === "playing") {
        cloudApplying++;
        try {
          await invoke("pause");
        } finally {
          cloudApplying--;
        }
      }
      if (
        pendingCloudPlayer &&
        data.local_tracks.some(
          (t) =>
            t.available &&
            t.track_uri === "spotify:track:" + pendingCloudPlayer.track_id,
        )
      )
        await receiveCloudPlayer(pendingCloudPlayer);
      for (const operation of data.cloud.commands || []) {
        if (cloudSeen.has(operation.id)) continue;
        cloudSeen.add(operation.id);
        const c = operation.command;
        cloudApplying++;
        try {
          if (
            c.action === "pause" &&
            c.expected_activation != null &&
            c.expected_activation !== cloudOutput.activation()
          )
            continue;
          if (c.action === "transfer") await receiveCloudPlayer(c.player);
          else if (c.action === "next" || c.action === "previous")
            await step(c.action === "next" ? 1 : -1);
          else if (c.action === "volume") await setVolume(c.value, true);
          else if (c.action === "seek")
            await invoke("seek", { position_ms: c.position_ms });
          else if (["pause", "resume"].includes(c.action))
            await invoke(c.action);
          else if (c.action === "select") cloudOutput.claim();
          else if (c.action === "queue") {
            cloudQueue = c.queue;
            const local = data.local_tracks.find(
              (t) => t.id === data.player?.track_id,
            );
            playback.start(
              [
                local?.id,
                ...c.queue.map(
                  (id) =>
                    data.local_tracks.find(
                      (t) => t.track_uri === "spotify:track:" + id,
                    )?.id,
                ),
              ].filter(Boolean),
              local?.id,
            );
          }
        } finally {
          cloudApplying--;
          await request("cloud_publish", { player: cloudPlayer() });
          await request("cloud_ack", { id: operation.id });
        }
      }
    } catch (error) {
      notify(error.message);
    } finally {
      cloudCommandsBusy = false;
    }
  }

  function renderRemoteSettings() {
    const section = $(".music-remote-settings");
    if (!section) return;
    const remote = window.mare?.getMusicRemote?.() || { enabled: false };
    const signature = JSON.stringify(remote);
    if (section.dataset.signature === signature) return;
    section.dataset.signature = signature;
    section.innerHTML =
      "<h4>Controlar pelo celular</h4><p>Mesma rede Wi-Fi, com pareamento. O áudio continua no PC.</p>" +
      (remote.enabled
        ? "<p>Abra este endereço no celular:</p>" +
          (remote.urls || [])
            .map((url) => "<code>" + esc(url) + "</code>")
            .join("") +
          (!(remote.urls || []).length
            ? "<p>Não foi possível detectar o IP da Wi-Fi. Porta: " +
              remote.port +
              ". Use o endereço IPv4 local do PC.</p>"
            : "") +
          '<p>Código de pareamento</p><strong class="music-pair-code">' +
          esc(remote.code) +
          "</strong><small>Código válido por cinco minutos. Use uma Wi-Fi confiável (HTTP).</small><div><button data-remote-renew>Renovar código</button><button data-remote-disable>Desativar controle</button></div>"
        : '<p>Desligado. Ative somente quando quiser conectar seu celular.</p><button class="music-green" data-remote-enable>Ativar na Wi-Fi</button>');
    section
      .querySelector("[data-remote-enable]")
      ?.addEventListener("click", () => window.mare.setMusicRemote?.(true));
    section
      .querySelector("[data-remote-renew]")
      ?.addEventListener("click", () => window.mare.setMusicRemote?.(true));
    section
      .querySelector("[data-remote-disable]")
      ?.addEventListener("click", () => window.mare.setMusicRemote?.(false));
  }
  async function accountDialog() {
    if (!data.account?.configured) {
      const d = dialog(
        "Conectar ao Spotify",
        `<p>O login é opcional e usa a autorização oficial do Spotify para importar suas playlists e músicas curtidas.</p><p>Esta build ainda precisa de um Client ID registrado pelo mantenedor do Noise. Você não precisa cadastrar um aplicativo pessoal. Enquanto isso, adicione playlists por link e ouça as músicas baixadas sem conectar sua conta.</p><button class="music-green" data-ok>Entendi</button>`,
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
  let sortingQueue = [];
  const librarySort = window.attachMusicSort($(".spotify-library"), {
    onCommit: async (order) => {
      await invoke("reorder_playlist", {
        order,
        ...(selectedPlaylist
          ? { playlist: selectedPlaylist }
          : { collection: Number(filter) }),
      });
      signature = "";
      renderLibrary();
    },
  });
  const queueSort = window.attachMusicSort($(".music-next"), {
    onStart: () => {
      sortingQueue = cloudOutput.remote()
        ? [...cloudOutput.remote().player.queue]
        : [...playback.order];
    },
    onCommit: (keys) => {
      if (cloudOutput.remote()) {
        cloudOutput
          .command("queue", {
            queue: keys.map((index) => sortingQueue[Number(index)]),
          })
          .catch((e) => notify(e.message));
        return;
      }
      playback.order = [
        ...sortingQueue.slice(0, playback.position + 1),
        ...keys.map((index) => sortingQueue[Number(index)]),
      ];
      queueIds = [...playback.order];
      syncCloudQueue();
      renderPlayer();
    },
  });
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
        (!scope || !t.source_uri || t.source_uri === scope) &&
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
      const base = p?.uri === selectedPlaylist ? p.tracks || [] : [];
      const extra = (data.playlist_additions?.[selectedPlaylist] || [])
        .map((uri) => data.entries.find((entry) => entry.uri === uri))
        .filter(Boolean);
      let source = [
        ...base,
        ...extra.filter(
          (entry) => !base.some((track) => track.uri === entry.uri),
        ),
      ];
      const order = data.playlist_orders?.[selectedPlaylist] || [];
      if (
        data.entries.find((e) => e.uri === selectedPlaylist)?.cloud_owned &&
        Object.hasOwn(data.playlist_orders || {}, selectedPlaylist)
      ) {
        source = source.filter((e) => order.includes(e.uri));
      }
      source.sort(
        (a, b) =>
          (order.includes(a.uri) ? order.indexOf(a.uri) : Infinity) -
          (order.includes(b.uri) ? order.indexOf(b.uri) : Infinity),
      );
      return source.map((e) => {
        const local = localFor(e, selectedPlaylist);
        return {
          ...e,
          kind: "track",
          favorite:
            data.entries.find((item) => item.uri === e.uri)?.favorite || false,
          local,
          thumbnail: data.artwork?.[e.uri] || e.thumbnail || "",
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

  /* ── renderLibrary ──────────────────────────────────────────────────── */
  const setText = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };
  const FOCUS_KEYS = [
    "action",
    "uri",
    "id",
    "filter",
    "collection",
    "index",
    "row",
  ];
  const FOCUS_ZONES = [
    ".music-library-nav",
    ".music-heading",
    ".spotify-library",
  ];
  function focusSnapshot() {
    const active = document.activeElement;
    if (!active || active === document.body || !element.contains(active))
      return null;
    const zone = FOCUS_ZONES.find((z) => active.closest(z));
    if (!zone) return null;
    const attrs = FOCUS_KEYS.filter((k) => active.dataset?.[k] != null)
      .map((k) => `[data-${k}="${CSS.escape(active.dataset[k])}"]`)
      .join("");
    return { node: active, zone, selector: attrs ? "button" + attrs : "" };
  }
  function restoreFocus(snapshot) {
    if (!snapshot || snapshot.node.isConnected || !snapshot.selector) return;
    $(snapshot.zone)
      ?.querySelector(snapshot.selector)
      ?.focus({ preventScroll: true });
  }
  let markedKey = "";
  function markPlaying(force) {
    const shown = visibleTrack(),
      id = cloudOutput.remote()
        ? data.local_tracks.find((t) => t.track_uri === shown?.track_uri)?.id
        : shown?.id,
      state = visiblePlayer().state,
      active = id != null && (state === "playing" || state === "paused"),
      key = active ? id + ":" + state : "";
    if (!force && key === markedKey) return;
    markedKey = key;
    element.querySelectorAll(".music-row.is-current").forEach((row) => {
      row.classList.remove("is-current");
      row.removeAttribute("aria-current");
      delete row.dataset.playerState;
    });
    if (!active) return;
    element
      .querySelectorAll(`.music-row-play[data-id="${id}"]`)
      .forEach((button) => {
        const row = button.closest(".music-row");
        row.classList.add("is-current");
        row.setAttribute("aria-current", "true");
        row.dataset.playerState = state;
      });
  }
  const tileHTML = (kind, item) => {
    if (kind === "downloaded")
      return `<button class="music-album-card" data-filter="downloaded"><span class="music-tile-art music-downloads-cover">${svg("download")}</span><span class="music-tile-text"><strong>Músicas baixadas</strong><small>Músicas avulsas</small></span></button>`;
    if (kind === "collection")
      return `<button class="music-album-card" data-collection="${item.id}"><span class="music-tile-art">${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy">` : svg("library")}</span><span class="music-tile-text"><strong>${esc(item.name)}</strong><small>Playlist local</small></span></button>`;
    return `<button class="music-album-card" data-action="open_playlist" data-uri="${esc(item.uri)}"><span class="music-tile-art">${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy">` : svg("music")}</span><span class="music-tile-text"><strong>${esc(item.title)}</strong><small>${item.kind === "album" ? "Álbum" : "Playlist"}</small></span></button>`;
  };
  const stateBlock = (iconName, title, text, action = "", role = "status") =>
    `<div class="music-empty" role="${role}"><span>${svg(iconName)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
  function rowHTML(e, i, busy, stored) {
    const ready = !!e.local?.available,
      playable =
        ready ||
        (!!cloudOutput.remote() &&
          /^spotify:track:[A-Za-z0-9]{22}$/.test(e.uri || "")),
      downloading =
        !ready &&
        busy &&
        data.download?.url?.endsWith(e.uri?.split(":").slice(1).join("/")),
      status = ready
        ? ["ready", "check", "Baixada"]
        : downloading
          ? ["busy", "download", "Baixando…"]
          : ["none", "", "Não baixada"],
      isStored = !!e.uri && stored.has(e.uri);
    return `<article class="music-row spotify-item ${ready ? "is-downloaded" : ""}" ${!query && (selectedPlaylist || data.collections.some((c) => String(c.id) === String(filter))) && e.uri ? 'data-sort-key="' + esc(e.uri) + '"' : ""} data-artwork-uri="${esc(e.uri || "")}"><button class="music-row-play" data-action="play_local" data-id="${e.local?.id || 0}" data-uri="${esc(e.uri || "")}" data-art="${esc(e.thumbnail || (!selectedPlaylist ? e.local?.artwork : "") || "")}" ${playable ? "" : "disabled"} aria-label="${playable ? "Reproduzir" : "Baixe para reproduzir"} ${esc(e.title)}"><span class="music-row-num">${i + 1}</span>${ready ? `<span class="music-row-icon">${svg("play")}</span>` : ""}<span class="music-row-eq">${svg("volume")}</span></button><div class="music-row-title"><span class="spotify-art">${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy" decoding="async">` : svg("music")}</span><div class="spotify-item-info"><strong>${esc(e.title)}</strong><small>${esc(e.artists || e.local?.artists || "Música")}</small></div></div><small class="music-availability" data-state="${status[0]}">${status[1] ? svg(status[1]) : '<i aria-hidden="true"></i>'}<span>${status[2]}</span></small><div class="music-row-actions">${!query && (selectedPlaylist || data.collections.some((c) => String(c.id) === String(filter))) && e.uri ? '<button data-sort-handle aria-label="Mover faixa">' + svg("grip") + "</button>" : ""}${isStored ? `<button data-action="favorite" data-uri="${esc(e.uri)}" aria-label="Curtir ${esc(e.title)}" aria-pressed="${!!e.favorite}" title="Curtir">${svg("heart")}</button>` : ""}${e.uri ? `<button data-action="download" data-uri="${esc(e.uri)}" ${ready || busy ? "disabled" : ""} aria-label="${ready ? "Download confirmado" : "Baixar"} ${esc(e.title)}" title="${ready ? "Baixada" : "Baixar"}">${svg(ready ? "check" : "download")}</button>` : ""}<button data-action="track_menu" data-row="${i}" aria-haspopup="menu" aria-label="Mais opções para ${esc(e.title)}" title="Mais opções">${svg("more")}</button><span class="music-row-proxies" hidden>${ready ? `<button data-action="delete_local" data-id="${e.local.id}" tabindex="-1" aria-label="Excluir download de ${esc(e.title)}">Excluir download</button>` : ""}${isStored ? `<button data-action="remove" data-uri="${esc(e.uri)}" tabindex="-1" aria-label="Remover link ${esc(e.title)}">Remover link</button>` : ""}</span></div></article>`;
  }
  function renderLibrary() {
    const busy = downloadRequestPending || data.download?.state === "running";
    const next = JSON.stringify([
      data.artwork,
      data.entries,
      data.collections,
      data.playlist_orders,
      data.playlist_additions,
      data.local_tracks,
      data.completed_sources,
      data.playlist,
      data.download?.state,
      selectedPlaylist,
      filter,
      query,
      busy,
      musicTools.searching,
      musicTools.term,
      data.search,
    ]);
    if (next === signature) return;
    signature = next;
    const snapshot = focusSnapshot();
    paintLibrary(busy);
    restoreFocus(snapshot);
    markPlaying(true);
  }
  function paintLibrary(busy) {
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
            `<button data-collection="${c.id}" aria-pressed="${!selectedPlaylist && String(filter) === String(c.id)}"><span class="music-sidebar-art">${c.thumbnail ? `<img src="${esc(c.thumbnail)}" alt="" loading="lazy">` : svg("folder")}</span><div><strong>${esc(c.name)}</strong><small>Playlist local</small></div></button>`,
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
    if (musicTools.searching) {
      musicTools.renderSearch();
      currentRows = [];
      return;
    }
    const entry = data.entries.find((e) => e.uri === selectedPlaylist),
      p = data.playlist?.uri === selectedPlaylist ? data.playlist : null;
    const shelfOnly = !selectedPlaylist && filter === "playlists";
    const home = !selectedPlaylist && filter === "all" && !query;
    const heading = $(".music-heading");
    // Row derivation is the expensive part; do it once per paint.
    const base = shelfOnly ? [] : rowsForView();
    $(".music-list-heading").hidden = home || shelfOnly;
    heading.classList.toggle("music-playlist-heading", !!selectedPlaylist);
    const downloadedCount = base.filter((e) => e.local?.available).length;
    heading.innerHTML = selectedPlaylist
      ? `<button class="music-cover-back" data-action="library" aria-label="Voltar à biblioteca" title="Voltar">${svg("back")}</button><div class="music-playlist-cover">${entry?.thumbnail ? `<img src="${esc(entry.thumbnail)}" alt="">` : svg("music")}</div><div class="music-playlist-meta"><small>Playlist</small><h2>${esc(entry?.title || p?.name || "Playlist")}</h2><p>${esc(p?.owner || "Sua biblioteca")}${p?.state === "ready" ? ` · ${p.tracks.length} músicas · ${downloadedCount} baixadas` : ""}</p><div class="music-playlist-controls"><button class="music-green music-play-all" aria-label="Reproduzir playlist" title="Reproduzir" data-action="play_view" ${downloadedCount || (cloudOutput.remote() && p?.tracks?.length) ? "" : "disabled"}>${svg("play")}</button><button class="music-secondary" data-action="download" data-uri="${esc(selectedPlaylist)}" ${busy || p?.state !== "ready" || data.completed_sources?.includes(selectedPlaylist) ? "disabled" : ""}>${svg("download")}${data.completed_sources?.includes(selectedPlaylist) ? "Baixada" : "Baixar playlist"}</button><button data-action="edit_playlist" data-uri="${esc(selectedPlaylist)}" aria-label="Editar nome e capa" title="Editar playlist">${svg("edit")}</button><button data-action="refresh_playlist" aria-label="Atualizar playlist" title="Atualizar playlist">${svg("reload")}</button></div></div>`
      : `<div><small class="music-section-label">Sua música</small><h2>${filter === "favorites" ? "Músicas curtidas" : filter === "downloaded" ? "Músicas baixadas" : filter === "playlists" ? "Playlists" : data.collections.find((c) => String(c.id) === String(filter))?.name || "Sua biblioteca"}</h2><p class="music-subtitle">${filter === "downloaded" ? "Suas músicas avulsas, prontas para baixar e ouvir." : filter === "playlists" ? "Playlists importadas por link e playlists locais." : "Seus links e músicas baixadas, em um só lugar."}</p></div><button class="music-add" data-action="add">${svg("plus")} Adicionar link</button>`;
    const localCollection = data.collections.find(
      (c) => String(c.id) === String(filter),
    );
    if (localCollection) {
      const members = base.filter(
        (e) =>
          String(e.collection) === String(filter) ||
          localCollection.uris?.includes(e.uri),
      );
      const cover =
        localCollection.thumbnail ||
        members.find((e) => e.thumbnail)?.thumbnail;
      heading.classList.add("music-playlist-heading");
      heading.innerHTML = `<button class="music-cover-back" data-action="library" aria-label="Voltar à biblioteca" title="Voltar">${svg("back")}</button><div class="music-playlist-cover">${cover ? `<img src="${esc(cover)}" alt="">` : svg("music")}</div><div class="music-playlist-meta"><small>Playlist local</small><h2>${esc(localCollection.name)}</h2><p>${members.length} músicas na sua biblioteca · ${members.filter((e) => e.local?.available).length} baixadas</p><div class="music-playlist-controls"><button class="music-green music-play-all" aria-label="Reproduzir playlist" title="Reproduzir" data-action="play_view" ${members.some((e) => e.local?.available) || (cloudOutput.remote() && members.length) ? "" : "disabled"}>${svg("play")}</button><button data-action="edit_playlist" data-id="${localCollection.id}" aria-label="Editar nome e capa" title="Editar playlist">${svg("edit")}</button><button data-action="delete_collection" data-id="${localCollection.id}" aria-label="Excluir playlist" title="Excluir playlist">${svg("trash")}</button></div></div>`;
    }
    const library = $(".spotify-library");
    const wanted = normalized(query);
    if (shelfOnly) {
      const tiles = [
        ...(wanted && !normalized("Músicas baixadas").includes(wanted)
          ? []
          : [tileHTML("downloaded")]),
        ...playlists
          .filter((e) => normalized(e.title).includes(wanted))
          .map((e) => tileHTML("playlist", e)),
        ...data.collections
          .filter((c) => normalized(c.name).includes(wanted))
          .map((c) => tileHTML("collection", c)),
      ];
      library.innerHTML = tiles.length
        ? `<div class="music-album-grid">${tiles.join("")}</div>`
        : stateBlock(
            "search",
            "Nenhuma playlist encontrada",
            `Nenhuma playlist corresponde a “${query}”.`,
            '<button class="music-secondary" data-action="clear_filter">Limpar filtro</button>',
          );
      currentRows = [];
      return;
    }
    if (selectedPlaylist && p?.state !== "ready") {
      library.innerHTML =
        p?.state === "error"
          ? stateBlock(
              "close",
              "Não foi possível abrir a playlist",
              p?.error || "Tente novamente em instantes.",
              '<button class="music-green" data-action="refresh_playlist">Tentar novamente</button>',
              "alert",
            )
          : `<div class="music-skeleton-list" role="status" aria-label="Carregando músicas">${'<div class="music-skeleton-row"><i></i><b></b><b></b></div>'.repeat(6)}</div>`;
      currentRows = [];
      return;
    }
    const stored = new Set(data.entries.map((x) => x.uri));
    currentRows = base.filter(
      (e) =>
        (selectedPlaylist ||
          filter === "downloaded" ||
          filter === "all" ||
          (filter === "favorites"
            ? e.favorite
            : String(e.collection) === String(filter) ||
              data.collections
                .find((c) => String(c.id) === String(filter))
                ?.uris?.includes(e.uri))) &&
        normalized(
          e.title + " " + (e.artists || e.local?.artists || ""),
        ).includes(wanted),
    );
    if (localCollection)
      currentRows.sort(
        (a, b) =>
          localCollection.uris.indexOf(a.uri) -
          localCollection.uris.indexOf(b.uri),
      );
    let html = "";
    if (home) {
      const tiles = [
        tileHTML("downloaded"),
        ...playlists.map((e) => tileHTML("playlist", e)),
        ...data.collections.map((c) => tileHTML("collection", c)),
      ];
      const shown = tiles.slice(0, 6).join("");
      html += `<section class="music-shelf"><div class="music-shelf-head"><h3>Playlists e coleções</h3>${tiles.length > 6 ? `<button data-filter="playlists">Ver todas (${tiles.length})</button>` : ""}</div><div class="music-album-grid">${shown}</div></section>`;
    }
    const rows = currentRows
      .map((e, i) => rowHTML(e, i, busy, stored))
      .join("");
    if (currentRows.length)
      html += home
        ? `<section class="music-songs"><div class="music-shelf-head"><h3>Músicas</h3><small>${currentRows.length} faixas</small></div>${listHeading}<div class="music-rows">${rows}</div></section>`
        : rows;
    else
      html += wanted
        ? stateBlock(
            "search",
            "Nada encontrado",
            `Nenhuma música desta lista corresponde a “${query}”.`,
            '<button class="music-secondary" data-action="clear_filter">Limpar filtro</button>',
          )
        : stateBlock(
            filter === "favorites" ? "heart" : "music",
            filter === "favorites"
              ? "Nenhuma música curtida ainda"
              : filter === "downloaded"
                ? "Nenhuma música baixada"
                : "Nenhuma música aqui ainda",
            filter === "favorites"
              ? "Use o coração de uma faixa da biblioteca para curtir."
              : "Adicione uma música para baixar e ouvir.",
            '<button class="music-green" data-action="add">Adicionar link</button>',
          );
    library.innerHTML = html;
    watchCovers();
  }

  let downloadRequestPending = false,
    visualFrame = 0,
    observedAt = 0,
    observedPosition = 0;

  const seekBar = $(".music-seek"),
    elapsedLabel = $(".music-position");
  let draggingSeek = false,
    pendingSeek = 0,
    framePaintedAt = 0;
  function paintSeek(position) {
    const max = Number(seekBar.max) || 1;
    const ms = Math.max(0, Math.min(max, position || 0));
    seekBar.value = String(ms);
    seekBar.style.setProperty(
      "--range-fill",
      ((100 * ms) / max).toFixed(2) + "%",
    );
    $(".music-stage-seek").value = String(ms);
    $(".music-stage-seek").style.setProperty(
      "--range-fill",
      ((100 * ms) / max).toFixed(2) + "%",
    );
    $(".music-stage-seek").setAttribute(
      "aria-valuetext",
      time(ms) + " de " + time(visiblePlayer().duration_ms),
    );
    $(".music-stage-position").textContent = time(ms);
    for (const input of [seekBar, $(".music-stage-seek")]) {
      if (input.parentElement.classList.contains("music-scrubber")) {
        input.parentElement.style.setProperty(
          "--range-fill",
          ((100 * ms) / max).toFixed(2) + "%",
        );
        input.parentElement.querySelector("output").textContent = time(ms);
      }
    }
    const label = time(ms);
    if (
      elapsedLabel.textContent !== label ||
      !seekBar.hasAttribute("aria-valuetext")
    ) {
      elapsedLabel.textContent = label;
    }
    const spoken = label + " de " + time(visiblePlayer().duration_ms);
    if (seekBar.getAttribute("aria-valuetext") !== spoken)
      seekBar.setAttribute("aria-valuetext", spoken);
  }
  function smoothProgress(now) {
    visualFrame = 0;
    if (
      disposed ||
      musicLayout.config.motion === false ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      visiblePlayer().state !== "playing" ||
      !element.getClientRects().length
    )
      return;
    if (!draggingSeek && !pendingSeek && now - framePaintedAt >= 100) {
      paintSeek(observedPosition + now - observedAt);
      framePaintedAt = now;
    }
    visualFrame = requestAnimationFrame(smoothProgress);
  }

  function decorateSlider(input, format) {
    if (input.parentElement.classList.contains("music-scrubber")) return;
    const wrap = document.createElement("span");
    wrap.className =
      "music-scrubber" +
      (input.matches("[data-settings-volume],.music-volume-slider")
        ? " is-volume"
        : "");
    input.before(wrap);
    wrap.append(input);
    const rail = document.createElement("span");
    rail.className = "music-range-track";
    rail.setAttribute("aria-hidden", "true");
    rail.innerHTML =
      '<i class="music-range-fill"></i><i class="music-range-thumb"></i>';
    wrap.append(rail);
    const value = document.createElement("output");
    value.className = "music-scrub-value";
    value.setAttribute("aria-hidden", "true");
    wrap.append(value);
    const paint = () => {
      const min = Number(input.min) || 0,
        max = Number(input.max) || 100;
      wrap.style.setProperty(
        "--range-fill",
        ((Number(input.value) - min) / (max - min)) * 100 + "%",
      );
      if (format) {
        value.textContent = format(Number(input.value));
        input.setAttribute("aria-valuetext", value.textContent);
      } else
        value.textContent = wrap.classList.contains("is-volume")
          ? input.value + "%"
          : time(Number(input.value));
    };
    input.addEventListener("input", paint);
    paint();
  }
  function bindSeek(input) {
    decorateSlider(input);
    input.step = "100";
    const end = () => {
      draggingSeek = false;
      input.classList.remove("is-scrubbing");
    };
    input.onpointerdown = () => {
      draggingSeek = true;
      input.classList.add("is-scrubbing");
    };
    input.oninput = () => paintSeek(Number(input.value));
    input.onpointerup = input.onpointercancel = input.onblur = end;
    input.onchange = async () => {
      const position = Number(input.value);
      end();
      pendingSeek++;
      try {
        await invoke("seek", { position_ms: position });
      } finally {
        if (!--pendingSeek && !draggingSeek)
          paintSeek(data.player?.position_ms);
      }
    };
  }
  bindSeek($(".music-stage-seek"));
  decorateSlider($("[data-stage-volume]"));
  $("[data-stage-volume]").oninput = (event) => setVolume(event.target.value);
  $("[data-stage-volume]").onchange = (event) =>
    setVolume(event.target.value, true);
  function renderPlayer() {
    observedAt = performance.now();
    const remote = cloudOutput.remote();
    observedPosition = visiblePlayer().position_ms || 0;
    if (
      visiblePlayer().state === "playing" &&
      !visualFrame &&
      element.getClientRects().length &&
      musicLayout.config.motion !== false &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      visualFrame = requestAnimationFrame(smoothProgress);
    if (visiblePlayer().state !== "playing" && visualFrame) {
      cancelAnimationFrame(visualFrame);
      visualFrame = 0;
    }
    markPlaying();
    const player = visiblePlayer(),
      track = visibleTrack(),
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
          (remote ? track?.artwork : "") ||
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

    $(".music-stage h2").textContent =
      track?.title || "Nenhuma música selecionada";
    $(".music-stage-artist").textContent = track?.artists || "Sua biblioteca";
    const stageArt = $(".music-now-art").dataset.cover || "";
    const stage = $(".music-stage-cover");
    if (stage.dataset.cover !== stageArt) {
      stage.dataset.cover = stageArt;
      stage.innerHTML = stageArt
        ? `<img src="${esc(stageArt)}" alt="">`
        : svg("music");
      $(".music-stage-background").src = stageArt;
    }
    $(".music-stage-play").innerHTML = svg(playing ? "pause" : "play");
    $(".music-stage-play").disabled = !track?.available;
    $(".music-stage-seek").max = String(Math.max(1, player.duration_ms || 1));
    $(".music-stage-duration").textContent = time(player.duration_ms);
    $(".music-stage-play").setAttribute(
      "aria-label",
      playing ? "Pausar" : "Reproduzir",
    );
    for (const action of ["shuffle", "repeat"]) {
      for (const control of element.querySelectorAll(
        `[data-action=${action}]`,
      )) {
        control.disabled = !!remote;
        control.setAttribute(
          "aria-pressed",
          String(
            action === "shuffle"
              ? playback.shuffled
              : playback.repeat !== "off",
          ),
        );
        if (action === "repeat") {
          control.dataset.mode = playback.repeat;
          control.setAttribute(
            "aria-label",
            playback.repeat === "one"
              ? "Repetir faixa"
              : playback.repeat === "all"
                ? "Repetir fila"
                : "Ativar repetição",
          );
        }
      }
    }
    element.classList.toggle("music-is-playing", playing);
    $(".music-play").innerHTML = svg(playing ? "pause" : "play");
    $(".music-play").setAttribute(
      "aria-label",
      playing ? "Pausar" : "Reproduzir",
    );
    $(".music-play").disabled = remote
      ? !track
      : !data.local_tracks.some((t) => t.available);
    for (const action of ["previous", "next"])
      $(`[data-action=${action}]`).disabled = remote
        ? !track
        : !data.local_tracks.some((t) => t.available);

    $(".music-duration").textContent = time(player.duration_ms);
    seekBar.disabled = !track || !player.duration_ms;
    seekBar.max = String(Math.max(1, player.duration_ms || 1));
    if (!draggingSeek && !pendingSeek) paintSeek(player.position_ms);
    if (pendingVolume === null && !volumeSending)
      paintVolume(player.volume ?? 80);
    for (const input of element.querySelectorAll(
      ".music-volume-slider,[data-stage-volume]",
    ))
      input.disabled = remote?.kind === "web";
    $('[data-action="mute"]').disabled = remote?.kind === "web";
    saveSessionSoon();

    for (const label of element.querySelectorAll(".music-output-label"))
      label.textContent = "Saída: " + (remote?.name || "este PC");
    $(".music-device-toggle").classList.toggle("remote-output", !!remote);
    if (remote) {
      const ids = remote.player.queue || [];
      const key = JSON.stringify([remote.device_id, ids, data.entries]);
      if (!queueSort.dragging && $(".music-next").dataset.signature !== key) {
        $(".music-next").dataset.signature = key;
        $(".music-next").innerHTML =
          ids
            .map((id, index) => {
              const entry = data.entries.find(
                (e) => e.uri === "spotify:track:" + id,
              );
              return (
                '<article class="music-queue-row" data-sort-key="' +
                index +
                '"><button data-action="remote_queue_play" data-index="' +
                index +
                '"><span>' +
                (entry?.thumbnail
                  ? '<img src="' + esc(entry.thumbnail) + '" alt="">'
                  : svg("music")) +
                "</span><div><strong>" +
                esc(entry?.title || "Música da fila") +
                "</strong><small>" +
                esc(entry?.artists || "") +
                '</small></div></button><button data-sort-handle aria-label="Reordenar faixa">' +
                svg("grip") +
                "</button></article>"
              );
            })
            .join("") || "<small>A fila está vazia.</small>";
        $(".music-next-title").textContent = "A seguir · " + ids.length;
      }
      return;
    }
    // queue list
    const queueSignature = JSON.stringify([
      data.local_tracks,
      player.track_id,
      data.artwork,
      queueIds,
    ]);
    if (
      !queueSort.dragging &&
      $(".music-next").dataset.signature !== queueSignature
    ) {
      $(".music-next").dataset.signature = queueSignature;
      const upcoming = playback.upcoming();
      $(".music-next").innerHTML =
        upcoming
          .map((id, index) => {
            const t = data.local_tracks.find((t) => t.id === id);
            if (!t?.available) return "";
            const at = playback.position + index + 1;
            const art =
              data.artwork?.[
                t.track_uri || queueMeta.get(t.id)?.uri || t.source_uri
              ] ||
              t.artwork ||
              "";
            return (
              '<article class="music-queue-row" data-sort-key="' +
              at +
              '" data-queue-index="' +
              at +
              '"><button data-action="queue_play" data-index="' +
              at +
              '" aria-label="Reproduzir ' +
              esc(t.title) +
              '"><span>' +
              (art
                ? '<img src="' + esc(art) + '" alt="" loading="lazy">'
                : svg("music")) +
              "</span><div><strong>" +
              esc(t.title) +
              "</strong><small>" +
              esc(t.artists || "Música baixada") +
              '</small></div></button><div class="music-queue-actions"><button class="sort-handle" data-sort-handle aria-label="Reordenar ' +
              esc(t.title) +
              '">' +
              svg("grip") +
              '</button><button data-action="queue_remove" data-index="' +
              at +
              '" aria-label="Remover da fila">' +
              svg("close") +
              "</button></div></article>"
            );
          })
          .join("") || "<small>A fila está vazia.</small>";
      $(".music-next-title").textContent = "A seguir · " + upcoming.length;
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
      if (musicTools.beforeAdvance()) step(1, true);
    }
  }

  let downloadExpanded = false,
    downloadDismissed = "",
    islandJob = "",
    islandItem = null;
  const island = $(".music-download");
  island.innerHTML = `<button type="button" class="music-download-toggle" data-action="download_panel" aria-expanded="false" aria-controls="music-island-detail">
    <span class="music-island-art"></span><span class="music-island-copy"><strong></strong><small></small></span>
    <span class="music-island-meter" aria-hidden="true"><svg viewBox="0 0 32 32"><circle class="meter-track" cx="16" cy="16" r="13"/><circle class="meter-value" cx="16" cy="16" r="13" pathLength="100"/></svg><span></span></span></button>
    <div id="music-island-detail" class="music-island-fold" inert><div><div class="music-island-detail"><div class="music-island-meta"><strong></strong><time></time></div><p></p><div class="music-island-actions"><button data-action="play_local">${svg("play")}Ouvir</button><button class="music-island-end"></button></div></div></div></div>
    <span class="sr-only" role="status" aria-live="polite"></span>`;
  function renderDownload() {
    const d = data.download || {},
      active = d.state === "running",
      finished = d.state === "completed";
    const key = String(d.job_id || d.uri || d.url || "");
    island.hidden =
      (!active && !["failed", "cancelled", "completed"].includes(d.state)) ||
      (downloadDismissed === key && !active);
    if (island.hidden) return;
    if (key !== islandJob) {
      islandJob = key;
      islandItem = null;
      downloadExpanded = false;
      downloadDismissed = "";
    }
    const item =
      data.entries.find((e) => e.uri === d.uri || e.url === d.url) ||
      (d.uri &&
        (data.playlist?.tracks?.find((t) => t.uri === d.uri) ||
          data.search?.items?.find((t) => t.uri === d.uri)));
    if (item) islandItem = item;
    const done = Number(d.completed_tracks) || 0,
      total = Number(d.total_tracks) || 0;
    const group =
      ["playlist", "album"].includes(d.kind || islandItem?.kind) || total > 1;
    const e = d.event || {},
      bytes = e.event === "transfer" ? Number(e.received) || 0 : 0;
    const percent = finished
      ? 100
      : bytes && Number(e.total) > 0
        ? Math.min(99, Math.floor((100 * bytes) / e.total))
        : group && total && done
          ? Math.min(99, Math.floor((100 * done) / total))
          : null;
    const ready = data.local_tracks.find(
      (t) => t.id === d.ready_track_id && t.available,
    );
    const title =
      islandItem?.title ||
      (!group && ready?.title) ||
      (group ? "Download da playlist" : "Download da faixa");
    let status = {
      failed: "Falha no download",
      cancelled: "Download cancelado",
      completed: d.cached ? "Já na biblioteca" : "Download concluído",
    }[d.state];
    if (active) {
      status = e.event ? "Obtendo áudio…" : "Preparando download…";
      if (bytes)
        status =
          percent === null
            ? "Transferindo áudio"
            : `Transferindo · ${percent}%`;
      if (ready) status = "Pronta para ouvir";
      if (group && total)
        status = `${done} de ${total} ${total === 1 ? "faixa" : "faixas"}`;
    }
    const art =
      data.artwork?.[d.uri] ||
      islandItem?.thumbnail ||
      (!group && ready?.artwork) ||
      "";
    const artwork = $(".music-island-art");
    if (artwork.dataset.art !== art) {
      artwork.dataset.art = art;
      artwork.innerHTML = art
        ? `<img src="${esc(art)}" alt="" referrerpolicy="no-referrer">`
        : svg(group ? "library" : "music");
    }
    $(".music-island-copy strong").textContent = title;
    $(".music-island-copy small").textContent = status;
    island.classList.toggle("is-expanded", downloadExpanded);
    island.dataset.state = d.state;
    const toggle = $(".music-download-toggle");
    toggle.setAttribute("aria-expanded", String(downloadExpanded));
    const meter = $(".music-island-meter");
    meter.classList.toggle("indeterminate", active && percent === null);
    meter.style.setProperty(
      "--remaining",
      String(100 - (percent ?? (active ? 26 : 0))),
    );
    const symbol = finished ? "check" : active ? "download" : "close";
    const badge = $(".music-island-meter span");
    if (badge.dataset.iconName !== symbol) {
      badge.innerHTML = svg(symbol === "download" ? "transfer" : symbol);
      badge.dataset.iconName = symbol;
    }
    $(".music-island-fold").inert = !downloadExpanded;
    $(".music-island-meta strong").textContent =
      group && d.last_track?.title
        ? "Última faixa salva"
        : islandItem?.artists || (group ? "Playlist" : "Faixa");
    $(".music-island-meta time").textContent =
      active && d.elapsed_s ? time(d.elapsed_s * 1000) : "";
    let detail = e.event
      ? "Aguardando o arquivo de áudio"
      : "Iniciando o download";
    if (bytes)
      detail =
        (bytes / 1048576).toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
        }) + " MB recebidos";
    if (finished || ready) detail = "Disponível na biblioteca";
    if (group && d.last_track?.title) detail = d.last_track.title;
    if (d.state === "cancelled")
      detail = done
        ? "As faixas concluídas estão na biblioteca."
        : "Transferência encerrada.";
    if (d.state === "failed")
      detail =
        d.error ||
        (e.failed > 1
          ? `${e.failed} faixas com falha. Tente novamente.`
          : "Tente baixar novamente pela biblioteca.");
    $(".music-island-detail p").textContent = detail;
    const listen = $(".music-island-actions [data-action=play_local]");
    listen.hidden = !ready;
    if (ready) {
      listen.dataset.id = ready.id;
      listen.dataset.uri = ready.track_uri || (!group ? d.uri || "" : "");
      listen.dataset.art =
        ready.artwork || data.artwork?.[listen.dataset.uri] || "";
    }
    const end = $(".music-island-end");
    end.dataset.action = active ? "cancel_download" : "dismiss_download";
    end.textContent = active ? "Cancelar download" : "Fechar";
    const announce = $(".music-download [role=status]"),
      message = title + " · " + status;
    if (announce.textContent !== message) announce.textContent = message;
  }

  window.attachMusicHold(element, {
    selector: ".spotify-item,.music-next article",
    sorter: (row) =>
      row.dataset.sortKey !== undefined
        ? row.closest(".music-next")
          ? queueSort
          : librarySort
        : null,
    menu: (row, event) => {
      const button = row.querySelector('[data-action="track_menu"]');
      if (button)
        musicTools.showMenu(
          currentRows[Number(button.dataset.row)],
          event.clientX,
          event.clientY,
        );
      else {
        const track = data.local_tracks.find(
          (t) => t.id === playback.order[Number(row.dataset.sortKey)],
        );
        if (track)
          musicTools.showMenu(
            {
              local: track,
              uri: track.track_uri,
              title: track.title,
              artists: track.artists,
              thumbnail: track.artwork,
            },
            event.clientX,
            event.clientY,
          );
      }
    },
  });
  async function playQueued(id) {
    if (id == null) return;
    const meta = queueMeta.get(id);
    queueIds = [...playback.order];
    syncCloudQueue();
    autoStarting = true;
    try {
      await invoke("play_local", {
        id,
        track_uri: meta?.uri,
        artwork: data.artwork?.[meta?.uri] || meta?.artwork || "",
      });
    } finally {
      autoStarting = false;
      renderPlayer();
    }
  }

  async function step(direction, automatic = false) {
    if (
      !cloudApplying &&
      !automatic &&
      (await cloudOutput.command(direction > 0 ? "next" : "previous"))
    )
      return;
    if (automatic && playback.repeat === "one")
      return playQueued(playback.current());
    if (direction < 0 && data.player?.position_ms > 3000)
      return invoke("seek", { position_ms: 0 });
    if (direction > 0 && cloudQueue?.length) {
      const id = cloudQueue.shift();
      return receiveCloudPlayer({
        ...cloudPlayer(),
        track_id: id,
        position_ms: 0,
        state: "playing",
        queue: [...cloudQueue],
      });
    }
    if (!data.local_tracks.some((t) => t.available)) return;
    if (!playback.order.length)
      playback.start(
        data.local_tracks.filter((t) => t.available).map((t) => t.id),
        data.player?.track_id || data.local_tracks.find((t) => t.available)?.id,
      );
    return playQueued(
      direction > 0 ? playback.next(automatic) : playback.previous(),
    );
  }

  /* ── Click delegation ───────────────────────────────────────────────── */
  element.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (await musicTools.handle(button, event)) return;
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
    if (button.dataset.action === "stage_open") {
      $(".music-stage").hidden = false;
      for (const child of element.children)
        if (!child.classList.contains("music-stage")) child.inert = true;
      $(".music-stage-close").focus();
      return;
    }
    if (button.dataset.action === "stage_close") {
      $(".music-stage").hidden = true;
      for (const child of element.children) child.inert = false;
      $(".music-track-open").focus();
      return;
    }
    const action = button.dataset.action,
      uri = button.dataset.uri;
    if (action === "clear_filter") {
      query = "";
      $(".music-library-search").value = "";
      renderLibrary();
      return;
    }
    if (action === "play_view") {
      element.querySelector(".music-row-play:not(:disabled)")?.click();
      return;
    }
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
      renderRemoteSettings();
      return;
    }
    if (action === "dismiss_download") {
      downloadDismissed = islandJob;
      renderDownload();
      $(".spotify-search").focus();
      renderRemoteSettings();
      return;
    }
    if (action === "play_view") {
      const available = currentRows.filter((row) => row.local?.available);
      if (available.length) {
        queueMeta.clear();
        available.forEach((row) =>
          queueMeta.set(row.local.id, { uri: row.uri, artwork: row.thumbnail }),
        );
        playback.start(
          available.map((row) => row.local.id),
          available[0].local.id,
        );
        return playQueued(available[0].local.id);
      }
      return;
    }
    if (action === "edit_playlist") {
      editPlaylistDialog(
        button.dataset.uri
          ? { uri: button.dataset.uri }
          : { id: Number(button.dataset.id) },
      );
      return;
    }
    if (action === "rename_collection" || action === "delete_collection") {
      const id = Number(button.dataset.id),
        collection = data.collections.find((c) => c.id === id);
      if (!collection) return;
      const d = dialog(
        action === "rename_collection"
          ? "Renomear playlist"
          : "Excluir playlist?",
        action === "rename_collection"
          ? '<form><label>Nome<input name="name" required maxlength="60" value="' +
              esc(collection.name) +
              '"></label><button class="music-green">Salvar</button></form>'
          : '<p>A playlist será removida. As músicas baixadas continuam na biblioteca.</p><button class="music-green" data-confirm-playlist>Excluir playlist</button>',
      );
      if (action === "rename_collection")
        d.querySelector("form").onsubmit = async (e) => {
          e.preventDefault();
          if (await invoke(action, { id, name: e.target.elements.name.value }))
            d.close();
        };
      else
        d.querySelector("[data-confirm-playlist]").onclick = async () => {
          if (await invoke(action, { id })) {
            filter = "all";
            d.close();
            renderLibrary();
          }
        };
      return;
    }
    if (action === "add") return addDialog();
    if (action === "collection") return collectionDialog();
    if (action === "move") return moveDialog(uri);
    if (action === "settings") return settingsDialog();
    if (action === "account") return accountDialog();
    if (action === "devices") {
      const d = dialog(
        "Dispositivos",
        '<section class="music-output-picker"></section>',
      );
      const panel = window.createMusicDevices(
        d.querySelector(".music-output-picker"),
        {
          desktop: true,
          picker: true,
          output: cloudOutput,
          getState: () => data.cloud || {},
          localPlayer: cloudPlayer,
          icon: svg,
          notify,
        },
      );
      d.outputPanel = panel;
      panel.render();
      return;
    }
    if (action === "remote_queue_play") {
      const output = cloudOutput.remote(),
        index = Number(button.dataset.index);
      const id = output?.player.queue?.[index];
      if (!id) return;
      const e = data.entries.find((e) => e.uri === "spotify:track:" + id);
      return cloudOutput.play(
        {
          id,
          title: e?.title || "Música da fila",
          artist: e?.artists,
          art: e?.thumbnail,
        },
        output.player.queue.slice(index + 1),
      );
    }

    if (action === "search") return $(".spotify-search").focus();
    if (action === "queue") {
      musicLayout.toggleQueue();
      const queue = $(".music-queue");
      if (
        !element.classList.contains("queue-hidden") &&
        musicLayout.config.motion !== false &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        queue.animate(
          [
            { opacity: 0, transform: "translateX(10px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 200, easing: "cubic-bezier(.16,1,.3,1)" },
        );
      return;
    }
    if (action === "shuffle" || action === "repeat") {
      if (action === "shuffle") playback.setShuffle(!playback.shuffled);
      else
        playback.repeat = { off: "all", all: "one", one: "off" }[
          playback.repeat
        ];
      queueIds = [...playback.order];
      if (action === "shuffle") syncCloudQueue();
      button.setAttribute(
        "aria-pressed",
        String(
          action === "shuffle" ? playback.shuffled : playback.repeat !== "off",
        ),
      );
      if (action === "repeat") {
        button.dataset.mode = playback.repeat;
        button.setAttribute(
          "aria-label",
          playback.repeat === "one"
            ? "Repetir faixa"
            : playback.repeat === "all"
              ? "Repetir fila"
              : "Ativar repetição",
        );
      }
      renderPlayer();
      return;
    }
    if (action === "queue_play")
      return playQueued(playback.selectAt(Number(button.dataset.index)));
    if (action === "queue_remove" || action === "queue_up") {
      const index = Number(button.dataset.index);
      const removed = data.local_tracks
        .find((t) => t.id === playback.order[index])
        ?.track_uri?.split(":")
        .at(-1);
      if (action === "queue_remove") playback.removeAt(index);
      else playback.move(index, index - 1);
      queueIds = [...playback.order];
      syncCloudQueue(action === "queue_remove" ? removed : null);
      renderPlayer();
      return;
    }
    if (action === "next" || action === "previous")
      return step(action === "next" ? 1 : -1);
    if (action === "mute") {
      const current = Number($(".music-volume-slider").value);
      if (current > 0) {
        lastAudibleVolume = current;
        setVolume(0, true);
      } else setVolume(lastAudibleVolume || 50, true);
      return;
    }
    if (action === "play") {
      if (cloudOutput.remote())
        return cloudOutput.command(
          visiblePlayer().state === "playing" ? "pause" : "resume",
        );
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
      if (track) {
        playback.start(
          data.local_tracks.filter((t) => t.available).map((t) => t.id),
          track.id,
        );
        queueIds = [...playback.order];
        return invoke("play_local", { id: track.id });
      }
      return;
    }
    if (action === "play_local") {
      if (cloudOutput.remote() && uri?.startsWith("spotify:track:")) {
        const row = currentRows.find((e) => e.uri === uri);
        const ids = currentRows
          .map((e) => e.uri?.split(":").at(-1))
          .filter((id) => id?.length === 22);
        return cloudOutput.play(
          {
            id: uri.split(":").at(-1),
            title: row?.title || "Música",
            artist: row?.artists || row?.local?.artists,
            art: row?.thumbnail || row?.local?.artwork,
          },
          ids.slice(ids.indexOf(uri.split(":").at(-1)) + 1),
        );
      }

      cloudQueue = null;
      pendingCloudPlayer = null;
      if (currentRows.some((e) => e.local?.id === Number(button.dataset.id))) {
        queueIds = currentRows
          .filter((e) => e.local?.available)
          .map((e) => e.local.id);
        queueMeta.clear();
        for (const row of currentRows.filter((e) => e.local?.available))
          queueMeta.set(row.local.id, { uri: row.uri, artwork: row.thumbnail });
      }
      playback.start(
        queueIds.length
          ? queueIds
          : data.local_tracks.filter((t) => t.available).map((t) => t.id),
        Number(button.dataset.id),
      );
      queueIds = [...playback.order];
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
          playback.prune(
            new Set(
              data.local_tracks.filter((t) => t.available).map((t) => t.id),
            ),
          );
          queueIds = [...playback.order];
          queueMeta.delete(id);
          d.close();
        } else event.target.disabled = false;
      };
      return;
    }
    if (action === "remove") {
      const d = dialog(
        "Remover link da biblioteca?",
        '<p>A referência será removida da biblioteca. Os arquivos baixados continuam no computador.</p><div class="music-dialog-actions"><button data-dismiss autofocus>Cancelar</button><button data-confirm-remove class="music-danger">Remover link</button></div>',
      );
      d.querySelector("[data-dismiss]").onclick = () => d.close();
      d.querySelector("[data-confirm-remove]").onclick = async (event) => {
        event.target.disabled = true;
        if (await invoke("remove", { uri })) d.close();
        else event.target.disabled = false;
      };
      return;
    }
    if (action === "favorite") return invoke(action, { uri });
    if (action === "cancel_download") return invoke(action);
  });

  $(".music-library-search").oninput = (event) => {
    query = event.target.value;
    renderLibrary();
  };
  bindSeek(seekBar);
  decorateSlider($(".music-volume-slider"));
  bindVolume($(".music-volume-slider"));

  /* ── State update (merge delta) ─────────────────────────────────────── */
  function update(result) {
    if (
      disposed ||
      !result ||
      (!Array.isArray(result.entries) && !result.player && !result.artwork)
    )
      return;
    const libraryChanged =
      result.search !== undefined ||
      result.artwork !== undefined ||
      result.playlist !== undefined ||
      Array.isArray(result.entries) ||
      Array.isArray(result.local_tracks) ||
      result.download?.state !== data.download?.state;
    data = { ...data, ...result };
    data.local_tracks ||= [];
    if (!sessionLoaded && result.session) {
      sessionLoaded = true;
      const saved = result.session;
      playback.restore(
        saved,
        new Set(data.local_tracks.filter((t) => t.available).map((t) => t.id)),
      );
      if (typeof saved.filter === "string") filter = saved.filter;
      selectedPlaylist = data.entries.some((e) => e.uri === saved.playlist)
        ? saved.playlist
        : null;
      sessionSignature = JSON.stringify({
        ...playback.snapshot(),
        filter,
        playlist: selectedPlaylist,
      });
      for (const action of ["shuffle", "repeat"])
        $(`[data-action=${action}]`).setAttribute(
          "aria-pressed",
          String(
            action === "shuffle"
              ? playback.shuffled
              : playback.repeat !== "off",
          ),
        );
      $(`[data-action=repeat]`).dataset.mode = playback.repeat;
      if (selectedPlaylist)
        request("open_playlist", { uri: selectedPlaylist })
          .then(update)
          .catch(() => {});
    }
    playback.prune(
      new Set(data.local_tracks.filter((t) => t.available).map((t) => t.id)),
    );
    queueIds = [...playback.order];
    if (libraryChanged) renderLibrary();
    renderPlayer();
    renderDownload();
    renderRemoteSettings();
    void processCloud();
  }

  /* ── Polling loop ───────────────────────────────────────────────────── */
  const timer = setInterval(async () => {
    musicTools.tick();
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
  }, 400);

  renderLibrary();
  renderPlayer();
  renderDownload();

  return {
    element,
    update,
    async remote(action, params = {}) {
      if (disposed || !isOpen()) return;
      cloudApplying++;
      try {
        if (action === "toggle") {
          if (data.player?.state === "playing") return await invoke("pause");
          if (data.player?.state === "paused") return await invoke("resume");
          const track = data.local_tracks.find((t) => t.available);
          if (track) return await playQueued(track.id);
          return;
        }
        if (action === "next" || action === "previous")
          return await step(action === "next" ? 1 : -1);
        if (["pause", "resume"].includes(action)) return await invoke(action);
        if (
          action === "volume" &&
          Number.isInteger(params.value) &&
          params.value >= 0 &&
          params.value <= 100
        )
          return await setVolume(params.value, true);
        if (
          action === "seek" &&
          Number.isInteger(params.position_ms) &&
          params.position_ms >= 0
        )
          return await invoke("seek", {
            position_ms: Math.min(
              params.position_ms,
              data.player?.duration_ms || 0,
            ),
          });
      } finally {
        cloudApplying--;
      }
    },
    load: () => invoke("list"),
    dispose: () => {
      flushSession();
      flushVolume();
      librarySort.cancel();
      queueSort.cancel();
      disposed = true;
      clearTimeout(volumeTimer);
      musicLayout.dispose();
      element.removeEventListener("music-layout", syncQueueToggle);
      musicTools.dispose();
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
