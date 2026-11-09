(function (root) {
  root.createMusicDevices = function (
    container,
    {
      desktop = false,
      getState,
      localPlayer,
      connect,
      pair,
      send,
      receive,
      disconnect,
      icon,
      notify,
    },
  ) {
    let signature = "",
      pairing = null,
      busy = false,
      loginOrigin = "",
      loginUsername = "";
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
      const next = JSON.stringify([state, pairing, busy]);
      if (!force && signature === next) return;
      signature = next;
      container.classList.add("mare-device-panel");
      if (desktop && !state.connected) {
        container.innerHTML =
          "<h4>" +
          icon("devices") +
          ' PC e celular</h4><p>Conecte sua conta do Maré. A biblioteca acompanha você e as playlists adicionadas no PC também são preparadas para o celular.</p><form><label>Servidor do Maré<input name="origin" type="text" inputmode="url" autocapitalize="none" spellcheck="false" required placeholder="https://seu-servidor.example" autocomplete="url"></label><label>Usuário do Maré<input name="username" required maxlength="32" autocomplete="username"></label><label>Senha<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><button class="device-primary" ' +
          (state.connecting ? "disabled" : "") +
          ">" +
          (state.connecting ? "Conectando…" : "Entrar na minha conta") +
          '</button></form><p role="status">' +
          esc(
            state.error ||
              "Use a mesma conta do celular. Sua biblioteca será sincronizada. A senha não fica salva no PC.",
          ) +
          "</p>";
        const form = container.querySelector("form");
        form.elements.origin.value = loginOrigin;
        form.elements.username.value = loginUsername;
        form.onsubmit = async (event) => {
          event.preventDefault();
          if (busy) return;
          loginOrigin = form.elements.origin.value.trim();
          loginUsername = form.elements.username.value.trim();
          if (!loginOrigin.includes("://"))
            loginOrigin = "https://" + loginOrigin;
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
            "</strong><small>Digite este código nos ajustes do Maré no PC. Válido por cinco minutos.</small><button data-copy-server>Copiar endereço do servidor</button></div>"
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
