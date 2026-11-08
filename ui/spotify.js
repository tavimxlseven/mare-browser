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
  element.innerHTML = `<aside class="music-library music-panel"><header><strong>${svg("music")} Música</strong><button data-action="collection" aria-label="Criar playlist">${svg("plus")}</button></header><nav class="music-filters" aria-label="Biblioteca de música"><button data-filter="all">${svg("library")} Biblioteca</button><button data-filter="playlists">${svg("folder")} Playlists e álbuns</button><button data-filter="downloaded">${svg("download")} Baixadas</button></nav><div class="music-library-tools"><button data-action="search" aria-label="Pesquisar na biblioteca">${svg("search")}</button><span>Playlists</span></div><button class="music-liked" data-filter="favorites"><span>${svg("heart")}</span><div><strong>Músicas curtidas</strong><small>Curtidas locais</small></div></button><input class="music-library-search" type="search" placeholder="Filtrar biblioteca" aria-label="Filtrar sua biblioteca"><div class="music-collections"></div><div class="music-library-footer"><button data-action="settings">${svg("settings")} Ajustes de música</button></div></aside>
  <section class="music-main music-panel"><header class="music-toolbar"><label>${svg("search")}<input class="spotify-search" type="search" placeholder="Pesquisar na sua biblioteca" aria-label="Pesquisar na biblioteca"></label><button class="music-account" data-action="account" hidden>Conectar conta</button><button data-action="settings" aria-label="Configurações de música">${svg("settings")}</button></header><div class="music-scroll"><div class="music-heading"><div><small class="music-section-label">Sua música</small><h2>Sua biblioteca</h2><p class="music-subtitle">Seus links e músicas baixadas, em um só lugar.</p></div><button class="music-add" data-action="add">${svg("plus")} Adicionar link</button></div><div class="music-list-heading"><span>#</span><span>Título</span><span>Origem</span><span></span></div><div class="spotify-library"></div></div><div class="music-download" hidden></div></section>
  <aside class="music-queue music-panel"><header><div class="music-queue-tabs" role="tablist"><button data-action="queue_list" role="tab" aria-selected="true">Fila</button><button data-action="queue_details" role="tab" aria-selected="false">Tocando agora</button></div><button data-action="queue" aria-label="Fechar fila">${svg("close")}</button></header><h3>Tocando agora</h3><div class="music-now"><div class="music-now-art">${svg("music")}</div><strong>Nada tocando</strong><small>Escolha uma faixa baixada.</small></div><h3>A seguir</h3><div class="music-next"></div><p class="music-queue-note">A música continua ao trocar de aba. Feche a aba do app para encerrar a reprodução.</p></aside>
  <footer class="spotify-player"><div class="music-track"><div class="music-track-art">${svg("music")}</div><div><strong>Nenhuma faixa selecionada</strong><small>Escolha uma música baixada</small></div></div><div class="music-transport"><div><button data-action="shuffle" aria-label="Reprodução aleatória" aria-pressed="false">${svg("shuffle")}</button><button data-action="previous" aria-label="Faixa anterior">${svg("previous")}</button><button class="music-play" data-action="play" aria-label="Reproduzir">${svg("play")}</button><button data-action="next" aria-label="Próxima faixa">${svg("next")}</button><button data-action="repeat" aria-label="Repetir fila" aria-pressed="false">${svg("repeat")}</button></div><label class="music-timeline"><span class="music-position">0:00</span><input type="range" min="0" max="1" value="0" step="1000" class="music-seek" aria-label="Posição da música"><span class="music-duration">0:00</span></label></div><div class="music-volume"><button data-action="sleep_timer" aria-label="Temporizador">${svg("clock")}</button><button data-action="queue" aria-label="Mostrar fila">${svg("queue")}</button><button data-action="mute" aria-label="Silenciar" aria-pressed="false">${svg("volume")}</button><input type="range" min="0" max="100" step="1" value="80" class="music-volume-slider" aria-label="Volume"><output class="music-volume-value">80%</output></div></footer>`;

  const playback = new window.MareMusicQueue();
  element.insertAdjacentHTML(
    "beforeend",
    `<section class="music-stage" hidden aria-label="Tocando agora"><img class="music-stage-background" alt=""><button data-action="stage_close" class="music-stage-close" aria-label="Voltar à biblioteca">${svg("back")}</button><div class="music-stage-body"><div class="music-stage-cover">${svg("music")}</div><div class="music-stage-copy"><p>Maré Música</p><h2>Nenhuma música selecionada</h2><p class="music-stage-artist">Sua biblioteca</p><label class="music-stage-timeline"><input class="music-stage-seek" type="range" min="0" max="1" value="0" aria-label="Posição da música"><span class="music-stage-position">0:00</span><span class="music-stage-duration">0:00</span></label><div class="music-stage-controls"><button data-action="shuffle" aria-label="Aleatório">${svg("shuffle")}</button><button data-action="previous" aria-label="Anterior">${svg("previous")}</button><button data-action="play" class="music-stage-play" aria-label="Reproduzir">${svg("play")}</button><button data-action="next" aria-label="Próxima">${svg("next")}</button><button data-action="repeat" aria-label="Repetir">${svg("repeat")}</button></div><div class="music-stage-volume">${svg("volume")}<input data-stage-volume data-settings-volume type="range" min="0" max="100" value="80" aria-label="Volume"></div></div></div></section>`,
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
    currentCollection: () =>
      data.collections.find((c) => String(c.id) === String(filter))?.id,
    queueChanged: (row) => {
      if (row?.local)
        queueMeta.set(row.local.id, { uri: row.uri, artwork: row.thumbnail });
      queueIds = [...playback.order];
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
      `<div class="music-settings-shell"><nav class="music-settings-nav" aria-label="Seções dos ajustes"><button data-settings-tab="appearance" aria-current="page">${svg("settings")} Aparência</button><button data-settings-tab="wallpaper">${svg("image")} Fundo</button><button data-settings-tab="playback">${svg("volume")} Reprodução</button><button data-settings-tab="integrations">${svg("share")} Conexões</button><button data-settings-tab="downloads">${svg("download")} Downloads</button></nav><div class="music-settings-content"><section data-settings-pane="appearance"><h4>Do seu jeito</h4><p>Cores, tamanhos e espaço para sua biblioteca.</p><div class="music-appearance-options"></div></section><section data-settings-pane="wallpaper" hidden><h4>Seu fundo</h4><p>Uma imagem para deixar a música com a sua cara. O arquivo fica somente neste computador.</p><div class="music-wallpaper-options"></div></section><section data-settings-pane="playback" hidden><h4>Reprodução</h4><p>Sua fila, playlist, posição e volume são salvos neste computador. Ao reabrir, a música aguarda seu play.</p><label class="music-setting-range">Volume <output data-settings-volume-value>${data.player?.volume ?? 80}%</output><input data-settings-volume type="range" min="0" max="100" step="1" value="${data.player?.volume ?? 80}" aria-label="Volume da reprodução"></label><small>Ajuste fino em volumes baixos. Use as setas para mudar 1% ou a roda do mouse sobre o controle.</small><div class="music-session-summary"><strong>Continuar de onde parou</strong><p>A fila é restaurada com a ordem aleatória e o modo de repetição. Faixas removidas do disco são descartadas da fila.</p></div></section><section data-settings-pane="integrations" hidden><h4>Conexões</h4><form class="music-presence"><label class="music-setting-switch"><span>Discord Rich Presence<small>Mostrar a música no seu perfil do Discord desktop.</small></span><input type="checkbox" name="enabled" ${p.enabled ? "checked" : ""}></label><small role="status" data-presence-status>${esc({ disabled: "Desativada", discord_closed: "Abra o Discord no computador", connecting: "Conectando…", ready: "Pronta para compartilhar", active: "Música compartilhada", rejected: "O Discord recusou a atividade" }[p.state] || "Aguardando o Discord")}</small></form><section class="music-remote-settings"></section></section><section data-settings-pane="downloads" hidden><h4>Downloads</h4><p>As músicas ficam na biblioteca deste computador e liberam o play quando o download termina.</p><div class="music-component-status"><span class="music-status-dot"></span>${data.sunnify_available ? "Downloads disponíveis" : "Componente de download ausente"}</div><button class="music-secondary" data-scan>${svg("reload")} Atualizar músicas baixadas</button><small>Os arquivos concluídos são preservados. A busca online depende da disponibilidade do catálogo.</small></section></div></div>`,
    );
    d.classList.add("music-settings-dialog");
    musicTools.configure(d);
    for (const tab of d.querySelectorAll("[data-settings-tab]"))
      tab.onclick = () => {
        for (const b of d.querySelectorAll("[data-settings-tab]"))
          b.setAttribute("aria-current", b === tab ? "page" : "false");
        for (const pane of d.querySelectorAll("[data-settings-pane]"))
          pane.hidden = pane.dataset.settingsPane !== tab.dataset.settingsTab;
      };
    renderRemoteSettings();
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

  function renderRemoteSettings() {
    const section = $(".music-remote-settings");
    if (!section) return;
    const remote = window.mare.getMusicRemote?.() || { enabled: false };
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
      const source = [
        ...base,
        ...extra.filter(
          (entry) => !base.some((track) => track.uri === entry.uri),
        ),
      ];
      return source.map((e) => {
        const local = localFor(e, selectedPlaylist);
        return {
          ...e,
          kind: "track",
          favorite:
            data.entries.find((item) => item.uri === e.uri)?.favorite || false,
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

  /* ── renderLibrary ──────────────────────────────────────────────────── */
  function renderLibrary() {
    saveSessionSoon();
    const busy = downloadRequestPending || data.download?.state === "running";
    const next = JSON.stringify([
      data.artwork,
      data.entries,
      data.collections,
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
    coverObserver?.disconnect();

    const playlists = data.entries.filter((e) =>
      ["playlist", "album"].includes(e.kind),
    );

    // sidebar collections list
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
            `<button data-collection="${c.id}"><span>${svg("folder")}</span><div><strong>${esc(c.name)}</strong><small>Playlist local</small></div></button>`,
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
    const home =
      !selectedPlaylist && ["all", "playlists"].includes(filter) && !query;
    $(".music-list-heading").hidden = home;
    $(".music-heading").classList.toggle(
      "music-playlist-heading",
      !!selectedPlaylist,
    );

    // heading HTML
    $(".music-heading").innerHTML = selectedPlaylist
      ? `<button class="music-cover-back" data-action="library" aria-label="Voltar à biblioteca">${svg("back")}</button><div class="music-playlist-cover">${entry?.thumbnail ? `<img src="${esc(entry.thumbnail)}" alt="">` : svg("music")}</div><div><small>Playlist</small><h2>${esc(entry?.title || p?.name || "Playlist")}</h2><p>${esc(p?.owner || "Sua biblioteca")} ${p?.state === "ready" ? `· ${p.tracks.length} músicas` : ""}</p><div class="music-playlist-controls"><button class="music-green" data-action="download" data-uri="${esc(selectedPlaylist)}" ${busy || p?.state !== "ready" || data.completed_sources?.includes(selectedPlaylist) ? "disabled" : ""}>${svg("download")}${data.completed_sources?.includes(selectedPlaylist) ? "Baixada" : "Baixar playlist"}</button><button data-action="refresh_playlist" aria-label="Atualizar playlist">${svg("reload")}</button></div></div>`
      : `<div><small>Sua música</small><h2>${filter === "favorites" ? "Músicas curtidas" : filter === "downloaded" ? "Músicas baixadas" : data.collections.find((c) => String(c.id) === String(filter))?.name || "Sua biblioteca"}</h2><p>${filter === "downloaded" ? "Suas músicas avulsas, prontas para baixar e ouvir." : "Suas playlists e músicas, em um só lugar."}</p></div><button class="music-add" data-action="add">${svg("plus")} Adicionar link</button>`;

    // local collection heading
    const localCollection = data.collections.find(
      (c) => String(c.id) === String(filter),
    );
    if (localCollection) {
      const members = rowsForView().filter(
        (e) =>
          String(e.collection) === String(filter) ||
          localCollection.uris?.includes(e.uri),
      );
      const cover = members.find((e) => e.thumbnail)?.thumbnail;
      $(".music-heading").classList.add("music-playlist-heading");
      $(".music-heading").innerHTML =
        '<button class="music-cover-back" data-action="library" aria-label="Voltar à biblioteca">' +
        svg("back") +
        '</button><div class="music-playlist-cover">' +
        (cover ? '<img src="' + esc(cover) + '" alt="">' : svg("music")) +
        "</div><div><small>Playlist local</small><h2>" +
        esc(localCollection.name) +
        "</h2><p>" +
        members.length +
        ' músicas na sua biblioteca</p><div class="music-playlist-controls"><button class="music-green" aria-label="Reproduzir playlist" data-action="play_view" ' +
        (members.some((e) => e.local?.available) ? "" : "disabled") +
        ">" +
        svg("play") +
        ' Reproduzir</button><button data-action="rename_collection" data-id="' +
        localCollection.id +
        '" aria-label="Renomear playlist">' +
        svg("edit") +
        '</button><button data-action="delete_collection" data-id="' +
        localCollection.id +
        '" aria-label="Excluir playlist">' +
        svg("trash") +
        "</button></div></div>";
    }

    // play-view button for Spotify playlists
    if (selectedPlaylist) {
      $(".music-playlist-controls").insertAdjacentHTML(
        "afterbegin",
        '<button class="music-green" aria-label="Reproduzir playlist" data-action="play_view" ' +
          (rowsForView().some((e) => e.local?.available) ? "" : "disabled") +
          ">" +
          svg("play") +
          "</button>",
      );
    }

    // home grid
    if (home) {
      $(".spotify-library").innerHTML =
        `<div class="music-album-grid"><button class="music-album-card" data-filter="downloaded"><span class="music-downloads-cover">${svg("download")}</span><strong>Músicas baixadas</strong><small>Suas músicas avulsas</small></button>${playlists.map((e) => `<button class="music-album-card" data-action="open_playlist" data-uri="${esc(e.uri)}"><span>${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy">` : svg("music")}</span><strong>${esc(e.title)}</strong><small>${e.kind === "album" ? "Álbum" : "Playlist"}</small></button>`).join("")}</div>`;
      const grid = $(".music-album-grid");
      grid.insertAdjacentHTML(
        "beforeend",
        data.collections
          .map(
            (c) =>
              '<button class="music-album-card" data-collection="' +
              c.id +
              '"><span>' +
              svg("library") +
              "</span><strong>" +
              esc(c.name) +
              "</strong><small>Playlist local</small></button>",
          )
          .join(""),
      );
      currentRows = [];
      return;
    }

    // playlist loading / error
    if (selectedPlaylist && p?.state !== "ready") {
      $(".spotify-library").innerHTML =
        `<div class="music-empty" role="status"><span>${svg(p?.state === "error" ? "close" : "music")}</span><h3>${p?.state === "error" ? "Não foi possível abrir a playlist" : "Carregando músicas…"}</h3><p>${esc(p?.error || "Buscando as faixas da playlist.")}</p>${p?.state === "error" ? '<button class="music-green" data-action="refresh_playlist">Tentar novamente</button>' : ""}</div>`;
      currentRows = [];
      return;
    }

    // filter rows
    currentRows = rowsForView().filter(
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
        ).includes(normalized(query)),
    );

    // track rows — each track uses its own thumbnail, never the playlist cover
    $(".spotify-library").innerHTML =
      currentRows
        .map((e, i) => {
          const ready = !!e.local?.available;
          // Per-track artwork: for playlist view use data.artwork by track URI (not entry thumbnail)
          const trackArt = selectedPlaylist
            ? data.artwork?.[e.uri] || ""
            : e.thumbnail || e.local?.artwork || "";
          return `<article class="music-row spotify-item ${ready ? "is-downloaded" : ""}" data-artwork-uri="${esc(e.uri || "")}"><button class="music-row-play" data-action="play_local" data-id="${e.local?.id || 0}" data-uri="${esc(e.uri || "")}" data-art="${esc(trackArt)}" ${ready ? "" : "disabled"} aria-label="${ready ? "Reproduzir" : "Baixe para reproduzir"} ${esc(e.title)}">${ready ? svg("play") : `<span>${i + 1}</span>`}</button><div class="music-row-title"><span class="spotify-art">${trackArt ? `<img src="${esc(trackArt)}" alt="" loading="lazy" decoding="async">` : svg("music")}</span><div class="spotify-item-info"><strong>${esc(e.title)}</strong><small>${esc(e.artists || e.local?.artists || "Música")}</small></div></div><small class="music-availability">${ready ? "Baixada" : data.download?.url?.endsWith(e.uri?.split(":").slice(1).join("/")) && busy ? "Baixando…" : "Não baixada"}</small><div class="music-row-actions">${e.uri ? `<button data-action="download" data-uri="${esc(e.uri)}" ${ready || busy ? "disabled" : ""} aria-label="${ready ? "Download confirmado" : "Baixar"} ${esc(e.title)}">${svg(ready ? "check" : "download")}</button>` : ""}${`<button data-action="track_menu" data-row="${i}" aria-label="Mais opções para ${esc(e.title)}">${svg("more")}</button>`}${ready ? `<button data-action="delete_local" data-id="${e.local.id}" aria-label="Excluir download de ${esc(e.title)}">${svg("trash")}</button>` : ""}${data.entries.some((x) => x.uri === e.uri) ? `<button data-action="favorite" data-uri="${esc(e.uri)}" aria-label="Curtir ${esc(e.title)}" aria-pressed="${!!e.favorite}">${svg("heart")}</button><button data-action="remove" data-uri="${esc(e.uri)}" aria-label="Remover link">${svg("close")}</button>` : ""}</div></article>`;
        })
        .join("") ||
      '<div class="music-empty"><span>' +
        svg("music") +
        "</span><h3>Nenhuma música aqui ainda</h3><p>Adicione uma música para baixar e ouvir.</p>" +
        '<button class="music-green" data-action="add">Adicionar link</button></div>';
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
      time(ms) + " de " + time(data.player?.duration_ms),
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
    const spoken = label + " de " + time(data.player?.duration_ms);
    if (seekBar.getAttribute("aria-valuetext") !== spoken)
      seekBar.setAttribute("aria-valuetext", spoken);
  }
  function smoothProgress(now) {
    visualFrame = 0;
    if (
      disposed ||
      musicLayout.config.motion === false ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      data.player?.state !== "playing" ||
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
    observedPosition = data.player?.position_ms || 0;
    if (
      data.player?.state === "playing" &&
      !visualFrame &&
      element.getClientRects().length &&
      musicLayout.config.motion !== false &&
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
    $(".music-play").disabled = !data.local_tracks.some((t) => t.available);
    for (const action of ["previous", "next"])
      $(`[data-action=${action}]`).disabled = !data.local_tracks.some(
        (t) => t.available,
      );

    $(".music-duration").textContent = time(player.duration_ms);
    seekBar.disabled = !track || !player.duration_ms;
    seekBar.max = String(Math.max(1, player.duration_ms || 1));
    if (!draggingSeek && !pendingSeek) paintSeek(player.position_ms);
    if (pendingVolume === null && !volumeSending)
      paintVolume(player.volume ?? 80);
    saveSessionSoon();

    // queue list
    const queueSignature = JSON.stringify([
      data.local_tracks,
      player.track_id,
      data.artwork,
      queueIds,
    ]);
    if ($(".music-next").dataset.signature !== queueSignature) {
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
              '<article class="music-queue-row" draggable="true" data-queue-index="' +
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
              '</small></div></button><div class="music-queue-actions"><button data-action="queue_up" data-index="' +
              at +
              '" aria-label="Subir na fila">' +
              svg("up") +
              '</button><button data-action="queue_remove" data-index="' +
              at +
              '" aria-label="Remover da fila">' +
              svg("close") +
              "</button></div></article>"
            );
          })
          .join("") || "<small>A fila está vazia.</small>";
      $(".music-queue h3:last-of-type").textContent =
        "A seguir · " + upcoming.length;
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

  async function playQueued(id) {
    if (id == null) return;
    const meta = queueMeta.get(id);
    queueIds = [...playback.order];
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
    if (direction < 0 && data.player?.position_ms > 3000)
      return invoke("seek", { position_ms: 0 });
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

  /* ── Drag-to-reorder queue ──────────────────────────────────────────── */
  let draggingQueue = null;
  element.addEventListener("dragstart", (event) => {
    const row = event.target.closest("[data-queue-index]");
    if (row) {
      draggingQueue = Number(row.dataset.queueIndex);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(draggingQueue));
    }
  });
  element.addEventListener("dragover", (event) => {
    if (draggingQueue !== null && event.target.closest("[data-queue-index]"))
      event.preventDefault();
  });
  element.addEventListener("drop", (event) => {
    const row = event.target.closest("[data-queue-index]");
    if (row && draggingQueue !== null) {
      event.preventDefault();
      playback.move(draggingQueue, Number(row.dataset.queueIndex));
      queueIds = [...playback.order];
      renderPlayer();
    }
    draggingQueue = null;
  });
  element.addEventListener("dragend", () => (draggingQueue = null));

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
      if (action === "queue_remove") playback.removeAt(index);
      else playback.move(index, index - 1);
      queueIds = [...playback.order];
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
    if (action === "favorite" || action === "remove")
      return invoke(action, { uri });
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
  }, 1000);

  renderLibrary();
  renderPlayer();
  renderDownload();

  return {
    element,
    update,
    remote(action, params = {}) {
      if (disposed || !isOpen()) return;
      if (action === "toggle") return $(".music-play").click();
      if (action === "next" || action === "previous")
        return step(action === "next" ? 1 : -1);
      if (["pause", "resume"].includes(action)) return invoke(action);
      if (
        action === "volume" &&
        Number.isInteger(params.value) &&
        params.value >= 0 &&
        params.value <= 100
      )
        return setVolume(params.value, true);
      if (
        action === "seek" &&
        Number.isInteger(params.position_ms) &&
        params.position_ms >= 0
      )
        return invoke("seek", {
          position_ms: Math.min(
            params.position_ms,
            data.player?.duration_ms || 0,
          ),
        });
    },
    load: () => invoke("list"),
    dispose: () => {
      flushSession();
      flushVolume();
      disposed = true;
      clearTimeout(volumeTimer);
      musicLayout.dispose();
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
