import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from werkzeug.security import generate_password_hash

sandbox = tempfile.TemporaryDirectory()
os.environ.update(MARE_DATA=sandbox.name, MARE_ORIGIN="https://music.example", MARE_PASSWORD_HASH=generate_password_hash("test-password"))
import server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.origin = {"Origin": "https://music.example"}
        with server.db() as db:
            db.execute("DELETE FROM tracks")
            db.execute("DELETE FROM playlists")
            db.execute("DELETE FROM sessions")
        server.attempts.clear()

    def login(self):
        return self.client.post("/api/login",json={"password":"test-password"},headers=self.origin)

    def test_private_api_and_cross_origin(self):
        self.assertEqual(self.client.get("/api/library").status_code,401)
        self.assertEqual(self.client.post("/api/login",json={"password":"test-password"}).status_code,403)
        self.assertEqual(self.login().status_code,200)
        self.assertEqual(self.client.get("/api/library").status_code,200)
        self.assertEqual(self.client.post("/api/logout",json={},headers=self.origin).status_code,200)
        self.assertEqual(self.client.get("/api/library").status_code,401)

    def test_duplicate_queue_and_complete_file_ranges(self):
        self.login()
        track={"id":"a"*22,"title":"Track","artist":"Artist"}
        for _ in range(3):
            self.assertEqual(self.client.post("/api/prepare",json={"tracks":[track]},headers=self.origin).status_code,202)
        with server.db() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM tracks").fetchone()[0],1)
            db.execute("UPDATE tracks SET status='preparing'")
        self.assertEqual(self.client.get("/media/"+"a"*22).status_code,404)
        self.assertEqual(self.client.post("/api/tracks/"+"a"*22,json={"action":"delete"},headers=self.origin).status_code,409)
        (server.MEDIA/("a"*22+".m4a")).write_bytes(b"0123456789")
        with server.db() as db:
            db.execute("UPDATE tracks SET status='ready'")
        response=self.client.get("/media/"+"a"*22,headers={"Range":"bytes=3-6"})
        self.assertEqual(response.status_code,206)
        self.assertEqual(response.data,b"3456")
        response.close()

    def test_playlist_import_and_safe_deletion(self):
        self.login()
        track={"id":"b"*22,"title":"Track","artist":"Artist","art":""}
        with patch("provider.collection",return_value=("playlist","p"*22,"Playlist",[track])):
            self.assertEqual(self.client.post("/api/import",json={"url":"fixture"},headers=self.origin).status_code,200)
        self.client.post("/api/tracks/"+"b"*22,json={"action":"delete"},headers=self.origin)
        library=self.client.get("/api/library").json
        self.assertEqual(library["tracks"],[])
        self.assertEqual(library["playlists"][0]["tracks"],[])

    def test_input_validation_and_static_traversal(self):
        self.login()
        response=self.client.post("/api/prepare",json={"tracks":[{"id":"../../session.key","title":"x"}]},headers=self.origin)
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.client.get("/../state/session.key").status_code,404)
        self.assertEqual(self.client.get("/api/library").headers["Cache-Control"],"no-store")


if __name__ == "__main__":
    unittest.main()
