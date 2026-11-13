"use strict";
const $ = id => document.getElementById(id);
let active = false, polling = false, objectUrl = "", serial = Promise.resolve();
async function request(action, body = {}) {
  const response = await fetch("/api/source/browser/" + action, {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body), cache:"no-store",
  });
  const result = await response.json();
  if (!response.ok) { const error = Error(result.error || "Não foi possível acessar a janela privada."); error.code = result.code; throw error; }
  return result;
}
function error(error) { $("status").textContent = error.message; }
async function frame() {
  if (!active || polling || document.hidden) return;
  polling = true;
  try {
    const response = await fetch("/api/source/browser/frame", {cache:"no-store"});
    if (!response.ok) {
      const result = await response.json();
      const error = Error(result.error || "A conexão encerrou ou expirou. Abra uma nova janela para continuar.");
      error.code = result.code; throw error;
    }
    const next = URL.createObjectURL(await response.blob());
    $("screen").src = next;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = next;
  } catch (e) {
    active = false; $("start").disabled = e.code === "login_blocked";
    if (e.code === "login_blocked") { $("viewport").hidden = $("typing").hidden = true; $("finish").disabled = $("stop").disabled = true; }
    error(e);
  }
  finally { polling = false; }
}
function send(body) {
  serial = serial.then(() => request("input", body)).catch(error);
  return serial;
}
$("start").onclick = async () => {
  $("start").disabled = true;
  $("status").textContent = "Abrindo o navegador privado…";
  try {
    await request("start"); active = true;
    for (const id of ["viewport", "typing"]) $(id).hidden = false;
    $("finish").disabled = $("stop").disabled = false;
    $("status").textContent = "Conecte a conta no Google. Depois clique em Concluir conexão.";
    await frame();
  } catch (e) { $("start").disabled = e.code === "login_blocked"; error(e); }
};
$("screen").onclick = event => {
  const rect = event.currentTarget.getBoundingClientRect();
  send({kind:"click", x:Math.round((event.clientX-rect.left)*event.currentTarget.naturalWidth/rect.width),
    y:Math.round((event.clientY-rect.top)*event.currentTarget.naturalHeight/rect.height)});
};
$("screen").onkeydown = event => {
  if (["Enter","Tab","Backspace","Escape","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Delete","Home","End","PageUp","PageDown"].includes(event.key)) {
    event.preventDefault(); send({kind:"key",key:event.key});
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
    event.preventDefault(); send({kind:"text",text:event.key});
  }
};
$("typing").onsubmit = event => {
  event.preventDefault(); const text = $("text").value; $("text").value = "";
  if (text) send({kind:"text",text});
};
for (const [id,key] of [["enter","Enter"],["tab","Tab"],["backspace","Backspace"],["page-up","PageUp"],["page-down","PageDown"]])
  $(id).onclick = () => send({kind:"key",key});
$("finish").onclick = async () => {
  $("finish").disabled = true;
  try { await serial; await request("finish"); active = false; $("viewport").hidden = $("typing").hidden = true;
    $("status").textContent = "Conta conectada. A fila salva será retomada. Você pode fechar esta janela.";
    $("start").disabled = false;
  } catch (e) { $("finish").disabled = false; error(e); }
};
$("stop").onclick = async () => {
  try { await request("stop"); active = false; $("viewport").hidden = $("typing").hidden = true;
    $("start").disabled = false; $("finish").disabled = $("stop").disabled = true;
    $("status").textContent = "Janela encerrada. A sessão do navegador permanece privada na VPS.";
  } catch (e) { error(e); }
};
$("blocked").onclick = async () => {
  $("blocked").disabled = true;
  try {
    await request("blocked"); active = false;
    $("viewport").hidden = $("typing").hidden = true;
    $("finish").disabled = $("stop").disabled = true;
    $("status").textContent = "Conexão remota encerrada. Importe abaixo uma sessão do navegador do seu PC.";
  } catch (e) { error(e); }
  finally { $("blocked").disabled = false; }
};
$("cookies").onchange = async event => {
  const input = event.target, file = input.files?.[0];
  if (!file) return;
  input.disabled = true;
  try {
    if (file.size > 100000) throw Error("O arquivo deve ter até 100 KB.");
    $("upload-status").textContent = "Validando arquivo de sessão…";
    const response = await fetch("/api/source/session", {method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({cookies:await file.text()}),cache:"no-store"});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Não foi possível importar a sessão.");
    if (active) {
      try { await request("stop"); } catch {}
      active = false;
      $("viewport").hidden = $("typing").hidden = true;
      $("finish").disabled = $("stop").disabled = true;
    }
    $("upload-status").textContent = "Sessão importada. A faixa que pausou a fonte será tentada novamente. Novas renovações desse arquivo precisam ser importadas pelo painel.";
  } catch (e) { $("upload-status").textContent = e.message; }
  finally { input.value = ""; input.disabled = false; }
};
setInterval(frame, 900);
