(function (root) {
  // One media element for the entire app lifetime. URLs contain short-lived, track-scoped grants.
  root.createNoiseStreaming = function ({ element, request, changed, notify, getState, makeAudio = () => new Audio() }) {
    const audio = makeAudio();
    audio.preload = "auto";
    audio.hidden = true;
    // App panes are detached into the tab cache. Keep audio in the persistent chrome document.
    const host = element.ownerDocument?.body || element;
    audio.dataset.noiseStream = "true";
    host.append(audio);
    let current = null, generation = 0, loading = false, desired = false, disposed = false, volume = 80;
    let reporting = false, dirty = false, lastReport = 0;
    const waiters = new Set();
    function snapshot() {
      if (!current) return null;
      const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : current.duration_ms || 0;
      return { track_id: current.id, state: audio.ended ? "stopped" : !audio.paused && !loading ? "playing" : "paused",
        position_ms: Math.round((audio.currentTime || 0) * 1000), duration_ms: duration,
        volume, streaming: true, buffering: loading };
    }
    async function report(force = false) {
      changed();
      if (!current || disposed) return;
      if (!force && performance.now() - lastReport < 750) return;
      dirty = true;
      if (reporting) return;
      reporting = true;
      try {
        while (dirty && current && !disposed) {
          dirty = false; lastReport = performance.now();
          await request("stream_report", {...snapshot(),revision:getState().library_revision});
        }
      } catch { /* A closed worker must not leave an unhandled media event promise. */ }
      finally { reporting = false; }
    }
    function delay(ms) {
      return new Promise(resolve => {
        const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
        const timer = setTimeout(done, ms); waiters.add(done);
      });
    }
    function stop() {
      generation++; desired = false; current = null; loading = false;
      for (const done of [...waiters]) done();
      audio.pause(); audio.removeAttribute("src"); audio.load(); changed();
    }
    async function start(track, { position_ms = 0, paused = false } = {}) {
      volume = getState().player?.volume ?? 80;
      stop();
      const ticketGeneration = generation;
      desired = !paused; current = track; loading = true;
      audio.volume = Math.pow(volume / 100, 2);
      changed();
      try {
        await request("stop");
        let result, preparationNotice = false, missingRetries = 0;
        const deadline = performance.now() + 180000;
        do {
          try { result = await request("cloud_stream", { track_id: track.track_uri.split(":").at(-1) }); }
          catch (error) { if (String(error.message).includes("HTTP 404") && missingRetries++ < 4) result = {state:"preparing"}; else throw error; }
          if (disposed || generation !== ticketGeneration) return;
          if (result.state === "ready") break;
          if (result.state !== "preparing") throw Error(result.error || "Não foi possível abrir esta faixa pelo servidor.");
          if (!preparationNotice) notify("Preparando esta música no servidor… Você pode continuar navegando.");
          preparationNotice = true;
          await delay(2000);
        } while (performance.now() < deadline);
        if (disposed || generation !== ticketGeneration) return;
        if (result.state !== "ready") throw Error("A preparação continua no servidor. Tente dar play novamente em instantes.");
        audio.src = result.url;
        audio.load();
        if (position_ms > 0) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(Error("O áudio demorou a carregar.")), 15000);
            const cancel = () => finish(Error("Reprodução substituída."));
            const metadata = () => finish();
            const error = () => finish(Error("Não foi possível abrir o áudio."));
            function finish(error) {
              clearTimeout(timer); waiters.delete(cancel);
              audio.removeEventListener("loadedmetadata", metadata); audio.removeEventListener("error", errorHandler);
              error ? reject(error) : resolve();
            }
            const errorHandler = error;
            waiters.add(cancel); audio.addEventListener("loadedmetadata", metadata, {once:true}); audio.addEventListener("error", errorHandler, {once:true});
            if (audio.readyState >= 1) finish();
          });
          if (generation !== ticketGeneration) return;
          audio.currentTime = Math.min(position_ms / 1000, Number.isFinite(audio.duration) ? audio.duration : position_ms / 1000);
        }
        loading = false;
        if (desired) await audio.play();
        if (generation === ticketGeneration) await report(true);
      } catch (error) {
        if (generation !== ticketGeneration || disposed) return;
        loading = false; desired = false; audio.pause();
        notify(error.name === "NotAllowedError" ? "Toque em reproduzir para iniciar o áudio." : error.message);
        await report(true);
      }
    }
    for (const event of ["timeupdate", "playing", "pause", "ended", "durationchange"])
      audio.addEventListener(event, () => { if (event === "playing") loading = false; void report(event !== "timeupdate"); });
    audio.addEventListener("waiting", () => { if (current) { loading = true; void report(true); } });
    audio.addEventListener("canplay", () => { loading = false; void report(true); });
    audio.addEventListener("error", () => {
      if (!current || !audio.getAttribute("src")) return;
      loading = false; desired = false; audio.pause();
      notify("O streaming foi interrompido. Verifique a conexão e tente reproduzir novamente.");
      void report(true);
    });
    return {
      active: () => current !== null, snapshot, start, stop,
      async command(method, params = {}) {
        if (!current) return false;
        if (method === "pause") { desired = false; audio.pause(); }
        else if (method === "resume") { desired = true; if (!audio.getAttribute("src")) await start(current, {position_ms:snapshot().position_ms}); else await audio.play(); }
        else if (method === "seek") { if (!audio.readyState) return true; audio.currentTime = Math.max(0, Math.min(params.position_ms / 1000, Number.isFinite(audio.duration) ? audio.duration : 86400)); }
        else if (method === "volume") {
          volume = Math.max(0, Math.min(100, params.value));
          audio.volume = Math.pow(volume / 100, 2);
          return true;
        }
        else return false;
        await report(true); return true;
      },
      dispose() { disposed = true; stop(); audio.remove(); },
    };
  };
})(window);
