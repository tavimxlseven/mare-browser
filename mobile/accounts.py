"""Invitation-only accounts and an atomic migration of the former shared library."""

import hashlib
import os
import re
import secrets
import sqlite3
import threading
import time

from flask import abort, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

ADMIN_ID = "admin"
USERNAME = re.compile(r"[A-Za-z0-9_.-]{3,32}")
attempts = {}
attempt_lock = threading.Lock()


def initialize(con):
    con.executescript("""
        CREATE TABLE IF NOT EXISTS users(
          id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,is_admin INTEGER NOT NULL DEFAULT 0,created REAL);
        CREATE TABLE IF NOT EXISTS invites(
          id TEXT PRIMARY KEY,code_hash TEXT UNIQUE NOT NULL,created_by TEXT NOT NULL,
          expires REAL NOT NULL,used_by TEXT,revoked INTEGER NOT NULL DEFAULT 0,created REAL);
        CREATE TABLE IF NOT EXISTS user_tracks(
          owner TEXT NOT NULL REFERENCES users(id),track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
          liked INTEGER NOT NULL DEFAULT 0,created REAL,PRIMARY KEY(owner,track_id));
    """)
    con.execute("BEGIN IMMEDIATE")
    if not con.execute("SELECT id FROM users WHERE id=?", (ADMIN_ID,)).fetchone():
        hashed = os.getenv("MARE_PASSWORD_HASH", "")
        if not hashed:
            raise RuntimeError(
                "MARE_PASSWORD_HASH is required for initial administrator setup"
            )
        con.execute(
            "INSERT INTO users VALUES (?,?,?,?,?)",
            (
                ADMIN_ID,
                os.getenv("MARE_ADMIN_USERNAME", "admin"),
                hashed,
                1,
                time.time(),
            ),
        )
    playlist_columns = {r["name"] for r in con.execute("PRAGMA table_info(playlists)")}
    if "owner" not in playlist_columns:
        con.execute("ALTER TABLE playlists RENAME TO playlists_legacy")
        con.execute(
            "CREATE TABLE playlists(id TEXT,name TEXT,tracks TEXT,owner TEXT NOT NULL,PRIMARY KEY(owner,id))"
        )
        con.execute(
            "INSERT INTO playlists SELECT id,name,tracks,? FROM playlists_legacy",
            (ADMIN_ID,),
        )
        con.execute("DROP TABLE playlists_legacy")
        con.execute(
            "INSERT OR IGNORE INTO user_tracks SELECT ?,id,liked,? FROM tracks",
            (ADMIN_ID, time.time()),
        )
    for table in ("jobs", "sessions"):
        columns = {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}
        if "owner" not in columns:
            con.execute(
                f"ALTER TABLE {table} ADD COLUMN owner TEXT NOT NULL DEFAULT 'admin'"
            )
            if table == "sessions":
                # Old shared sessions cannot identify an individual.
                con.execute("DELETE FROM sessions")
    columns = {r["name"] for r in con.execute("PRAGMA table_info(tracks)")}
    if "art_checked" not in columns:
        con.execute("ALTER TABLE tracks ADD COLUMN art_checked REAL NOT NULL DEFAULT 0")


def identity(user):
    return dict(
        id=user["id"], username=user["username"], is_admin=bool(user["is_admin"])
    )


def authenticate(con):
    token = session.get("token", "")
    user = con.execute(
        """SELECT u.* FROM sessions s JOIN users u ON u.id=s.owner
        WHERE s.token=? AND s.expires>?""",
        (hashlib.sha256(token.encode()).hexdigest(), time.time()),
    ).fetchone()
    if not user:
        abort(401)
    g.user = identity(user)


def throttle():
    now = time.time()
    # The trusted loopback proxy overwrites this header with the client's IP.
    address = request.headers.get("X-Forwarded-For", request.remote_addr)
    key = (address or "")[:100]
    with attempt_lock:
        expired = [k for k, v in attempts.items() if v[0] < now - 60]
        for k in expired:
            del attempts[k]
        bucket = attempts.setdefault(key, [now, 0])
        bucket[1] += 1
        if bucket[1] > 15 or len(attempts) > 10000:
            abort(429)


def start_session(con, user):
    token = secrets.token_urlsafe(32)
    con.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
    con.execute(
        "INSERT INTO sessions(token,expires,owner) VALUES (?,?,?)",
        (
            hashlib.sha256(token.encode()).hexdigest(),
            time.time() + 30 * 86400,
            user["id"],
        ),
    )
    session.clear()
    session.permanent = True
    session["token"] = token
    return jsonify(ok=True, user=identity(user))


def register_routes(app, db):
    @app.post("/api/login")
    def login():
        throttle()
        data = request.get_json()
        username = str(data.get("username", "admin")).strip()
        with db() as con:
            user = con.execute(
                "SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)
            ).fetchone()
            if not user or not check_password_hash(
                user["password_hash"], str(data.get("password", ""))
            ):
                abort(401)
            return start_session(con, user)

    @app.post("/api/register")
    def register():
        throttle()
        data = request.get_json()
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        code = str(data.get("invite", "")).strip()
        if (
            not USERNAME.fullmatch(username)
            or not 10 <= len(password) <= 128
            or not 16 <= len(code) <= 100
        ):
            return (
                jsonify(
                    error="Use um usuário de 3 a 32 caracteres, uma senha de 10 a 128 caracteres e um convite válido."
                ),
                400,
            )
        hashed = generate_password_hash(password)
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            invite = con.execute(
                "SELECT * FROM invites WHERE code_hash=? AND used_by IS NULL AND revoked=0 AND expires>?",
                (hashlib.sha256(code.encode()).hexdigest(), time.time()),
            ).fetchone()
            if not invite:
                return jsonify(error="Convite inválido, expirado ou já utilizado."), 400
            if con.execute(
                "SELECT id FROM users WHERE username=? COLLATE NOCASE", (username,)
            ).fetchone():
                return jsonify(error="Esse nome de usuário já está em uso."), 409
            user_id = secrets.token_hex(16)
            con.execute(
                "INSERT INTO users VALUES (?,?,?,?,?)",
                (user_id, username, hashed, 0, time.time()),
            )
            con.execute(
                "UPDATE invites SET used_by=? WHERE id=?", (user_id, invite["id"])
            )
            user = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            return start_session(con, user), 201

    @app.get("/api/me")
    def me():
        return jsonify(user=g.user)

    @app.get("/api/admin/invites")
    def list_invites():
        if not g.user["is_admin"]:
            abort(403)
        with db() as con:
            rows = con.execute(
                "SELECT id,expires,used_by IS NOT NULL AS used,revoked,created FROM invites ORDER BY created DESC LIMIT 30"
            ).fetchall()
        return jsonify(invites=[dict(r) for r in rows])

    @app.post("/api/admin/invites")
    def create_invite():
        if not g.user["is_admin"]:
            abort(403)
        code = secrets.token_urlsafe(24)
        identifier = secrets.token_hex(12)
        now = time.time()
        with db() as con:
            con.execute(
                "INSERT INTO invites(id,code_hash,created_by,expires,created) VALUES (?,?,?,?,?)",
                (
                    identifier,
                    hashlib.sha256(code.encode()).hexdigest(),
                    g.user["id"],
                    now + 7 * 86400,
                    now,
                ),
            )
        return jsonify(code=code, id=identifier, expires=now + 7 * 86400), 201

    @app.post("/api/admin/invites/<identifier>/revoke")
    def revoke_invite(identifier):
        if not g.user["is_admin"]:
            abort(403)
        with db() as con:
            con.execute(
                "UPDATE invites SET revoked=1 WHERE id=? AND used_by IS NULL",
                (identifier,),
            )
        return jsonify(ok=True)
