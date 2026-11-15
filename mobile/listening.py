"""Private PC streaming and invite-only shared listening. No account tokens in media URLs."""
import hashlib
import json
import secrets
import time

from flask import abort, g, jsonify, request, send_file
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
import accounts
import devices
import provider


def initialize(con):
    con.executescript("""
        CREATE TABLE IF NOT EXISTS listening_rooms(
          id TEXT PRIMARY KEY,invite_hash TEXT UNIQUE,owner TEXT,device TEXT,
          created REAL,updated REAL,revision INTEGER,player TEXT,closed INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS listening_members(
          owner TEXT PRIMARY KEY,room TEXT,joined REAL,seen REAL);
    """)


def membership(con, owner):
    return con.execute("""SELECT r.* FROM listening_rooms r JOIN listening_members m ON m.room=r.id
        WHERE m.owner=? AND r.closed=0 AND r.created>?""", (owner, time.time()-86400)).fetchone()


def access(con, owner, identifier):
    if con.execute("SELECT 1 FROM user_tracks WHERE owner=? AND track_id=?", (owner, identifier)).fetchone():
        return owner
    room = membership(con, owner)
    if room and json.loads(room["player"]).get("track_id") == identifier:
        if con.execute("SELECT 1 FROM user_tracks WHERE owner=? AND track_id=?", (room["owner"], identifier)).fetchone():
            return room["owner"]
    return None


def publish(con, owner, device, player):
    room = membership(con, owner)
    if not room or room["owner"] != owner or room["device"] != device:
        return
    if player.get("track_id") and not con.execute("SELECT 1 FROM user_tracks WHERE owner=? AND track_id=?", (owner, player["track_id"])).fetchone():
        return
    previous = json.loads(room["player"])
    expected = previous.get("position_ms", 0) + (max(0, time.time()-room["updated"])*1000 if previous.get("state") == "playing" else 0)
    changed = any(previous.get(k) != player.get(k) for k in ("track_id", "state", "queue")) or abs(expected-player.get("position_ms", 0)) > 1500
    con.execute("UPDATE listening_rooms SET player=?,updated=?,revision=revision+? WHERE id=?", (json.dumps(player), time.time(), int(changed), room["id"]))


def snapshot(con, owner):
    room = membership(con, owner)
    if not room:
        return dict(active=False)
    now = time.time()
    con.execute("UPDATE listening_members SET seen=? WHERE owner=?", (now, owner))
    player = json.loads(room["player"])
    track = con.execute("SELECT id,title,artist,art,duration_ms,status FROM tracks WHERE id=?", (player.get("track_id"),)).fetchone()
    host = con.execute("SELECT last_seen FROM music_devices WHERE id=? AND owner=?", (room["device"], room["owner"])).fetchone()
    online = bool(host and now-host["last_seen"] < 30)
    if player.get("state") == "playing" and online:
        player["position_ms"] = min(player.get("duration_ms") or 86400000, player.get("position_ms", 0)+int(max(0, now-room["updated"])*1000))
    elif not online:
        player["state"] = "paused"
    members = [dict(name=r["username"],host=r["owner"] == room["owner"],online=now-r["seen"] < 25)
               for r in con.execute("SELECT m.owner,m.seen,u.username FROM listening_members m JOIN users u ON u.id=m.owner WHERE m.room=? ORDER BY m.joined", (room["id"],))]
    return dict(active=True,id=room["id"],host=room["owner"] == owner,host_online=online,
                revision=room["revision"],player=player,track=dict(track) if track else None,members=members)


def register(app, db, media, enqueue_tracks, wake):
    signer = URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="noise-stream-v1")

    @app.post("/api/devices/stream")
    def stream_ticket():
        identifier = request.get_json().get("track_id")
        if not isinstance(identifier, str) or not provider.ID.fullmatch(identifier):
            abort(400)
        device = getattr(g, "device", None)
        if not device:
            abort(403)
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            owner = access(con, g.user["id"], identifier)
            if not owner:
                abort(404)
            track = con.execute("SELECT * FROM tracks WHERE id=?", (identifier,)).fetchone()
            if not track:
                abort(404)
            if track["status"] == "ready" and (media/(identifier+".m4a")).is_file():
                ticket = signer.dumps(dict(owner=g.user["id"],device=device,track=identifier))
                return jsonify(state="ready",path="/stream/"+ticket+"/"+identifier,expires_in=3600)
            if track["status"] == "failed":
                return jsonify(state="failed",error="Esta faixa não pôde ser preparada. Verifique a fonte de áudio nos ajustes e tente prepará-la novamente.")
            if track["status"] == "ready":
                con.execute("UPDATE tracks SET status='new' WHERE id=?", (identifier,))
            if track["status"] not in ("queued", "preparing"):
                enqueue_tracks(con, [dict(track)], owner=owner)
        wake.set()
        return jsonify(state="preparing")

    @app.route("/stream/<ticket>/<identifier>", methods=["GET", "HEAD"])
    def stream_media(ticket, identifier):
        if not provider.ID.fullmatch(identifier) or len(ticket) > 700:
            abort(404)
        try:
            grant = signer.loads(ticket, max_age=3600)
        except (BadSignature, SignatureExpired):
            abort(403)
        if not isinstance(grant, dict) or grant.get("track") != identifier:
            abort(403)
        with db() as con:
            if not con.execute("SELECT 1 FROM music_devices d JOIN users u ON u.id=d.owner WHERE d.id=? AND d.owner=?", (grant.get("device"), grant.get("owner"))).fetchone():
                abort(403)
            if not access(con, grant.get("owner"), identifier):
                abort(403)
            track = con.execute("SELECT status FROM tracks WHERE id=?", (identifier,)).fetchone()
        path = media/(identifier+".m4a")
        if not track or track["status"] != "ready" or not path.is_file():
            abort(404)
        response = send_file(path, mimetype="audio/mp4", conditional=True)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.post("/api/listening/<operation>")
    def listening(operation):
        if operation not in ("create", "join", "state", "leave", "close"):
            abort(404)
        device = getattr(g, "device", None)
        if not device:
            abort(403)
        raw = request.get_json()
        owner = g.user["id"]
        code = None
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            if operation in ("create", "join"):
                accounts.throttle()
                old = membership(con, owner)
                if operation == "join":
                    code = str(raw.get("code", "")).strip().replace("-", "").replace("–", "").replace("—", "").replace(" ", "").upper()
                    if len(code) != 10:
                        abort(400)
                    room = con.execute("SELECT * FROM listening_rooms WHERE invite_hash=? AND closed=0 AND created>?", (hashlib.sha256(code.encode()).hexdigest(), time.time()-86400)).fetchone()
                    if not room:
                        abort(404)
                    if con.execute("SELECT count(*) FROM listening_members WHERE room=?", (room["id"],)).fetchone()[0] >= 8 and (not old or old["id"] != room["id"]):
                        abort(409)
                    identifier = room["id"]
                else:
                    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(10))
                    identifier = secrets.token_hex(12)
                if old and old["id"] != identifier and old["owner"] == owner:
                    con.execute("UPDATE listening_rooms SET closed=1 WHERE id=?", (old["id"],))
                if operation == "create":
                    con.execute("INSERT INTO listening_rooms VALUES (?,?,?,?,?,?,1,'{}',0)", (identifier,hashlib.sha256(code.encode()).hexdigest(),owner,device,time.time(),time.time()))
                    publish_player = devices.player_state(raw.get("player", {}))
                    con.execute("INSERT OR REPLACE INTO listening_members VALUES (?,?,?,?)", (owner,identifier,time.time(),time.time()))
                    publish(con,owner,device,publish_player)
                else:
                    con.execute("INSERT OR REPLACE INTO listening_members VALUES (?,?,?,?)", (owner,identifier,time.time(),time.time()))
            elif operation in ("leave", "close"):
                room = membership(con, owner)
                if room and room["owner"] == owner:
                    con.execute("UPDATE listening_rooms SET closed=1 WHERE id=?", (room["id"],))
                elif operation == "close":
                    abort(403)
                con.execute("DELETE FROM listening_members WHERE owner=?", (owner,))
            elif operation == "state":
                room = membership(con, owner)
                if room and room["owner"] == owner and room["device"] == device:
                    publish(con, owner, device, devices.player_state(raw.get("player", {})))
            # Invites and stale rooms are bounded without touching anyone's library or audio.
            con.execute("DELETE FROM listening_members WHERE room IN (SELECT id FROM listening_rooms WHERE created<? OR closed=1)", (time.time()-86400,))
            con.execute("DELETE FROM listening_rooms WHERE created<? OR closed=1", (time.time()-86400,))
            result = snapshot(con, owner)
        if code and operation == "create":
            result["code"] = code
        return jsonify(result)
