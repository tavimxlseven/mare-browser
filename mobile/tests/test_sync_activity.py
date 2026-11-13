import json
import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from test_server import server


class SyncActivityTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.origin = {"Origin": "https://music.example"}
        server.accounts.attempts.clear()
        with server.db() as con:
            for table in ("playlists", "jobs", "tracks", "settings", "sessions"):
                con.execute("DELETE FROM " + table)
        self.client.post("/api/login", json={"password": "test-password"}, headers=self.origin)

    def fixture(self):
        identifier = "p" * 22
        tracks = [dict(id=c * 22, title=c, artist="Fixture", art="") for c in "abc"]
        source = "https://open.spotify.com/playlist/" + identifier
        with server.db() as con:
            server.save_tracks(con, tracks)
            con.execute("UPDATE tracks SET status='ready'")
            con.execute("INSERT INTO playlists(id,name,tracks,owner,source,added_tracks,custom_name,track_order) VALUES (?,?,?,?,?,?,?,?)",
                        (identifier, "Original", json.dumps([tracks[0]["id"], tracks[2]["id"]]), "admin", source,
                         json.dumps([tracks[2]["id"]]), "My name", json.dumps([tracks[2]["id"], tracks[0]["id"]])))
        return identifier, source, tracks

    def test_sync_deduplicates_refreshes_and_keeps_custom_edits(self):
        identifier, source, tracks = self.fixture()
        route = f"/api/playlists/{identifier}/sync"
        jobs = [self.client.post(route, json={"refresh": True}, headers=self.origin).json["job_id"] for _ in range(3)]
        self.assertEqual(len(set(jobs)), 1)
        with server.db() as con:
            job = dict(con.execute("SELECT * FROM jobs WHERE id=?", (jobs[0],)).fetchone())
        with patch("provider.collection", return_value=("playlist", identifier, "Spotify new name", tracks[:2])):
            server.import_job(job)
        playlist = self.client.get("/api/library").json["playlists"][0]
        self.assertEqual(playlist["name"], "My name")
        self.assertEqual(playlist["tracks"], [tracks[2]["id"], tracks[0]["id"], tracks[1]["id"]])
        self.assertGreater(playlist["spotify_sync"]["updated"], 0)
        # Already-ready audio is reused and metadata-only jobs stay out of the island.
        self.assertEqual(self.client.get("/api/library").json["jobs"], [])

    def test_sync_schedules_once_and_failure_preserves_copy_without_spamming(self):
        identifier, source, tracks = self.fixture()
        with server.db() as con:
            con.execute("BEGIN IMMEDIATE")
            first = server.playlist_sync.schedule(con, server.create_job)
            self.assertIsNone(server.playlist_sync.schedule(con, server.create_job))
            job = dict(con.execute("SELECT * FROM jobs WHERE id=?", (first,)).fetchone())
        with patch("provider.collection", side_effect=ValueError("unavailable")):
            server.import_job(job)
        library = self.client.get("/api/library").json
        self.assertEqual(len(library["playlists"][0]["tracks"]), 2)
        self.assertTrue(library["playlists"][0]["spotify_sync"]["error"])
        self.assertEqual(library["jobs"], [])
        with server.db() as con:
            self.assertIsNone(server.playlist_sync.schedule(con, server.create_job))

    def test_sync_is_optional_and_does_not_resurrect_a_deleted_playlist(self):
        identifier, source, tracks = self.fixture()
        route = f"/api/playlists/{identifier}/sync"
        self.assertEqual(self.client.post(route, json={"enabled": "false"}, headers=self.origin).status_code, 400)
        self.client.post(route, json={"enabled": False}, headers=self.origin)
        with server.db() as con:
            self.assertIsNone(server.playlist_sync.schedule(con, server.create_job))
        job_id = self.client.post(route, json={"refresh": True}, headers=self.origin).json["job_id"]
        with server.db() as con:
            job = dict(con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())
            con.execute("DELETE FROM playlists")
        with patch("provider.collection", return_value=("playlist", identifier, "Remote", tracks)):
            server.import_job(job)
        self.assertEqual(self.client.get("/api/library").json["playlists"], [])
        self.assertEqual(self.client.post('/api/playlists/unknown/sync', json={}, headers=self.origin).status_code, 404)

    def test_finished_failed_work_expires_even_when_source_is_paused(self):
        identifier, source, tracks = self.fixture()
        with server.db() as con:
            con.execute("UPDATE tracks SET status='error' WHERE id=?", (tracks[0]["id"],))
            con.execute("INSERT INTO settings VALUES ('blocked_track',?)", (tracks[0]["id"],))
            job = server.create_job(con, "prepare", source, "Fixture", [tracks[0]["id"]])
        self.assertEqual(self.client.get("/api/library").json["jobs"][0]["status"], "partial")
        with server.db() as con:
            con.execute("UPDATE jobs SET updated=? WHERE id=?", (time.time()-30, job))
        self.assertEqual(self.client.get("/api/library").json["jobs"], [])

    def test_dismissing_pending_activity_never_cancels_audio_or_other_accounts(self):
        _, source, tracks = self.fixture()
        with server.db() as con:
            con.execute("UPDATE tracks SET status='queued'")
            job = server.create_job(con, "prepare", source, "Fixture", [tracks[0]["id"]])
            other = server.create_job(con, "prepare", source, "Other", [], "other")
        self.assertEqual(self.client.post(f'/api/jobs/{other}/dismiss', json={}, headers=self.origin).status_code, 404)
        self.assertEqual(self.client.post(f'/api/jobs/{job}/dismiss', json={}, headers=self.origin).status_code, 200)
        self.assertEqual(self.client.get('/api/library').json['jobs'], [])
        with server.db() as con:
            self.assertEqual(con.execute("SELECT status FROM tracks WHERE id=?", (tracks[0]["id"],)).fetchone()[0], "queued")

    def test_source_upload_is_admin_only_atomic_and_never_returned(self):
        path = Path(server.DATA) / "fixture-session.txt"
        cookies = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSAPISID\tfixture-only-not-a-session\n'
        with patch.dict(os.environ, SUNNIFY_COOKIES_FILE=str(path)):
            try:
                bad = self.client.post('/api/source/session', json={'cookies': 'invalid-format-content-here'}, headers=self.origin)
                self.assertEqual(bad.status_code, 400)
                self.assertFalse(path.exists())
                good = self.client.post('/api/source/session', json={'cookies': cookies}, headers=self.origin)
                self.assertEqual(good.status_code, 200)
                self.assertEqual(path.read_text(), cookies)
                status = self.client.get('/api/source/session')
                self.assertTrue(status.json['locally_valid'])
                self.assertNotIn('fixture-only', status.text)
                self.assertNotIn(str(path), status.text)
                self.client.post('/api/source/session', json={'cookies': 'another-invalid-format-here'}, headers=self.origin)
                self.assertEqual(path.read_text(), cookies)
                with server.db() as con:
                    con.execute("UPDATE users SET is_admin=0 WHERE id='admin'")
                self.assertEqual(self.client.get('/api/source/session').status_code, 403)
                self.assertEqual(self.client.post('/api/source/session', json={'cookies': cookies}, headers=self.origin).status_code, 403)
            finally:
                with server.db() as con:
                    con.execute("UPDATE users SET is_admin=1 WHERE id='admin'")
                path.unlink(missing_ok=True)
