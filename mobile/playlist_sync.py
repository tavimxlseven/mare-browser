"""Read-only public Spotify playlist refreshes; no account token or write access."""
import json
import time

from flask import abort, g, jsonify, request
import provider

INTERVAL = 1800


def initialize(con):
    columns = {row[1] for row in con.execute("PRAGMA table_info(playlists)")}
    for name, declaration in (
        ("sync_enabled", "INTEGER NOT NULL DEFAULT 1"),
        ("sync_checked", "REAL NOT NULL DEFAULT 0"),
        ("sync_success", "REAL NOT NULL DEFAULT 0"),
        ("sync_error", "TEXT NOT NULL DEFAULT ''"),
    ):
        if name not in columns:
            con.execute(f"ALTER TABLE playlists ADD COLUMN {name} {declaration}")


def eligible(source):
    try:
        return provider.normalize_link(source)[0] == "playlist"
    except ValueError:
        return False


def enqueue(con, playlist, create_job, force=False):
    existing = con.execute(
        "SELECT id FROM jobs WHERE owner=? AND source=? AND kind IN ('import','sync') "
        "AND status IN ('queued','importing') ORDER BY created DESC LIMIT 1",
        (playlist["owner"], playlist["source"]),
    ).fetchone()
    if existing:
        return existing["id"]
    now = time.time()
    if not force and now - playlist["sync_checked"] < INTERVAL:
        return None
    # Reserve the interval in the same transaction as the job, including failures.
    con.execute("UPDATE playlists SET sync_checked=? WHERE owner=? AND id=?",
                (now, playlist["owner"], playlist["id"]))
    return create_job(con, "sync", playlist["source"], playlist["name"], [], playlist["owner"])


def schedule(con, create_job):
    rows = con.execute(
        "SELECT * FROM playlists WHERE sync_enabled=1 AND source!='' AND sync_checked<? "
        "ORDER BY sync_checked LIMIT 10", (time.time() - INTERVAL,),
    ).fetchall()
    for playlist in rows:
        if eligible(playlist["source"]):
            return enqueue(con, playlist, create_job)
    return None


def decorate(playlist):
    playlist["spotify_sync"] = dict(
        available=eligible(playlist.get("source", "")),
        enabled=bool(playlist.pop("sync_enabled", 1)),
        checked=playlist.pop("sync_checked", 0),
        updated=playlist.pop("sync_success", 0),
        error=playlist.pop("sync_error", ""),
    )


def register(app, db, create_job, wake):
    @app.post("/api/playlists/<identifier>/sync")
    def refresh(identifier):
        payload = request.get_json()
        if not isinstance(payload, dict):
            abort(400)
        if "enabled" in payload and not isinstance(payload["enabled"], bool):
            abort(400)
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            playlist = con.execute("SELECT * FROM playlists WHERE owner=? AND id=?",
                                   (g.user["id"], identifier)).fetchone()
            if not playlist:
                abort(404)
            if not eligible(playlist["source"]):
                abort(400)
            if "enabled" in payload:
                con.execute("UPDATE playlists SET sync_enabled=? WHERE owner=? AND id=?",
                            (payload["enabled"], g.user["id"], identifier))
            job_id = enqueue(con, playlist, create_job, force=True) if payload.get("refresh") is True else None
        wake.set()
        return jsonify(ok=True, job_id=job_id), 202 if job_id else 200
