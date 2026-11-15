(function (root) {
  root.createNoiseListening = function ({ element, request, getState, player, apply, leavePlayback, dialog, icon, escape: esc, notify, canHost = () => true }) {
    let state = {active:false}, enabled = false, applying = false, busy = false, disposed = false;
    let invite = "", lastSuccess = 0, panel = null, memberSignature = "", error = "", epoch = 0;
    const button = document.createElement("button");
    button.className = "music-listen-button";
    button.type = "button";
    button.setAttribute("aria-label", "Ouvir junto com um amigo");
    button.innerHTML = icon("headphones") + '<span>Ouvir juntos</span><i aria-hidden="true"></i>';
    element.querySelector(".music-toolbar").append(button);
    function paint() {
      button.classList.toggle("is-active", !!state.active);
      button.title = state.active ? "Sala de música em andamento" : "Criar ou entrar em uma sala";
      button.querySelector("span").textContent = state.active ? "Juntos · " + state.members.filter(m => m.online).length : "Ouvir juntos";
      if (!panel?.isConnected) return;
      panel.querySelector("[data-listening-idle]").hidden = !!state.active;
      panel.querySelector("[data-listening-active]").hidden = !state.active;
      panel.querySelector("[data-listening-status]").textContent = error || (state.active
        ? state.host ? "Você controla a música. Seu amigo acompanha no próprio PC." : state.host_online ? "Acompanhando a reprodução de quem criou a sala." : "Aguardando o computador de quem criou a sala voltar."
        : "Entrem na conta do Noise Music em cada PC. Não é necessário baixar as músicas.");
      if (!state.active) return;
      const code = panel.querySelector("[data-listening-code]");
      code.textContent = state.host && invite ? invite.slice(0,5) + "–" + invite.slice(5) : state.host ? "Convite desta sessão" : "Você está na sala";
      panel.querySelector("[data-listening-copy]").hidden = !state.host || !invite;
      panel.querySelector("[data-listening-leave]").textContent = state.host ? "Encerrar sala" : "Sair da sala";
      const signature = JSON.stringify(state.members);
      if (signature !== memberSignature) {
        memberSignature = signature;
        panel.querySelector("[data-listening-members]").innerHTML = state.members.map(m =>
          '<li><span class="music-listen-avatar" aria-hidden="true">' + esc(m.name.slice(0,1).toUpperCase()) + '</span><span><strong>' + esc(m.name) + '</strong><small>' + (m.host ? "Controla a reprodução" : m.online ? "Ouvindo junto" : "Reconectando…") + '</small></span><i data-online="' + !!m.online + '"></i></li>').join("");
      }
    }
    async function receive(next) {
      const previous = state;
      state = next; error = ""; lastSuccess = performance.now();
      if (next.code) invite = next.code;
      if (!state.active && previous.active && !previous.host) await leavePlayback();
      if (state.active && !state.host && state.track) {
        applying = true;
        try { await apply(state.player, state.track); }
        finally { applying = false; }
      }
      paint();
    }
    async function operate(operation, extra = {}) {
      if (!getState().cloud?.connected) throw Error("Entre na sua conta nos ajustes de Conexões para ouvir juntos.");
      if (operation === "create" && !canHost()) throw Error("Selecione este PC em Dispositivos antes de criar a sala.");
      const version = epoch, started = performance.now();
      const result = await request("listening", {operation,...extra, ...(operation === "create" || operation === "state" ? {player:player()} : {})});
      if (disposed || version !== epoch) return;
      if (result.player?.state === "playing") result.player.position_ms += Math.round((performance.now()-started)/2);
      enabled = result.active;
      await receive(result);
    }
    function open() {
      if (panel?.isConnected) { panel.focus(); return; }
      memberSignature = "";
      panel = dialog("Ouvir juntos", '<div class="music-listen-hero">' + icon("headphones") + '<h4>A mesma música.<br>No seu ritmo, juntos.</h4><p>Uma sala privada, dois PCs e a sua música.</p></div><p class="music-listen-status" data-listening-status role="status" aria-live="polite"></p><section data-listening-idle><button class="music-green" data-listening-create>Criar uma sala</button><form class="music-listen-join"><label for="noise-listening-code">Já recebeu um convite?</label><div><input id="noise-listening-code" name="code" autocomplete="off" autocapitalize="characters" placeholder="Código de 10 caracteres" maxlength="11" required><button class="music-secondary" type="submit">Entrar</button></div></form></section><section data-listening-active hidden><div class="music-listen-invite"><strong data-listening-code></strong><button data-listening-copy aria-label="Copiar código de convite">' + icon("copy") + '</button></div><ul class="music-listen-members" data-listening-members></ul><button class="music-secondary" data-listening-leave>Sair da sala</button></section>');
      panel.classList.add("music-listen-dialog");
      const run = async (operation, extra) => {
        if (busy) return;
        busy = true; panel.setAttribute("aria-busy", "true");
        const controls = panel.querySelectorAll("[data-listening-create], .music-listen-join button, [data-listening-leave]");
        controls.forEach(control => { control.disabled = true; });
        try { await operate(operation, extra); }
        catch (e) { error = e.message; paint(); }
        finally { busy = false; panel?.removeAttribute("aria-busy"); controls.forEach(control => { control.disabled = false; }); }
      };
      panel.querySelector("[data-listening-create]").onclick = () => run("create");
      panel.querySelector("form").onsubmit = e => { e.preventDefault(); void run("join", {code:new FormData(e.target).get("code")}); };
      panel.querySelector("[data-listening-leave]").onclick = () => run("leave");
      panel.querySelector("[data-listening-copy]").onclick = () => {
        if (root.mare?.copy) root.mare.copy(invite);
        else navigator.clipboard.writeText(invite).catch(() => notify("Copie o código mostrado na sala."));
        panel.querySelector("[data-listening-status]").textContent = "Convite copiado. Envie para seu amigo pelo seu aplicativo de mensagens.";
      };
      paint();
      if (!enabled && getState().cloud?.connected) void run("state");
    }
    button.onclick = open;
    const timer = setInterval(async () => {
      if (!enabled || busy || disposed) return;
      busy = true;
      try { await operate("state"); }
      catch {
        error = "Reconectando à sala…";
        if (state.active && !state.host && performance.now()-lastSuccess > 5000) {
          applying = true;
          try { await apply({...state.player,state:"paused"},state.track); } finally { applying = false; }
        }
        paint();
      } finally { busy = false; }
    }, 1200);
    return { open, follower: () => state.active && !state.host, applying: () => applying,
      reset() { epoch++; enabled = false; state = {active:false}; invite = ""; paint(); },
      dispose() { disposed = true; clearInterval(timer); if (enabled) request("listening",{operation:"leave"}).catch(()=>{}); button.remove(); },
    };
  };
})(window);
