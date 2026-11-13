"use strict";
let sourceLoading = false;
async function loadSourceSession() {
  if (sourceLoading) return;
  sourceLoading = true;
  try {
    const source = await api("source/session"), state = source.maintenance || {};
    $("source-session-state").textContent = state.message || (source.paused
      ? "A fonte pediu autenticação. A fila está preservada." : "Fonte aguardando verificação.");
    const pending = ["queued", "refreshing"].includes(state.state);
    const local = ["login_blocked", "needs_upload"].includes(state.state) || state.session_origin === "upload";
    $("source-refresh").disabled = pending || !state.browser_available || local;
    $("source-refresh").textContent = local ? "Atualize pelo arquivo cookies.txt" : pending ? "Atualizando sessão…" : "Atualizar sessão";
    $("source-connect").disabled = !state.browser_available;
    $("source-connect").textContent = state.state === "needs_login" ? "Reconectar Google" : "Conectar Google";
    $("source-session-settings").dataset.state = state.state || "idle";
    $("source-session-updated").textContent = state.updated
      ? "Última verificação: " + new Date(state.updated * 1000).toLocaleString("pt-BR") : "";
  } catch (error) { $("source-session-state").textContent = error.message; }
  finally { sourceLoading = false; }
}
$("source-refresh").onclick = task(async () => {
  $("source-refresh").disabled = true;
  try { await api("source/refresh", {}); await loadSourceSession(); }
  finally { if (!sourceLoading) await loadSourceSession(); }
});
$("source-connect").onclick = task(async () => {
  // Open directly on the user gesture so popup blockers do not lose the login window.
  const target = window.open("/source-browser.html", "noise-source-connection");
  if (!target) notice("Permita abrir a janela de conexão ou abra o painel em outra aba.");
});
setInterval(() => {
  if (!document.hidden && $("preferences").open && currentUser?.is_admin) loadSourceSession();
}, 3000);
