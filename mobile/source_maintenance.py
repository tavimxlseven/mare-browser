"""Bounded, persisted recovery using an isolated browser. Google login stays manual."""
import base64
import hashlib
import json
import os
from pathlib import Path
import threading
import time

from flask import abort, g, jsonify, request, session, Response
import source_browser
import source_session

KEY = "source_maintenance"
COOLDOWN = 600


class Maintenance:
    def __init__(self, db, data, wake):
        self.db, self.data, self.wake = db, data, wake
        self.event = threading.Event()
        self.lock = threading.RLock()

    def snapshot(self):
        with self.db() as con:
            row = con.execute("SELECT value FROM settings WHERE key=?", (KEY,)).fetchone()
        try:
            state = json.loads(row[0]) if row else {}
        except (ValueError, TypeError):
            state = {}
        path = os.getenv("NOISE_SOURCE_BROWSER_SOCKET", "/run/noise-source/control.sock")
        return {"state": "idle", "message": "Sessão aguardando verificação.", "updated": 0,
                "last_attempt": 0, "next_attempt": 0, **state, "browser_available": Path(path).is_socket()}

    def record(self, state, message, **changes):
        with self.lock:
            previous = self.snapshot()
            previous.pop("browser_available", None)
            previous.update(state=state, message=message, updated=time.time(), **changes)
            with self.db() as con:
                con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", (KEY, json.dumps(previous)))
            return previous

    def request(self, manual=False):
        with self.lock:
            state = self.snapshot()
            if state["state"] in ("queued", "refreshing"):
                return state
            if state["state"] in ("login_blocked", "needs_upload") or state.get("session_origin") == "upload":
                return self.record("needs_upload", "Use uma sessão do YouTube criada no navegador do seu PC e importe um novo cookies.txt pelo painel.")
            if not state["browser_available"]:
                return self.record("unavailable", "O navegador da fonte ainda não está configurado.")
            now = time.time()
            wait = 30 if manual else COOLDOWN
            if now - state["last_attempt"] < wait or state.get("reason") == "rate_limited" and now < state["next_attempt"]:
                return state
            result = self.record("queued", "Atualização da sessão solicitada.")
            self.event.set()
            return result

    def failure(self, reason="authentication"):
        state = self.snapshot()
        if reason == "rate_limited":
            self.record("waiting", "A fonte pediu uma pausa. A fila continua salva.",
                        reason=reason, next_attempt=time.time() + COOLDOWN)
            return
        if state["state"] in ("login_blocked", "needs_upload") or state.get("session_origin") == "upload":
            self.record("needs_upload", "A sessão importada foi recusada. Exporte um novo cookies.txt no navegador do seu PC e importe pelo painel.", reason=reason)
            return
        if time.time() - state["last_attempt"] < COOLDOWN:
            self.record("needs_login", "A fonte recusou a sessão atual. Reconecte a conta para verificar o acesso.", reason=reason)
            return
        self.request()

    def refresh(self):
        self.record("refreshing", "Consultando a sessão privada do navegador…", last_attempt=time.time(), reason="")
        try:
            response = source_browser.call("refresh")
            if not response.get("ok"):
                if response.get("error") == "interactive":
                    self.record("needs_login", "Conclua a conexão Google na janela de manutenção.")
                    return
                raise OSError("Browser unavailable")
            with self.lock:
                # An upload or manual connection completed during the browser
                # request takes precedence over this older automatic attempt.
                if self.snapshot()["state"] != "refreshing":
                    return
                try:
                    self.accept(response.get("cookies"))
                except ValueError:
                    self.record("needs_login", "Entre na conta Google pelo painel para conectar a fonte.")
                    return
        except Exception:
            self.record("unavailable", "Não foi possível acessar o navegador da fonte. Tente novamente mais tarde.")

    def success(self):
        if self.snapshot()["state"] == "refreshed":
            self.record("ready", "Sessão confirmada por um download concluído.")

    def accept(self, text, origin="browser"):
        with self.lock:
            source_session.install(self.data, text)
            self.record("refreshed", "Sessão atualizada. Confirmando no próximo download.",
                        last_attempt=time.time(), reason="", next_attempt=0, session_origin=origin)
            source_session.resume(self.db, self.wake)

    def start(self):
        state = self.snapshot()
        if state["state"] in ("queued", "refreshing"):
            self.record("idle", "Manutenção interrompida. A fila continua preservada.")
        with self.db() as con:
            blocked = bool(con.execute("SELECT 1 FROM settings WHERE key='blocked_track'").fetchone())
        if blocked:
            self.request()

        def worker():
            while True:
                self.event.wait(30)
                self.event.clear()
                state = self.snapshot()
                if state["state"] == "queued":
                    self.refresh()
                elif state["state"] == "waiting" and time.time() >= state["next_attempt"]:
                    self.record("idle", "Pausa encerrada. Retomando a fila salva.", reason="")
                    source_session.resume(self.db, self.wake)
        threading.Thread(target=worker, daemon=True).start()


def register(app, maintenance):
    def admin():
        if not g.user["is_admin"]:
            abort(403)

    def lease():
        return hashlib.sha256(session.get("token", "").encode()).hexdigest()

    @app.post("/api/source/refresh", endpoint="source_refresh")
    def refresh():
        admin()
        return jsonify(ok=True, maintenance=maintenance.request(manual=True)), 202

    @app.post("/api/source/browser/start", endpoint="source_browser_start")
    def start():
        admin()
        if maintenance.snapshot()["state"] in ("login_blocked", "needs_upload"):
            return jsonify(error="O Google recusou a conexão remota. Importe uma sessão do navegador do seu PC.", code="login_blocked"), 409
        try:
            response = source_browser.call("start", lease=lease())
        except Exception:
            return jsonify(error="O navegador da fonte está indisponível."), 503
        if not response.get("ok"):
            return jsonify(error="Já existe uma conexão em andamento. Tente novamente em alguns minutos."), 409
        maintenance.record("needs_login", "Conecte a conta Google e depois confirme no painel.")
        return jsonify(ok=True, url="/source-browser.html")

    @app.get("/api/source/browser/frame", endpoint="source_browser_frame")
    def frame():
        admin()
        try:
            response = source_browser.call("frame", lease=lease())
            if response.get("error") == "login_blocked":
                maintenance.record("login_blocked", "O Google recusou a conexão remota. Importe um cookies.txt criado no navegador do seu PC.")
                return jsonify(error="O Google bloqueou esse navegador. A janela foi encerrada; use a importação de cookies.txt abaixo.", code="login_blocked"), 409
            if not response.get("ok"):
                abort(409)
            image = base64.b64decode(response["image"], validate=True)
            if len(image) > 1_500_000 or not image.startswith(b"\xff\xd8"):
                abort(502)
        except (OSError, ValueError, KeyError):
            abort(503)
        return Response(image, mimetype="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.post("/api/source/browser/input", endpoint="source_browser_input")
    def input():
        admin()
        payload = request.get_json()
        if not isinstance(payload, dict) or payload.get("kind") not in ("click", "text", "key"):
            abort(400)
        safe = {key: payload[key] for key in ("x", "y", "text", "key") if key in payload}
        if len(json.dumps(safe)) > 4096:
            abort(400)
        try:
            result = source_browser.call(payload["kind"], lease=lease(), **safe)
        except Exception:
            abort(503)
        if not result.get("ok"):
            abort(409)
        return jsonify(ok=True)

    @app.post("/api/source/browser/finish", endpoint="source_browser_finish")
    def finish():
        admin()
        try:
            response = source_browser.call("extract", lease=lease())
            if not response.get("ok"):
                abort(409)
            try:
                maintenance.accept(response.get("cookies"))
            except ValueError:
                return jsonify(error="O navegador ainda não tem uma sessão do YouTube conectada. Conclua o login e tente novamente."), 400
            source_browser.call("stop", lease=lease())
        except (OSError, ValueError):
            abort(503)
        maintenance.record("refreshed", "Conta conectada. Confirmando no próximo download.", last_attempt=time.time(), reason="")
        source_session.resume(maintenance.db, maintenance.wake)
        return jsonify(ok=True)

    @app.post("/api/source/browser/stop", endpoint="source_browser_stop")
    def stop():
        admin()
        try:
            source_browser.call("stop", lease=lease())
        except OSError:
            pass
        return jsonify(ok=True)

    @app.post("/api/source/browser/blocked", endpoint="source_browser_blocked")
    def blocked():
        admin()
        try:
            source_browser.call("stop", lease=lease())
        except OSError:
            pass
        maintenance.record("login_blocked", "O Google recusou a conexão remota. Entre no YouTube pelo navegador do seu PC e importe o cookies.txt aqui.")
        return jsonify(ok=True)
