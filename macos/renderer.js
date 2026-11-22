"use strict";
(() => {
  const send = (value) => window.ipc.postMessage(JSON.stringify(value));
  const requests = new Map();
  let sequence = 10000;
  let messageTimer;
  let remote = { enabled: false };
  let running = true;
  const message = document.querySelector("#message");
  function notify(text) {
    message.textContent = text;
    message.hidden = false;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { message.hidden = true; }, 5000);
  }
  function request(method, params = {}) {
    if (!running) return Promise.reject(Error("Reabra o Noise Music para reconectar."));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(Error("O Noise Music demorou para responder."));
      }, method === "import_link" ? 15000 : 8000);
      requests.set(id, { resolve, reject, timer });
      send({ cmd: "apps_request", method, params, request_id: id });
    });
  }
  const view = window.createSpotifyView({
    request, send, notify, icon: window.compassIcon, isOpen: () => running,
  });
  window.mare = {
    notify,
    copy: (text) => send({ cmd: "copy", text }),
    getMusicRemote: () => remote,
    setMusicRemote: (enabled) => send({ cmd: "music_remote", enabled }),
    remoteStatus: (status) => { remote = status; view.refreshRemote(); },
    standalone: true,
    remoteMusic: ({ action, params }) => view.remote(action, params),
    appEvent({ kind, payload }) {
      if (kind === "exited") {
        running = false;
        notify("O serviço de música encerrou. Reabra o Noise Music.");
        for (const pending of requests.values()) {
          clearTimeout(pending.timer);
          pending.reject(Error("O serviço de música encerrou."));
        }
        requests.clear();
        return;
      }
      if (kind !== "response") return;
      if (payload.id === 0) {
        if (payload.result?.player) view.update(payload.result);
        return;
      }
      const pending = requests.get(payload.id);
      if (!pending) return;
      requests.delete(payload.id);
      clearTimeout(pending.timer);
      if (payload.error) pending.reject(Error(payload.error.message || payload.error));
      else pending.resolve(payload.result || {});
    },
  };
  document.querySelector("#music").append(view.element);
  view.load();
})();
