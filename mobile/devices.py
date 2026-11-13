"""Account-scoped library events and an outbound-only device control relay."""
import hashlib
import json
import re
import secrets
import time
from flask import abort, g, jsonify, request
import accounts
import provider
import playlist_metadata


def initialize(con):
    con.executescript("""
        CREATE TABLE IF NOT EXISTS device_codes(hash TEXT PRIMARY KEY,owner TEXT,expires REAL);
        CREATE TABLE IF NOT EXISTS music_devices(id TEXT PRIMARY KEY,owner TEXT,token_hash TEXT UNIQUE,
          name TEXT,kind TEXT,last_seen REAL,player TEXT DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS device_commands(id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner TEXT,target TEXT,payload TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS device_events(owner TEXT,id TEXT,created REAL,PRIMARY KEY(owner,id));
        CREATE TABLE IF NOT EXISTS music_playback(owner TEXT PRIMARY KEY,device_id TEXT,revision INTEGER DEFAULT 0);
    """)
    if "source" not in {row[1] for row in con.execute("PRAGMA table_info(playlists)")}:
        con.execute("ALTER TABLE playlists ADD COLUMN source TEXT DEFAULT ''")
    for field in ("art", "custom_name", "custom_art"):
        if field not in {row[1] for row in con.execute("PRAGMA table_info(playlists)")}:
            con.execute(f"ALTER TABLE playlists ADD COLUMN {field} TEXT DEFAULT ''")
    for job in con.execute("SELECT owner,source FROM jobs WHERE kind='import'").fetchall():
        try:
            _, identifier, source = provider.normalize_link(job["source"])
            con.execute("UPDATE playlists SET source=? WHERE owner=? AND id=? AND source=''", (source,job["owner"],identifier))
        except ValueError:
            pass


def bearer(con):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    if request.path not in ("/api/devices/sync", "/api/devices/commands", "/api/devices/disconnect", "/api/library"):
        abort(403)
    token = header[7:]
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        abort(401)
    row = con.execute("SELECT u.*,d.id AS device_id FROM music_devices d JOIN users u ON u.id=d.owner WHERE d.token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not row:
        abort(401)
    g.user = accounts.identity(row)
    g.device = row["device_id"]
    return True


def library(con, owner):
    tracks = [dict(row) for row in con.execute("SELECT t.id,t.title,t.artist,t.art,t.duration_ms,u.liked FROM tracks t JOIN user_tracks u ON u.track_id=t.id WHERE u.owner=? ORDER BY t.id", (owner,))]
    playlists = [dict(id=row["id"],name=row["name"],source=row["source"],tracks=json.loads(row["tracks"]),importing=bool(con.execute("SELECT 1 FROM jobs WHERE owner=? AND source=? AND kind IN ('import','sync') AND status IN ('queued','importing')",(owner,row["source"])).fetchone())) for row in con.execute("SELECT * FROM playlists WHERE owner=? ORDER BY id", (owner,))]
    for playlist in playlists:
        meta=con.execute("SELECT art,custom_name,custom_art FROM playlists WHERE owner=? AND id=?",(owner,playlist["id"])).fetchone()
        playlist.update(dict(meta))
        playlist_metadata.decorate(con,owner,playlist)
    return dict(tracks=tracks,playlists=playlists)


def device_list(con, owner):
    return [dict(id=row["id"],name=row["name"],kind=row["kind"],online=time.time()-row["last_seen"]<25,player=json.loads(row["player"])) for row in con.execute("SELECT * FROM music_devices WHERE owner=? ORDER BY name", (owner,))]


def playback_session(con, owner):
    row = con.execute("SELECT d.*,p.revision FROM music_playback p JOIN music_devices d ON d.id=p.device_id AND d.owner=p.owner WHERE p.owner=?", (owner,)).fetchone()
    if not row:
        return None
    now = time.time()
    return dict(device_id=row["id"],name=row["name"],kind=row["kind"],online=now-row["last_seen"]<25,
                player=json.loads(row["player"]),updated_at=row["last_seen"],server_time=now,revision=row["revision"])


def select_playback(con, owner, identifier, player, previous):
    activation = player.get("activation", 0)
    explicit = activation > previous.get("activation", 0)
    legacy_start = not activation and player["state"] == "playing" and (previous.get("state") != "playing" or previous.get("track_id") != player["track_id"])
    if not explicit and not legacy_start:
        return
    row = con.execute("SELECT device_id FROM music_playback WHERE owner=?", (owner,)).fetchone()
    con.execute("INSERT INTO music_playback(owner,device_id,revision) VALUES (?,?,1) ON CONFLICT(owner) DO UPDATE SET device_id=excluded.device_id,revision=revision+1", (owner,identifier))
    if row and row["device_id"] != identifier:
        previous_device=con.execute("SELECT player FROM music_devices WHERE owner=? AND id=?",(owner,row["device_id"])).fetchone()
        expected=json.loads(previous_device["player"]).get("activation",0) if previous_device else 0
        con.execute("INSERT INTO device_commands(owner,target,payload,created) VALUES (?,?,?,?)",
                    (owner,row["device_id"],json.dumps(dict(action="pause",expected_activation=expected)),time.time()))


def player_state(raw):
    if not isinstance(raw, dict):
        abort(400)
    result = {key:str(raw.get(key,""))[:300] for key in ("title","artist","art")}
    if not result["art"].startswith(("https://i.scdn.co/","https://image-cdn-ak.spotifycdn.com/")):
        result["art"] = ""
    result["track_id"] = raw.get("track_id") if isinstance(raw.get("track_id"),str) and provider.ID.fullmatch(raw["track_id"]) else None
    result["state"] = raw.get("state") if raw.get("state") in ("playing","paused","stopped") else "stopped"
    for key, maximum in (("position_ms",86400000),("duration_ms",86400000),("volume",100),("activation",2**53-1)):
        value = raw.get(key,0)
        if not isinstance(value,(int,float)) or isinstance(value,bool) or not 0<=value<=maximum:
            abort(400)
        result[key] = int(value)
    queue = raw.get("queue",[])
    if not isinstance(queue,list) or len(queue)>2000 or any(not isinstance(i,str) or not provider.ID.fullmatch(i) for i in queue):
        abort(400)
    result["queue"] = queue
    if isinstance(raw.get("source"),str) and re.fullmatch(r"[a-f0-9]{24}",raw["source"]):
        result["source"]=raw["source"]
    return result


def apply_event(con, owner, device, event, save_tracks, create_job, enqueue_tracks):
    kind = event.get("type")
    payload = event.get("data", {})
    if not isinstance(payload,dict): abort(400)
    # Older desktop builds emitted an empty Spotify ID for local YouTube entries.
    # Acknowledge that legacy marker without modifying any library or audio file.
    if kind in ("track", "delete_track") and payload.get("id") == "":
        return
    if kind == "track":
        track = provider.track(payload)
        if not track: abort(400)
        save_tracks(con,[track],owner)
        enqueue_tracks(con,[track],owner=owner)
        if "liked" in payload:
            con.execute("UPDATE user_tracks SET liked=? WHERE owner=? AND track_id=?", (bool(payload["liked"]),owner,track["id"]))
    elif kind == "source":
        try: source_kind, identifier, source = provider.normalize_link(str(payload.get("url","")))
        except ValueError: abort(400)
        if source_kind == "track":
            create_job(con,"import",source,"Importando música",[],owner)
        else:
            con.execute("INSERT OR IGNORE INTO playlists(id,name,tracks,owner,source) VALUES (?,?,?,?,?)", (identifier,str(payload.get("name","Playlist"))[:100],"[]",owner,source))
            existing = con.execute("SELECT 1 FROM jobs WHERE owner=? AND source=? AND kind IN ('import','sync') AND status IN ('queued','importing','preparing')",(owner,source)).fetchone()
            if not existing: create_job(con,"import",source,"Importando playlist",[],owner)
            if payload.get("art"):
                con.execute("UPDATE playlists SET art=? WHERE owner=? AND id=?",(playlist_metadata.artwork(payload["art"]),owner,identifier))
    elif kind == "playlist_meta":
        identifier=str(payload.get("id",""))
        if identifier.startswith("local:"): identifier="pc:"+device+":"+identifier[6:]
        playlist_metadata.update(con,owner,identifier,payload)
    elif kind in ("playlist", "order", "add", "remove", "delete_playlist"):
        identifier = str(payload.get("id",""))
        if identifier.startswith("local:"):
            identifier = "pc:"+device+":"+identifier[6:]
        if not identifier or len(identifier)>100 or not re.fullmatch(r"[A-Za-z0-9:_-]+",identifier): abort(400)
        row = con.execute("SELECT * FROM playlists WHERE owner=? AND id=?",(owner,identifier)).fetchone()
        if kind=="delete_playlist":
            con.execute("DELETE FROM playlists WHERE owner=? AND id=?",(owner,identifier)); return
        if kind=="playlist":
            name = str(payload.get("name","")).strip()[:100]
            if not name: abort(400)
            ids = payload.get("tracks",[])
        elif not row:
            return
        else:
            name = row["name"]
            ids = json.loads(row["tracks"])
            if kind=="order":
                proposed=payload.get("tracks",[])
                if not isinstance(proposed,list) or len(proposed)>2000 or any(not isinstance(i,str) or not provider.ID.fullmatch(i) for i in proposed): abort(400)
                ids=[i for i in proposed if i in ids]+[i for i in ids if i not in proposed]
            else:
                track=payload.get("track")
                if not isinstance(track,str) or not provider.ID.fullmatch(track): abort(400)
                ids=[i for i in ids if i!=track]
                if kind=="add": ids.append(track)
        if not isinstance(ids,list) or len(ids)>2000 or any(not isinstance(i,str) or not provider.ID.fullmatch(i) for i in ids): abort(400)
        ids=list(dict.fromkeys(ids))
        owned={r[0] for r in con.execute("SELECT track_id FROM user_tracks WHERE owner=?",(owner,))}
        if any(i not in owned for i in ids): abort(404)
        con.execute("INSERT INTO playlists(id,name,tracks,owner,track_order) VALUES (?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET name=excluded.name,tracks=excluded.tracks,track_order=excluded.track_order",(identifier,name,json.dumps(ids),owner,json.dumps(payload.get("tracks",ids) if kind=="order" else ids)))
        if kind=="playlist" and "art" in payload:
            playlist_metadata.update(con,owner,identifier,payload)
        if kind=="add":
            additions=json.loads(row["added_tracks"]) if row else []
            if payload["track"] not in additions: additions.append(payload["track"])
            con.execute("UPDATE playlists SET added_tracks=? WHERE owner=? AND id=?",(json.dumps(additions),owner,identifier))
        elif kind=="remove" and row:
            additions=[i for i in json.loads(row["added_tracks"]) if i!=payload["track"]]
            con.execute("UPDATE playlists SET added_tracks=? WHERE owner=? AND id=?",(json.dumps(additions),owner,identifier))
    elif kind=="delete_track":
        identifier = payload.get("id")
        if not isinstance(identifier,str) or not provider.ID.fullmatch(identifier): abort(400)
        con.execute("DELETE FROM user_tracks WHERE owner=? AND track_id=?",(owner,identifier))
        for playlist in con.execute("SELECT * FROM playlists WHERE owner=?",(owner,)).fetchall():
            ids=[i for i in json.loads(playlist["tracks"]) if i!=identifier]
            additions=[i for i in json.loads(playlist["added_tracks"]) if i!=identifier]
            order=[i for i in json.loads(playlist["track_order"]) if i!=identifier]
            con.execute("UPDATE playlists SET tracks=?,added_tracks=?,track_order=? WHERE owner=? AND id=?",(json.dumps(ids),json.dumps(additions),json.dumps(order),owner,playlist["id"]))
    else: abort(400)


def register(app, db, save_tracks, create_job, wake, enqueue_tracks):
    @app.post("/api/devices/pair")
    def pair():
        if getattr(g,"device",None): abort(403)
        accounts.throttle()
        code="".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8))
        with db() as con:
            con.execute("DELETE FROM device_codes WHERE owner=? OR expires<?",(g.user["id"],time.time()))
            con.execute("INSERT INTO device_codes VALUES (?,?,?)",(hashlib.sha256(code.encode()).hexdigest(),g.user["id"],time.time()+300))
        return jsonify(code=code,expires_in=300)

    @app.post("/api/devices/claim")
    def claim():
        accounts.throttle()
        raw=request.get_json();code=str(raw.get("code","")).replace("-","").replace(" ","").upper()
        token=secrets.token_urlsafe(32);identifier=secrets.token_hex(12)
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            match=con.execute("SELECT owner FROM device_codes WHERE hash=? AND expires>?",(hashlib.sha256(code.encode()).hexdigest(),time.time())).fetchone()
            if not match: abort(401)
            con.execute("DELETE FROM device_codes WHERE owner=?",(match["owner"],))
            con.execute("INSERT INTO music_devices(id,owner,token_hash,name,kind,last_seen) VALUES (?,?,?,?,?,?)",(identifier,match["owner"],hashlib.sha256(token.encode()).hexdigest(),str(raw.get("name","Meu PC"))[:60],"desktop",time.time()))
            user=accounts.identity(con.execute("SELECT * FROM users WHERE id=?",(match["owner"],)).fetchone())
        return jsonify(token=token,id=identifier,user=user)

    @app.post("/api/devices/login")
    def desktop_login():
        from werkzeug.security import check_password_hash
        accounts.throttle()
        raw=request.get_json()
        if not isinstance(raw,dict): abort(400)
        with db() as con:
            user=con.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE",(str(raw.get("username",""))[:32],)).fetchone()
            if not user or not check_password_hash(user["password_hash"],str(raw.get("password",""))[:128]): abort(401)
            token=secrets.token_urlsafe(32);identifier=secrets.token_hex(12)
            con.execute("INSERT INTO music_devices(id,owner,token_hash,name,kind,last_seen) VALUES (?,?,?,?,?,?)",(identifier,user["id"],hashlib.sha256(token.encode()).hexdigest(),"Noise no PC","desktop",time.time()))
        return jsonify(token=token,id=identifier,user=accounts.identity(user))

    @app.post("/api/devices/register")
    def web_register():
        identifier=secrets.token_hex(12)
        with db() as con:
            con.execute("INSERT INTO music_devices(id,owner,name,kind,last_seen) VALUES (?,?,?,?,?)",(identifier,g.user["id"],str(request.get_json().get("name","Meu celular"))[:60],"web",time.time()))
        return jsonify(id=identifier)

    @app.get("/api/devices")
    def list_devices():
        with db() as con: return jsonify(devices=device_list(con,g.user["id"]))

    @app.post("/api/devices/commands")
    def command():
        raw=request.get_json();target=raw.get("target");command=raw.get("command",{})
        if not isinstance(command,dict) or command.get("action") not in ("pause","resume","next","previous","volume","seek","transfer","select","queue"): abort(400)
        safe={"action":command["action"]}
        if safe["action"]=="transfer": safe["player"]=player_state(command.get("player",{}))
        if safe["action"]=="queue":
            safe["queue"]=player_state({"queue":command.get("queue",[])})["queue"]
        if safe["action"] in ("seek","volume") and ("position_ms" if safe["action"]=="seek" else "value") not in command: abort(400)
        for key,maximum in (("value",100),("position_ms",86400000),("expected_activation",2**53-1)):
            if key in command:
                if not isinstance(command[key],int) or isinstance(command[key],bool) or not 0<=command[key]<=maximum: abort(400)
                safe[key]=command[key]
        with db() as con:
            if not con.execute("SELECT id FROM music_devices WHERE id=? AND owner=?",(target,g.user["id"])).fetchone(): abort(404)
            if con.execute("SELECT count(*) FROM device_commands WHERE owner=? AND created>?",(g.user["id"],time.time()-10)).fetchone()[0]>30: abort(429)
            con.execute("INSERT INTO device_commands(owner,target,payload,created) VALUES (?,?,?,?)",(g.user["id"],target,json.dumps(safe),time.time()))
        return jsonify(ok=True)

    @app.post("/api/devices/sync")
    def sync():
        raw=request.get_json();owner=g.user["id"];identifier=getattr(g,"device",None) or raw.get("id")
        with db() as con:
            con.execute("BEGIN IMMEDIATE")
            row=con.execute("SELECT * FROM music_devices WHERE id=? AND owner=?",(identifier,owner)).fetchone()
            if not row or (not getattr(g,"device",None) and row["kind"]!="web"): abort(404)
            events=raw.get("events",[])
            if not isinstance(events,list) or len(events)>100 or (events and not getattr(g,"device",None)): abort(400)
            accepted=[]
            for event in events:
                if not isinstance(event,dict) or not re.fullmatch(r"[A-Fa-f0-9]{32}",str(event.get("id",""))): abort(400)
                event_id=event["id"]
                if not con.execute("SELECT 1 FROM device_events WHERE owner=? AND id=?",(owner,event_id)).fetchone():
                    apply_event(con,owner,identifier,event,save_tracks,create_job,enqueue_tracks)
                    con.execute("INSERT INTO device_events VALUES (?,?,?)",(owner,event_id,time.time()))
                accepted.append(event_id)
            if isinstance(raw.get("player"),dict):
                player=player_state(raw["player"])
                select_playback(con,owner,identifier,player,json.loads(row["player"]))
                con.execute("UPDATE music_devices SET player=?,last_seen=? WHERE id=?",(json.dumps(player),time.time(),identifier))
            else: con.execute("UPDATE music_devices SET last_seen=? WHERE id=?",(time.time(),identifier))
            ack=raw.get("ack",0)
            if not isinstance(ack,int) or not 0<=ack<=2**53: abort(400)
            con.execute("DELETE FROM device_commands WHERE (target=? AND id<=?) OR created<?",(identifier,ack,time.time()-3600))
            commands=[dict(id=r["id"],command=json.loads(r["payload"])) for r in con.execute("SELECT * FROM device_commands WHERE target=? AND owner=? AND created>? ORDER BY id LIMIT 20",(identifier,owner,time.time()-60))]
            catalog=library(con,owner)
            revision=hashlib.sha256(json.dumps(catalog,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            response=dict(id=identifier,revision=revision,accepted=accepted,commands=commands,devices=device_list(con,owner),session=playback_session(con,owner))
            if raw.get("revision")!=revision: response["library"]=catalog
        if events: wake.set()
        return jsonify(response)

    @app.post("/api/devices/disconnect")
    def disconnect():
        identifier=getattr(g,"device",None) or request.get_json().get("id")
        with db() as con:
            con.execute("DELETE FROM music_devices WHERE id=? AND owner=?",(identifier,g.user["id"]))
            con.execute("DELETE FROM device_commands WHERE target=? AND owner=?",(identifier,g.user["id"]))
            con.execute("DELETE FROM music_playback WHERE owner=? AND device_id=?",(g.user["id"],identifier))
        return jsonify(ok=True)
