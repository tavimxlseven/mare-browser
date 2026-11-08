"use strict";
let currentUser = null;

async function useAccount(user) {
  const previous = currentUser?.id;
  if (previous && previous !== user.id) {
    downloadController?.abort();
    audio.pause();
    audio.removeAttribute("src");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    current = null;
    playHistory = [];
    objectUrl = "";
    queue = [];
    library = { tracks: [], playlists: [], jobs: [] };
    downloads = new Set();
    offlineIds = new Set();
    deviceBatch = [];
    selected = null;
    renderSignature = "";
    islandJobId = null;
    dismissedJobs = new Set();
    $("mini").hidden = true;
  }
  currentUser = user;
  database = openDatabase("mare-music-account-" + user.id);
  await database;
  // The old shared device cache belongs to the migrated administrator only.
  if (user.is_admin && !(await local("meta", "legacy-migrated"))) {
    const legacy = await openDatabase("mare-music");
    for (const store of ["meta", "audio"]) {
      const keys = await new Promise((resolve, reject) => {
        const request = legacy
          .transaction(store)
          .objectStore(store)
          .getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const key of keys) {
        const value = await new Promise((resolve, reject) => {
          const request = legacy.transaction(store).objectStore(store).get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await local(store, key, value);
      }
    }
    legacy.close();
    indexedDB.deleteDatabase("mare-music");
    await local("meta", "legacy-migrated", true);
  }
  localStorage.setItem("mare-music:last-account", JSON.stringify(user));
  $("account-name").textContent = user.username;
  $("account-role").textContent = user.is_admin ? "Administrador" : "Sua conta";
  $("admin-section").hidden = !user.is_admin;
  library = (await local("meta", "library")) || {
    tracks: [],
    playlists: [],
    jobs: [],
  };
  downloads = new Set((await local("meta", "downloads")) || []);
  deviceBatch = (await local("meta", "device-batch")) || [...downloads];
  dismissedJobs = new Set((await local("meta", "dismissed-jobs")) || []);
  selected = (await local("meta", "selected")) || null;
  const db = await database;
  offlineIds = new Set(
    await new Promise((resolve, reject) => {
      const request = db.transaction("audio").objectStore("audio").getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }),
  );
  $("theme").value = (await local("meta", "theme")) || "dark";
  document.body.classList.toggle("light", $("theme").value === "light");
  $("network").value = (await local("meta", "network")) || "wifi";
}

function authMode(register) {
  $("login-form").hidden = register;
  $("register-form").hidden = !register;
  $("auth-title").textContent = register
    ? "Seu espaço para ouvir."
    : "Bom ter você por aqui.";
  $("auth-description").textContent = register
    ? "Crie sua conta com um convite do administrador."
    : "Entre para abrir suas playlists.";
  $("auth-error").hidden = true;
  $("login-tab").setAttribute("aria-selected", String(!register));
  $("register-tab").setAttribute("aria-selected", String(register));
}
$("login-tab").onclick = () => authMode(false);
$("register-tab").onclick = () => authMode(true);

async function submitAccount(event, register) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("auth-error").hidden = true;
  try {
    const payload = register
      ? {
          username: $("register-username").value.trim(),
          password: $("register-password").value,
          invite: $("invite-code").value.trim(),
        }
      : { username: $("username").value.trim(), password: $("password").value };
    const response = await api(register ? "register" : "login", payload);
    await useAccount(response.user);
    $("password").value = "";
    $("register-password").value = "";
    $("invite-code").value = "";
    onlineSession = true;
    $("login").hidden = true;
    $("app").hidden = false;
    await refresh();
    await restorePlayer();
    await drain();
  } catch (error) {
    $("auth-error").textContent = error.message;
    $("auth-error").hidden = false;
  } finally {
    button.disabled = false;
  }
}
$("login-form").onsubmit = (event) => submitAccount(event, false);
$("register-form").onsubmit = (event) => submitAccount(event, true);

async function loadInvites() {
  if (!currentUser?.is_admin) return;
  const response = await api("admin/invites");
  $("invite-history").replaceChildren();
  for (const invite of response.invites) {
    const line = document.createElement("div");
    line.className = "invite-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = invite.used
      ? "Utilizado"
      : invite.revoked
        ? "Revogado"
        : invite.expires * 1000 < Date.now()
          ? "Expirado"
          : "Disponível";
    const expiry = document.createElement("small");
    expiry.textContent =
      "Validade " + new Date(invite.expires * 1000).toLocaleDateString("pt-BR");
    copy.append(title, expiry);
    line.append(copy);
    if (!invite.used && !invite.revoked && invite.expires * 1000 > Date.now()) {
      const revoke = document.createElement("button");
      revoke.textContent = "Revogar";
      revoke.onclick = task(async () => {
        await api("admin/invites/" + invite.id + "/revoke", {});
        await loadInvites();
      });
      line.append(revoke);
    }
    $("invite-history").append(line);
  }
}
$("generate-invite").onclick = task(async () => {
  const button = $("generate-invite");
  button.disabled = true;
  try {
    const response = await api("admin/invites", {});
    $("generated-invite").value = response.code;
    $("invite-result").hidden = false;
    await loadInvites();
  } finally {
    button.disabled = false;
  }
});
$("copy-invite").onclick = task(async () => {
  await navigator.clipboard.writeText($("generated-invite").value);
  notice("Convite copiado. Ele pode ser usado uma vez e vale por 7 dias.");
});
$("logout").onclick = task(async () => {
  if (
    !confirm(
      "Sair desta conta? Os downloads e dados offline desta conta serão apagados neste aparelho.",
    )
  )
    return;
  downloadController?.abort();
  try {
    await api("logout", {});
  } catch (error) {
    if (error.status !== 401) throw error;
  }
  audio.pause();
  audio.removeAttribute("src");
  const db = await database;
  const tx = db.transaction(["meta", "audio"], "readwrite");
  tx.objectStore("meta").clear();
  tx.objectStore("audio").clear();
  tx.oncomplete = () => {
    localStorage.removeItem("mare-music:last-account");
    location.reload();
  };
});

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("install-button").hidden = false;
});
$("install-button").onclick = task(async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install-button").hidden = true;
});
if (/Android/i.test(navigator.userAgent)) {
  $("install-step-one").textContent = "No Chrome, abra o menu de três pontos.";
  $("install-step-two").textContent =
    "Escolha Instalar app ou Adicionar à tela inicial.";
}
