import json
import time
import unittest
from unittest.mock import patch
from test_server import server


class ListeningTests(unittest.TestCase):
    def setUp(self):
        self.origin = {"Origin":"https://music.example"}
        server.accounts.attempts.clear()
        with server.db() as con:
            for table in ("listening_members","listening_rooms","music_playback","music_devices","device_commands","device_events","user_tracks","tracks","jobs"):
                con.execute("DELETE FROM "+table)
            con.execute("INSERT OR IGNORE INTO users VALUES ('friend','friend','unused',0,0)")
            con.execute("INSERT OR IGNORE INTO users VALUES ('stranger','stranger','unused',0,0)")
            for owner in ("admin","friend","stranger"):
                token = (owner[0]*43)
                import hashlib
                con.execute("INSERT INTO music_devices(id,owner,token_hash,name,kind,last_seen) VALUES (?,?,?,?,?,?)", (owner+"-pc",owner,hashlib.sha256(token.encode()).hexdigest(),owner,"desktop",time.time()))
            server.save_tracks(con,[dict(id="a"*22,title="Fixture song",artist="Artist",art="",duration_ms=200000)],"admin")
            con.execute("UPDATE tracks SET status='ready'")
        self.path = server.MEDIA/("a"*22+".m4a")
        self.path.write_bytes(b"fixture-audio-bytes")
        self.clients = {owner:server.app.test_client() for owner in ("admin","friend","stranger")}

    def tearDown(self):
        self.path.unlink(missing_ok=True)

    def post(self, owner, route, payload=None):
        return self.clients[owner].post(route,json=payload or {},headers={**self.origin,"Authorization":"Bearer "+owner[0]*43})

    def create(self):
        player = dict(track_id="a"*22,title="Fixture song",artist="Artist",state="playing",position_ms=1000,duration_ms=200000,queue=[])
        response = self.post("admin","/api/listening/create",dict(player=player))
        self.assertEqual(response.status_code,200)
        return response.json

    def test_stream_grant_is_track_scoped_range_capable_and_revocable(self):
        result = self.post("admin","/api/devices/stream",dict(track_id="a"*22))
        self.assertEqual(result.status_code,200)
        self.assertNotIn("token",result.json)
        self.assertEqual(self.post("friend","/api/devices/stream",dict(track_id="a"*22)).status_code,404)
        path = result.json["path"]
        audio = self.clients["admin"].get(path,headers={"Range":"bytes=0-6"})
        self.assertEqual(audio.status_code,206)
        self.assertEqual(audio.data,b"fixture")
        audio.close()
        self.assertIn("no-store",audio.headers["Cache-Control"])
        self.assertEqual(self.clients["admin"].get(path[:-22]+"b"*22).status_code,403)
        with patch("itsdangerous.timed.time.time",return_value=time.time()+3601):
            self.assertEqual(self.clients["admin"].get(path).status_code,403)
        with server.db() as con:
            con.execute("DELETE FROM music_devices WHERE owner='admin'")
        self.assertEqual(self.clients["admin"].get(path).status_code,403)

    def test_invite_shares_only_current_audio_and_guest_cannot_control_or_close(self):
        room = self.create()
        self.assertEqual(len(room["code"]),10)
        self.assertTrue(room["host"])
        self.assertEqual(self.post("friend","/api/listening/join",dict(code="INVALID123")).status_code,404)
        joined = self.post("friend","/api/listening/join",dict(code=room["code"]))
        self.assertEqual(joined.status_code,200)
        self.assertFalse(joined.json["host"])
        self.assertEqual(self.post("friend","/api/listening/join",dict(code=room["code"][:5]+"–"+room["code"][5:])).status_code,200)
        self.assertEqual(joined.json["track"]["id"],"a"*22)
        self.assertNotIn("library",joined.json)
        result = self.post("friend","/api/devices/stream",dict(track_id="a"*22))
        self.assertEqual(result.json["state"],"ready")
        self.assertEqual(self.post("stranger","/api/devices/stream",dict(track_id="a"*22)).status_code,404)
        self.assertEqual(self.post("friend","/api/listening/close").status_code,403)
        with server.db() as con:
            before = con.execute("SELECT player FROM listening_rooms").fetchone()[0]
        self.post("friend","/api/listening/state",dict(player={"state":"stopped"}))
        with server.db() as con:
            self.assertEqual(con.execute("SELECT player FROM listening_rooms").fetchone()[0],before)
        self.post("friend","/api/listening/leave")
        self.assertEqual(self.clients["friend"].get(result.json["path"]).status_code,403)

    def test_preparation_is_deduplicated_and_completed_files_are_reused(self):
        with server.db() as con:
            con.execute("UPDATE tracks SET status='new'")
        for _ in range(3):
            self.assertEqual(self.post("admin","/api/devices/stream",dict(track_id="a"*22)).json["state"],"preparing")
        with server.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM jobs").fetchone()[0],1)
            con.execute("UPDATE tracks SET status='ready'")
        self.assertEqual(self.post("admin","/api/devices/stream",dict(track_id="a"*22)).json["state"],"ready")
        with server.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM jobs").fetchone()[0],1)

    def test_failed_preparation_is_not_restarted_by_stream_polling(self):
        with server.db() as con:
            con.execute("UPDATE tracks SET status='error',error='Fixture source failure'")
        for _ in range(3):
            response = self.post("admin","/api/devices/stream",dict(track_id="a"*22))
            self.assertEqual(response.json["state"],"failed")
        with server.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM jobs").fetchone()[0],0)

    def test_host_offline_and_closed_rooms_stop_guest_playback(self):
        room = self.create()
        self.post("friend","/api/listening/join",dict(code=room["code"]))
        with server.db() as con:
            con.execute("UPDATE music_devices SET last_seen=0 WHERE owner='admin'")
        result = self.post("friend","/api/listening/state").json
        self.assertFalse(result["host_online"])
        self.assertEqual(result["player"]["state"],"paused")
        self.post("admin","/api/listening/close")
        self.assertFalse(self.post("friend","/api/listening/state").json["active"])
