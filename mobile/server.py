"""Single-process private music server. Persistent SQLite queue, bounded Sunnify worker."""

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import tempfile
import threading
import time
from datetime import timedelta

from flask import (
    Flask,
    abort,
    jsonify,
    request,
    send_file,
    send_from_directory,
    session,
)
from werkzeug.security import check_password_hash
import provider

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv("MARE_DATA", ROOT / "state")).resolve()
DATA.mkdir(parents=True, exist_ok=True)
MEDIA = DATA / "media"
MEDIA.mkdir(exist_ok=True)
ORIGIN = os.getenv("MARE_ORIGIN", "http://localhost:8787").rstrip("/")
app = Flask(__name__, static_folder=None)
secret = DATA / "session.key"
if not secret.exists():
    fd = os.open(secret, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(secrets.token_hex(32))
app.config.update(
    SECRET_KEY=secret.read_text(),
    MAX_CONTENT_LENGTH=131072,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=ORIGIN.startswith("https:"),
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)
wake = threading.Event()
attempts = {}
auth_lock = threading.Lock()


@contextmanager
def db():
    connection = sqlite3.connect(DATA / "library.sqlite", timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


with db() as con:
    con.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY,title TEXT,artist TEXT,art TEXT,
          status TEXT DEFAULT 'new',error TEXT DEFAULT '',liked INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,name TEXT,tracks TEXT);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT,source TEXT,
          name TEXT,tracks TEXT DEFAULT '[]',status TEXT DEFAULT 'queued',
          message TEXT DEFAULT '',created REAL,updated REAL);
        CREATE INDEX IF NOT EXISTS jobs_source ON jobs(source);
    """)
    con.execute("UPDATE tracks SET status='queued' WHERE status='preparing'")
    con.execute("UPDATE jobs SET status='queued' WHERE status='importing'")


def recover_preparations():
    """Reconcile files promoted before a crash and remove only our abandoned work dirs."""
    with db() as con:
        for row in con.execute("SELECT id,status FROM tracks").fetchall():
            if not provider.ID.fullmatch(row["id"]):
                continue
            path = MEDIA / (row["id"] + ".m4a")
            complete = path.is_file() and path.stat().st_size > 0
            if complete and row["status"] in ("preparing", "queued"):
                con.execute(
                    "UPDATE tracks SET status='ready',error='' WHERE id=?", (row["id"],)
                )
            elif not complete and row["status"] == "ready":
                con.execute(
                    "UPDATE tracks SET status='queued' WHERE id=?", (row["id"],)
                )
        known = {
            identifier
            for job in con.execute("SELECT tracks FROM jobs")
            for identifier in json.loads(job["tracks"])
        }
        legacy = [
            t["id"]
            for t in con.execute("SELECT id FROM tracks WHERE status='queued'")
            if t["id"] not in known
        ]
        if legacy:
            create_job(con, "prepare", "", "Preparando músicas", legacy)
    for path in DATA.glob("prepare-*"):
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)


@app.before_request
def protect():
    if not request.path.startswith(("/api/", "/media/")):
        return
    if request.method != "GET" and request.headers.get("Origin") != ORIGIN:
        abort(403)
    if request.path == "/api/login":
        return
    token = session.get("token", "")
    with db() as con:
        valid = con.execute(
            "SELECT token FROM sessions WHERE token=? AND expires>?",
            (hashlib.sha256(token.encode()).hexdigest(), time.time()),
        ).fetchone()
    if not valid:
        abort(401)


@app.after_request
def headers(response):
    response.headers.update(
        {
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'self'; img-src 'self' https://i.scdn.co https://image-cdn-ak.spotifycdn.com data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        }
    )
    if request.path.startswith(("/api/", "/media/")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(Exception)
def error(ex):
    from werkzeug.exceptions import HTTPException

    code = ex.code if isinstance(ex, HTTPException) else 502
    if code >= 500:
        app.logger.warning("Operation failed (%s)", type(ex).__name__)
    message = {
        401: "Entre novamente para acessar a VM.",
        403: "Solicitação recusada.",
        404: "Não encontrado.",
        503: "Downloads pausados pela fonte de áudio. Tente novamente em Ajustes.",
        429: "Aguarde antes de tentar novamente.",
    }.get(code, "Não foi possível concluir. Verifique a conexão e tente novamente.")
    return jsonify(error=message), code


@app.post("/api/login")
def login():
    # Global limiter is appropriate for this single-user private installation.
    with auth_lock:
        bucket = int(time.time() // 60)
        if bucket not in attempts:
            attempts.clear()
        attempts[bucket] = attempts.get(bucket, 0) + 1
        if attempts[bucket] > 10:
            abort(429)
    data = request.get_json()
    hashed = os.getenv("MARE_PASSWORD_HASH", "")
    if not hashed or not check_password_hash(hashed, str(data.get("password", ""))):
        abort(401)
    token = secrets.token_urlsafe(32)
    with db() as con:
        con.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
        con.execute(
            "INSERT INTO sessions VALUES (?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), time.time() + 30 * 86400),
        )
    session.clear()
    session.permanent = True
    session["token"] = token
    return jsonify(ok=True)


@app.post("/api/logout")
def logout():
    with db() as con:
        con.execute(
            "DELETE FROM sessions WHERE token=?",
            (hashlib.sha256(session.get("token", "").encode()).hexdigest(),),
        )
    session.clear()
    return jsonify(ok=True)


@app.get("/api/library")
def library():
    with db() as con:
        con.execute("BEGIN")
        tracks = [
            dict(t) for t in con.execute("SELECT * FROM tracks ORDER BY rowid DESC")
        ]
        lists = [
            dict(p) for p in con.execute("SELECT * FROM playlists ORDER BY rowid DESC")
        ]
        blocked = con.execute(
            "SELECT value FROM settings WHERE key='blocked_track'"
        ).fetchone()
        jobs = [
            dict(j)
            for j in con.execute("SELECT * FROM jobs ORDER BY created DESC LIMIT 50")
        ]
    for p in lists:
        p["tracks"] = json.loads(p["tracks"])
    return jsonify(
        tracks=tracks,
        playlists=lists,
        preparation={"paused": bool(blocked)},
        jobs=job_snapshots(tracks, bool(blocked), jobs),
    )


@app.get("/api/search")
def search():
    q = request.args.get("q", "").strip()
    if not 2 <= len(q) <= 150:
        abort(400)
    return jsonify(tracks=provider.search(q))


def save_tracks(con, tracks):
    for t in tracks:
        con.execute(
            """INSERT INTO tracks(id,title,artist,art) VALUES (:id,:title,:artist,:art)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title,artist=excluded.artist,
          art=CASE WHEN excluded.art!='' THEN excluded.art ELSE tracks.art END""",
            t,
        )


@app.post("/api/import")
def import_link():
    try:
        _, _, source = provider.normalize_link(
            str(request.get_json().get("url", "")).strip()
        )
    except ValueError:
        return (
            jsonify(
                error="Cole um link público de playlist, álbum ou música do Spotify."
            ),
            400,
        )
    with db() as con:
        # Serialize the check and insert so double taps and retries share one job.
        con.execute("BEGIN IMMEDIATE")
        existing = con.execute(
            "SELECT id FROM jobs WHERE source=? AND kind='import' AND status IN ('queued','importing','preparing') ORDER BY created DESC LIMIT 1",
            (source,),
        ).fetchone()
        if existing:
            return jsonify(ok=True, job_id=existing["id"]), 202
        identifier = create_job(con, "import", source, "Importando playlist", [])
    wake.set()
    return jsonify(ok=True, job_id=identifier), 202


def create_job(con, kind, source, name, ids):
    identifier = secrets.token_hex(12)
    now = time.time()
    con.execute(
        "INSERT INTO jobs(id,kind,source,name,tracks,status,created,updated) VALUES (?,?,?,?,?,?,?,?)",
        (
            identifier,
            kind,
            source,
            name,
            json.dumps(list(dict.fromkeys(ids))),
            "queued" if kind == "import" else "preparing",
            now,
            now,
        ),
    )
    return identifier


def enqueue_tracks(con, tracks, name="Preparando músicas", source=""):
    ids = list(dict.fromkeys(t["id"] for t in tracks))
    save_tracks(con, tracks)
    for identifier in ids:
        con.execute(
            "UPDATE tracks SET status='queued',error='' WHERE id=? AND status NOT IN ('queued','preparing','ready')",
            (identifier,),
        )
    existing = con.execute(
        "SELECT id,tracks FROM jobs WHERE kind='prepare' AND status='preparing' ORDER BY created DESC"
    ).fetchall()
    for job in existing:
        if json.loads(job["tracks"]) == ids:
            return job["id"]
    return create_job(con, "prepare", source, name, ids)


def job_snapshots(tracks, paused, jobs):
    by_id = {t["id"]: t for t in tracks}
    for job in jobs:
        stored_status = job["status"]
        ids = json.loads(job.pop("tracks"))
        job["track_ids"] = ids
        items = [by_id[i] for i in ids if i in by_id]
        job["total"] = len(ids)
        job["ready"] = sum(t["status"] == "ready" for t in items)
        job["failed"] = sum(t["status"] == "error" for t in items)
        job["missing"] = len(ids) - len(items)
        job["current"] = next((t for t in items if t["status"] == "preparing"), None)
        if ids and job["status"] != "error":
            pending = any(t["status"] in ("new", "queued", "preparing") for t in items)
            job["status"] = (
                "paused"
                if paused and (pending or job["failed"])
                else (
                    "preparing"
                    if pending
                    else ("partial" if job["failed"] or job["missing"] else "complete")
                )
            )
            if (
                job["status"] in ("complete", "partial")
                and job["status"] != stored_status
            ):
                with db() as con:
                    con.execute(
                        "UPDATE jobs SET status=? WHERE id=?",
                        (job["status"], job["id"]),
                    )
    return jobs


def import_job(job):
    try:
        kind, identifier, name, tracks = provider.collection(job["source"])
        ids = list(dict.fromkeys(t["id"] for t in tracks))
        with db() as con:
            save_tracks(con, tracks)
            if kind != "track":
                con.execute(
                    "INSERT OR REPLACE INTO playlists VALUES (?,?,?)",
                    (identifier, name or "Playlist importada", json.dumps(ids)),
                )
            for track_id in ids:
                con.execute(
                    "UPDATE tracks SET status='queued',error='' WHERE id=? AND status NOT IN ('queued','preparing','ready')",
                    (track_id,),
                )
            con.execute(
                "UPDATE jobs SET name=?,tracks=?,status='preparing',updated=? WHERE id=?",
                (name or tracks[0]["title"], json.dumps(ids), time.time(), job["id"]),
            )
    except Exception:
        app.logger.warning("Playlist import failed")
        with db() as con:
            con.execute(
                "UPDATE jobs SET status='error',message=?,updated=? WHERE id=?",
                (
                    "Não foi possível ler a playlist. Confirme se ela é pública e tente importar novamente.",
                    time.time(),
                    job["id"],
                ),
            )


@app.post("/api/playlists/<identifier>/prepare")
def prepare_playlist(identifier):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        playlist = con.execute(
            "SELECT * FROM playlists WHERE id=?", (identifier,)
        ).fetchone()
        if not playlist:
            abort(404)
        ids = json.loads(playlist["tracks"])
        all_tracks = {t["id"]: dict(t) for t in con.execute("SELECT * FROM tracks")}
        tracks = [all_tracks[i] for i in ids if i in all_tracks]
        if not tracks:
            abort(400)
        job_id = enqueue_tracks(con, tracks, playlist["name"], identifier)
    wake.set()
    return jsonify(ok=True, job_id=job_id), 202


@app.post("/api/playlists")
def playlist():
    data = request.get_json()
    name = str(data.get("name", "")).strip()[:100]
    if not name:
        abort(400)
    ids = data.get("tracks", [])
    if (
        not isinstance(ids, list)
        or len(ids) > 2000
        or any(not isinstance(i, str) or not provider.ID.fullmatch(i) for i in ids)
    ):
        abort(400)
    identifier = data.get("id") or secrets.token_hex(12)
    if not isinstance(identifier, str) or len(identifier) > 64:
        abort(400)
    with db() as con:
        con.execute(
            "INSERT OR REPLACE INTO playlists VALUES (?,?,?)",
            (identifier, name, json.dumps(ids)),
        )
    return jsonify(ok=True)


@app.post("/api/prepare")
def prepare():
    data = request.get_json()
    tracks = data.get("tracks", [])
    if not isinstance(tracks, list) or not 1 <= len(tracks) <= 2000:
        abort(400)
    normalized = [provider.track(t) if isinstance(t, dict) else None for t in tracks]
    if any(t is None for t in normalized):
        abort(400)
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        job_id = enqueue_tracks(con, normalized)
    wake.set()
    return jsonify(ok=True, job_id=job_id), 202


@app.post("/api/tracks/<identifier>")
def update_track(identifier):
    with db() as con:
        data = request.get_json()
        if data.get("action") == "delete":
            current = con.execute(
                "SELECT status FROM tracks WHERE id=?", (identifier,)
            ).fetchone()
            if current and current["status"] in ("preparing", "queued"):
                abort(409)
            for p in con.execute("SELECT * FROM playlists").fetchall():
                ids = [i for i in json.loads(p["tracks"]) if i != identifier]
                con.execute(
                    "UPDATE playlists SET tracks=? WHERE id=?",
                    (json.dumps(ids), p["id"]),
                )
            con.execute("DELETE FROM tracks WHERE id=?", (identifier,))
            if provider.ID.fullmatch(identifier):
                (MEDIA / (identifier + ".m4a")).unlink(missing_ok=True)
        else:
            con.execute(
                "UPDATE tracks SET liked=? WHERE id=?",
                (bool(data.get("liked")), identifier),
            )
    return jsonify(ok=True)


@app.get("/media/<identifier>")
def media(identifier):
    if not provider.ID.fullmatch(identifier):
        abort(404)
    with db() as con:
        t = con.execute(
            "SELECT status FROM tracks WHERE id=?", (identifier,)
        ).fetchone()
    path = MEDIA / (identifier + ".m4a")
    if not t or t["status"] != "ready" or not path.is_file():
        abort(404)
    return send_file(path, mimetype="audio/mp4", conditional=True)


@app.get("/")
def index():
    return send_from_directory(ROOT / "public", "index.html")


@app.get("/<path:filename>")
def static(filename):
    return send_from_directory(ROOT / "public", filename)


@app.post("/api/resume")
def resume_preparation():
    with db() as con:
        blocked = con.execute(
            "SELECT value FROM settings WHERE key='blocked_track'"
        ).fetchone()
        if blocked:
            con.execute(
                "UPDATE tracks SET status='queued',error='' WHERE id=? AND status='error'",
                (blocked["value"],),
            )
        con.execute("DELETE FROM settings WHERE key='blocked_track'")
    wake.set()
    return jsonify(ok=True)


def prepare_track(identifier):
    try:
        if shutil.disk_usage(DATA).free < 1_073_741_824:
            raise OSError("disk")
        with tempfile.TemporaryDirectory(prefix="prepare-", dir=DATA) as temp:
            audio = provider.download(identifier, temp)
            with audio.open("rb") as complete_file:
                os.fsync(complete_file.fileno())
            os.replace(audio, MEDIA / (identifier + ".m4a"))
        with db() as con:
            con.execute(
                "UPDATE tracks SET status='ready',error='' WHERE id=?", (identifier,)
            )
    except Exception as ex:
        app.logger.warning("Preparation failed (%s)", type(ex).__name__)
        with db() as con:
            message = (
                str(ex)
                if isinstance(ex, provider.PreparationError)
                else "Falha ao preparar. Tente novamente."
            )
            con.execute(
                "UPDATE tracks SET status='error',error=? WHERE id=?",
                (message, identifier),
            )
            if isinstance(ex, provider.PreparationError):
                con.execute(
                    "INSERT OR REPLACE INTO settings VALUES ('blocked_track',?)",
                    (identifier,),
                )


def worker():
    while True:
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            metadata = con.execute(
                "SELECT * FROM jobs WHERE kind='import' AND status='queued' ORDER BY created LIMIT 1"
            ).fetchone()
            if metadata:
                con.execute(
                    "UPDATE jobs SET status='importing',updated=? WHERE id=?",
                    (time.time(), metadata["id"]),
                )
            blocked = con.execute(
                "SELECT value FROM settings WHERE key='blocked_track'"
            ).fetchone()
            job = None
            if not blocked and not metadata:
                job = con.execute(
                    "SELECT id FROM tracks WHERE status='queued' ORDER BY rowid LIMIT 1"
                ).fetchone()
            if job:
                con.execute(
                    "UPDATE tracks SET status='preparing' WHERE id=?", (job["id"],)
                )
        if metadata:
            import_job(dict(metadata))
            continue
        if not job:
            wake.wait(30)
            wake.clear()
            continue
        prepare_track(job["id"])


if __name__ == "__main__":
    if not os.getenv("MARE_PASSWORD_HASH"):
        raise SystemExit("MARE_PASSWORD_HASH is required")
    recover_preparations()
    threading.Thread(target=worker, daemon=True).start()
    from waitress import serve

    serve(app, host="127.0.0.1", port=int(os.getenv("PORT", "8787")), threads=6)
