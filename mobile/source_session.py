"""Admin-only session replacement. Never expose cookie contents or filesystem paths."""
import http.cookiejar
import os
from pathlib import Path
import tempfile

from flask import abort, g, jsonify, request


def session_path(data):
    configured = os.getenv("SUNNIFY_COOKIES_FILE", "").strip()
    return Path(configured) if configured else Path(data) / "private" / "youtube-cookies.txt"


def validate(path):
    jar = http.cookiejar.MozillaCookieJar(str(path))
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
    except (OSError, ValueError, http.cookiejar.LoadError):
        raise ValueError("Use um arquivo cookies.txt no formato Netscape.") from None
    cookies = [c for c in jar if c.domain.lstrip(".") in ("youtube.com", "www.youtube.com")]
    if not cookies:
        raise ValueError("O arquivo não contém uma sessão do YouTube.")
    login = [c for c in cookies if c.name in ("SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID")]
    if not login or not any(not c.is_expired() for c in login):
        raise ValueError("A sessão não está autenticada ou já expirou. Exporte uma sessão nova.")
    return cookies


def install(data, text):
    if not isinstance(text, str) or not 20 < len(text.encode("utf-8")) <= 100_000:
        raise ValueError("Use um arquivo cookies.txt de até 100 KB.")
    path = session_path(data)
    if path.is_symlink():
        raise ValueError("A configuração da sessão precisa de manutenção.")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix=".session-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as file:
            file.write(text.replace("\r\n", "\n"))
            file.flush()
            os.fsync(file.fileno())
        validate(name)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def resume(db, wake):
    with db() as con:
        blocked = con.execute("SELECT value FROM settings WHERE key='blocked_track'").fetchone()
        if blocked:
            con.execute("UPDATE tracks SET status='queued',error='' WHERE id=? AND status='error'", (blocked[0],))
        con.execute("DELETE FROM settings WHERE key='blocked_track'")
    wake.set()


def register(app, db, data, wake, maintenance=None):
    @app.get("/api/source/session")
    def status():
        if not g.user["is_admin"]:
            abort(403)
        path = session_path(data)
        configured = path.is_file() and not path.is_symlink()
        valid = False
        if configured:
            try:
                validate(path)
                valid = True
            except ValueError:
                pass
        with db() as con:
            paused = bool(con.execute("SELECT 1 FROM settings WHERE key='blocked_track'").fetchone())
        return jsonify(configured=configured, locally_valid=valid, paused=paused,
                       updated=path.stat().st_mtime if configured else 0,
                       automatic_login=False, maintenance=maintenance.snapshot() if maintenance else None)

    @app.post("/api/source/session")
    def replace():
        if not g.user["is_admin"]:
            abort(403)
        payload = request.get_json()
        text = payload.get("cookies") if isinstance(payload, dict) else None
        try:
            if maintenance:
                maintenance.accept(text, origin="upload")
            else:
                install(data, text)
                resume(db, wake)
        except ValueError as error:
            return jsonify(error=str(error)), 400
        return jsonify(ok=True)
