(function (root) {
  // Canvas normalizes pixels and removes the original file's metadata before sync.
  root.prepareMusicCover = async function (file) {
    if (
      !file ||
      file.size > 12 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      throw Error("Escolha PNG, JPEG ou WebP de até 12 MB.");
    const url = URL.createObjectURL(file),
      image = new Image();
    try {
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d");
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      for (const size of [384, 256, 192]) {
        canvas.width = canvas.height = size;
        ctx.drawImage(
          image,
          (image.naturalWidth - side) / 2,
          (image.naturalHeight - side) / 2,
          side,
          side,
          0,
          0,
          size,
          size,
        );
        for (const quality of [0.8, 0.65, 0.5]) {
          const art = canvas.toDataURL("image/jpeg", quality);
          if (art.length <= 32768) return art;
        }
      }
      throw Error("Não foi possível reduzir essa imagem. Escolha outra capa.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  // Mirrored display state is deliberately separate from the local audio state.
  root.createMusicOutput = function ({
    getState,
    localPlayer,
    send,
    receive,
    changed = () => {},
  }) {
    let pendingTarget = null,
      pendingUntil = 0;
    let activation = 0,
      claimingUntil = 0,
      sampleKey = "",
      sampledAt = 0,
      basePosition = 0;
    function remote() {
      const state = getState(),
        session = state.session;
      if (
        session &&
        session.device_id === state.id &&
        (session.player?.activation || 0) >= activation
      )
        claimingUntil = 0;
      if (
        !session?.online ||
        session.device_id === state.id ||
        performance.now() < claimingUntil
      )
        return null;
      const key = JSON.stringify([
        session.device_id,
        session.revision,
        session.updated_at,
        session.player,
      ]);
      if (key !== sampleKey) {
        sampleKey = key;
        sampledAt = performance.now();
        basePosition = session.player?.position_ms || 0;
        if (session.player?.state === "playing")
          basePosition += Math.max(
            0,
            Math.min(
              25000,
              (session.server_time - session.updated_at) * 1000 || 0,
            ),
          );
      }
      const player = { ...session.player };
      player.position_ms = Math.min(
        player.duration_ms || 86400000,
        basePosition +
          (player.state === "playing" ? performance.now() - sampledAt : 0),
      );
      return { ...session, player };
    }
    function claim() {
      activation = Math.max(Date.now(), activation + 1);
      claimingUntil = performance.now() + 10000;
      changed();
    }
    async function command(action, params = {}) {
      const output = remote();
      if (!output) return false;
      await send(output.device_id, { action, ...params });
      return true;
    }
    async function play(track, queue) {
      const output = remote();
      if (!output) return false;
      await send(output.device_id, {
        action: "transfer",
        player: {
          track_id: track.id,
          title: track.title,
          artist: track.artist || track.artists || "",
          art: track.art || track.thumbnail || "",
          state: "playing",
          position_ms: 0,
          duration_ms: track.duration_ms || 0,
          queue: queue || output.player.queue || [],
          source: getState().id,
        },
      });
      return true;
    }
    async function select(device) {
      const state = getState(),
        output = remote(),
        player = output?.player || localPlayer();
      const source = output?.device_id || state.id;
      if (device.id === source) return;
      pendingTarget = device.id;
      pendingUntil = performance.now() + 15000;
      try {
        if (device.id === state.id) {
          if (output?.player.track_id)
            return await receive({ ...output.player, source });
          else claim();
        } else if (device.id !== source) {
          await send(
            device.id,
            player.track_id
              ? { action: "transfer", player: { ...player, source } }
              : { action: "select" },
          );
        }
      } catch (error) {
        pendingTarget = null;
        throw error;
      }
    }
    return {
      remote,
      claim,
      command,
      play,
      select,
      activation: () => activation,
      reset: () => {
        activation = 0;
        claimingUntil = 0;
        sampleKey = "";
        pendingTarget = null;
        pendingUntil = 0;
      },
      pending: () => {
        if (
          getState().session?.device_id === pendingTarget ||
          performance.now() >= pendingUntil
        )
          pendingTarget = null;
        return pendingTarget;
      },
      current: () => remote()?.player || localPlayer(),
    };
  };
  root.createMusicDevices = function (
    container,
    {
      desktop = false,
      accountEntry = false,
      getState,
      localPlayer,
      connect,
      pair,
      send,
      receive,
      disconnect,
      icon,
      notify,
      output,
      picker = false,
    },
  ) {
    let signature = "",
      pairing = null,
      busy = false,
      loginOrigin = "",
      loginUsername = "";
    if (desktop) {
      try {
        loginOrigin = localStorage.getItem("mare-music-server") || "";
      } catch {}
    }
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
    async function transferHere(player, source) {
      await receive({ ...player, source });
    }
    async function render(force = false) {
      if (
        container.contains(document.activeElement) &&
        document.activeElement.matches("input")
      )
        return;
      const state = getState();
      if (desktop && state.origin) {
        loginOrigin = state.origin;
        try {
          localStorage.setItem("mare-music-server", loginOrigin);
        } catch {}
      }
      const next = JSON.stringify([state, pairing, busy]);
      if (!force && signature === next) return;
      signature = next;
      container.classList.add("mare-device-panel");
      if (desktop && !state.connected) {
        container.innerHTML =
          "<h4>" +
          icon("devices") +
          ' PC e celular</h4><p>Conecte sua conta do Noise. A biblioteca acompanha você e as playlists adicionadas no PC também são preparadas para o celular.</p><form><label>Servidor do Noise<input name="origin" type="text" inputmode="url" autocapitalize="none" spellcheck="false" required placeholder="https://seu-servidor.example" autocomplete="url"></label><label>Usuário do Noise<input name="username" required maxlength="32" autocomplete="username"></label><label>Senha<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><button class="device-primary" ' +
          (state.connecting ? "disabled" : "") +
          ">" +
          (state.connecting ? "Conectando…" : "Entrar na minha conta") +
          '</button></form><p role="status">' +
          esc(
            state.error ||
              "Use a mesma conta do celular. Sua biblioteca será sincronizada. A senha não fica salva no PC.",
          ) +
          "</p>";
        if (accountEntry) {
          container.querySelector("h4").textContent = "Entrar no Noise Music";
          container.querySelector("p").textContent =
            "Sua biblioteca, playlists e aparelhos na mesma conta do celular.";
        }
        const form = container.querySelector("form");
        const serverLabel = form.elements.origin.closest("label");
        const details = document.createElement("details");
        details.className = "music-server-config";
        details.open = !loginOrigin;
        const summary = document.createElement("summary");
        summary.textContent = "Configuração do servidor";
        details.append(summary, serverLabel);
        form.append(details);

        form.elements.origin.value = loginOrigin;
        form.elements.username.value = loginUsername;
        form.onsubmit = async (event) => {
          event.preventDefault();
          if (busy) return;
          loginOrigin = form.elements.origin.value.trim();
          loginUsername = form.elements.username.value.trim();
          if (!loginOrigin.includes("://"))
            loginOrigin = "https://" + loginOrigin;
          try {
            localStorage.setItem("mare-music-server", loginOrigin);
          } catch {}
          busy = true;
          form.querySelector("button").disabled = true;
          try {
            await connect(
              loginOrigin,
              loginUsername,
              form.elements.password.value,
            );
            form.elements.password.value = "";
            document.activeElement?.blur();
          } catch (e) {
            notify(e.message);
          } finally {
            form.elements.password.value = "";
            document.activeElement?.blur();
            busy = false;
            signature = "";
            render(true);
          }
        };
        return;
      }
      const devices = Array.isArray(state.devices) ? state.devices : [];
      const selected =
        output?.remote()?.device_id ||
        (state.session?.online ? state.session.device_id : state.id);
      if (output) {
        container.innerHTML =
          (picker ? "" : "<h4>" + icon("devices") + " Dispositivos</h4>") +
          '<p class="device-output-intro">Escolha onde ouvir</p><div class="device-output-list" role="listbox" aria-label="Saída de áudio"></div>' +
          '<p class="device-output-status" role="status">' +
          esc(
            state.error ||
              "A mesma conta conecta seus aparelhos com o Noise aberto.",
          ) +
          "</p>" +
          (!picker && desktop
            ? '<button class="device-secondary" data-disconnect>Desconectar este PC</button>'
            : "");
        const list = container.querySelector(".device-output-list");
        const visible = devices.length
          ? devices
              .filter(
                (d) =>
                  d.online ||
                  d.id === state.id ||
                  d.id === state.session?.device_id,
              )
              .sort(
                (a, b) => Number(b.id === selected) - Number(a.id === selected),
              )
          : [
              {
                id: state.id,
                name: desktop ? "Este PC" : "Este celular",
                kind: desktop ? "desktop" : "web",
                online: true,
                player: localPlayer(),
              },
            ];
        for (const device of visible) {
          const self = device.id === state.id,
            active = device.id === selected;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "device-output-row";
          button.role = "option";
          button.setAttribute("aria-selected", String(active));
          const preparing = output.pending() === device.id;
          button.disabled = !device.online || busy || preparing;
          button.innerHTML =
            '<span class="device-output-icon">' +
            icon(device.kind === "desktop" ? "computer" : "phone") +
            "</span><span><strong>" +
            esc(device.name) +
            "</strong><small>" +
            esc(
              !device.online
                ? "Indisponível agora"
                : preparing
                  ? "Conectando esta saída…"
                  : active
                    ? (device.player?.state === "playing"
                        ? "Reproduzindo"
                        : "Saída selecionada") +
                      (self ? " · este aparelho" : "")
                    : self
                      ? "Este aparelho"
                      : "Disponível",
            ) +
            '</small></span><span class="device-output-check">' +
            (active ? icon("check") : "") +
            "</span>";
          button.onclick = async () => {
            if (busy) return;
            busy = true;
            button.disabled = true;
            try {
              const result = await output.select(device);
              notify(
                result?.pending
                  ? "Preparando neste aparelho. A saída atual continua tocando."
                  : self
                    ? "Saída: este aparelho"
                    : "Conectando a " + device.name,
              );
            } catch (error) {
              notify(error.message);
            } finally {
              busy = false;
              render(true);
            }
          };
          list.append(button);
        }
        container
          .querySelector("[data-disconnect]")
          ?.addEventListener("click", async () => {
            await disconnect();
            render(true);
          });
        return;
      }
      container.innerHTML =
        "<h4>" +
        icon("devices") +
        " PC e celular</h4><p>" +
        esc(
          desktop
            ? "Conectado como " +
                (state.user?.username || "sua conta") +
                ". Busca e download continuam neste PC."
            : "Sua biblioteca acompanha a conta. Escolha onde ouvir e controle os aparelhos abertos.",
        ) +
        "</p>" +
        (!desktop
          ? '<button class="device-primary" data-pair>Conectar um PC</button>'
          : '<button class="device-secondary" data-disconnect>Desconectar este PC</button>') +
        (pairing && pairing.expires > Date.now()
          ? '<div class="device-pair-code"><strong>' +
            esc(pairing.code) +
            "</strong><small>Digite este código nos ajustes do Noise no PC. Válido por cinco minutos.</small><button data-copy-server>Copiar endereço do servidor</button></div>"
          : "") +
        '<div class="device-list"></div><p role="status">' +
        esc(
          state.error ||
            "A reprodução e o controle precisam do app aberto no aparelho de destino.",
        ) +
        "</p>";
      const list = container.querySelector(".device-list");
      for (const device of devices) {
        const self = device.id === state.id,
          player = device.player || {};
        const row = document.createElement("article");
        row.className = "device-card";
        row.innerHTML =
          "<header><span>" +
          icon(device.kind === "desktop" ? "computer" : "phone") +
          "</span><div><strong>" +
          esc(device.name) +
          (self ? " · este aparelho" : "") +
          "</strong><small>" +
          esc(device.online ? player.title || "Disponível" : "Offline") +
          '</small></div><i class="device-online ' +
          (device.online ? "active" : "") +
          '"></i></header>';
        if (!self && device.online) {
          row.insertAdjacentHTML(
            "beforeend",
            '<div class="device-transport"><button data-command="previous" aria-label="Anterior em ' +
              esc(device.name) +
              '">' +
              icon("previous") +
              '</button><button data-command="' +
              (player.state === "playing" ? "pause" : "resume") +
              '" aria-label="' +
              (player.state === "playing" ? "Pausar" : "Reproduzir") +
              " em " +
              esc(device.name) +
              '">' +
              icon(player.state === "playing" ? "pause" : "play") +
              '</button><button data-command="next" aria-label="Próxima em ' +
              esc(device.name) +
              '">' +
              icon("next") +
              '</button><button data-volume="-5" aria-label="Diminuir volume">−</button><span>' +
              Math.round(player.volume || 0) +
              '%</span><button data-volume="5" aria-label="Aumentar volume">+</button></div><div class="device-transfer"><button data-here ' +
              (!player.track_id ? "disabled" : "") +
              ">Continuar aqui</button><button data-there " +
              (!localPlayer()?.track_id ? "disabled" : "") +
              ">Ouvir neste dispositivo</button></div>",
          );
          row.querySelectorAll("[data-command]").forEach(
            (button) =>
              (button.onclick = async () => {
                try {
                  await send(device.id, { action: button.dataset.command });
                } catch (e) {
                  notify(e.message);
                }
              }),
          );
          if (device.kind !== "desktop") {
            row
              .querySelectorAll("[data-volume]")
              .forEach((button) => button.remove());
            row.querySelector(".device-transport span")?.remove();
          }
          row.querySelectorAll("[data-volume]").forEach(
            (button) =>
              (button.onclick = async () => {
                try {
                  await send(device.id, {
                    action: "volume",
                    value: Math.max(
                      0,
                      Math.min(
                        100,
                        (player.volume || 0) + Number(button.dataset.volume),
                      ),
                    ),
                  });
                } catch (e) {
                  notify(e.message);
                }
              }),
          );
          row.querySelector("[data-here]").onclick = async () => {
            try {
              await transferHere(player, device.id);
            } catch (e) {
              notify(e.message);
            }
          };
          row.querySelector("[data-there]").onclick = async () => {
            try {
              await send(device.id, {
                action: "transfer",
                player: { ...localPlayer(), source: state.id },
              });
              notify("Reprodução enviada para " + device.name);
            } catch (e) {
              notify(e.message);
            }
          };
        }
        list.append(row);
      }
      if (!devices.length)
        list.innerHTML = "<p>Nenhum outro aparelho conectado.</p>";
      container
        .querySelector("[data-pair]")
        ?.addEventListener("click", async (event) => {
          event.target.disabled = true;
          try {
            const result = await pair();
            pairing = {
              code: result.code,
              expires: Date.now() + result.expires_in * 1000,
            };
            signature = "";
            render(true);
          } catch (e) {
            notify(e.message);
            event.target.disabled = false;
          }
        });
      container
        .querySelector("[data-copy-server]")
        ?.addEventListener("click", async () => {
          await navigator.clipboard.writeText(location.origin);
          notify("Endereço copiado");
        });
      container
        .querySelector("[data-disconnect]")
        ?.addEventListener("click", async () => {
          await disconnect();
          signature = "";
          render(true);
        });
    }
    return {
      render,
      clear() {
        pairing = null;
        signature = "";
      },
    };
  };
})(window);
