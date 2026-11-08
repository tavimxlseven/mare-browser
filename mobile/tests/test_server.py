import os
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from werkzeug.security import generate_password_hash

sandbox = tempfile.TemporaryDirectory()
os.environ.update(
    MARE_DATA=sandbox.name,
    MARE_ORIGIN="https://music.example",
    MARE_PASSWORD_HASH=generate_password_hash("test-password"),
)
import server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.origin = {"Origin": "https://music.example"}
        with server.db() as db:
            db.execute("DELETE FROM tracks")
            db.execute("DELETE FROM playlists")
            db.execute("DELETE FROM sessions")
            db.execute("DELETE FROM settings")
            db.execute("DELETE FROM jobs")
        server.attempts.clear()

    def login(self):
        return self.client.post(
            "/api/login", json={"password": "test-password"}, headers=self.origin
        )

    def test_private_api_and_cross_origin(self):
        self.assertEqual(self.client.get("/api/library").status_code, 401)
        self.assertEqual(
            self.client.post(
                "/api/login", json={"password": "test-password"}
            ).status_code,
            403,
        )
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.client.get("/api/library").status_code, 200)
        self.assertEqual(
            self.client.post("/api/logout", json={}, headers=self.origin).status_code,
            200,
        )
        self.assertEqual(self.client.get("/api/library").status_code, 401)

    def test_duplicate_queue_and_complete_file_ranges(self):
        self.login()
        track = {"id": "a" * 22, "title": "Track", "artist": "Artist"}
        for _ in range(3):
            self.assertEqual(
                self.client.post(
                    "/api/prepare", json={"tracks": [track]}, headers=self.origin
                ).status_code,
                202,
            )
        with server.db() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM tracks").fetchone()[0], 1)
            db.execute("UPDATE tracks SET status='preparing'")
        self.assertEqual(self.client.get("/media/" + "a" * 22).status_code, 404)
        self.assertEqual(
            self.client.post(
                "/api/tracks/" + "a" * 22,
                json={"action": "delete"},
                headers=self.origin,
            ).status_code,
            409,
        )
        (server.MEDIA / ("a" * 22 + ".m4a")).write_bytes(b"0123456789")
        with server.db() as db:
            db.execute("UPDATE tracks SET status='ready'")
        response = self.client.get("/media/" + "a" * 22, headers={"Range": "bytes=3-6"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data, b"3456")
        response.close()

    def test_playlist_import_and_safe_deletion(self):
        self.login()
        track = {"id": "b" * 22, "title": "Track", "artist": "Artist", "art": ""}
        link = "https://open.spotify.com/playlist/" + "p" * 22
        response = self.client.post(
            "/api/import", json={"url": link}, headers=self.origin
        )
        self.assertEqual(response.status_code, 202)
        job_id = response.json["job_id"]
        duplicate = self.client.post(
            "/api/import", json={"url": link + "?si=duplicate"}, headers=self.origin
        )
        self.assertEqual(duplicate.json["job_id"], job_id)
        with server.db() as db:
            job = dict(
                db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            )
        with patch(
            "provider.collection",
            return_value=("playlist", "p" * 22, "Playlist", [track]),
        ):
            server.import_job(job)
        library = self.client.get("/api/library").json
        self.assertEqual(library["tracks"][0]["status"], "queued")
        self.assertEqual(library["jobs"][0]["total"], 1)
        # Completed preparation survives rereading the persisted job.
        with server.db() as db:
            db.execute("UPDATE tracks SET status='ready'")
        library = self.client.get("/api/library").json
        self.assertEqual(library["jobs"][0]["ready"], 1)
        self.assertEqual(library["jobs"][0]["status"], "complete")
        self.client.post(
            "/api/tracks/" + "b" * 22, json={"action": "delete"}, headers=self.origin
        )
        library = self.client.get("/api/library").json
        self.assertEqual(library["tracks"], [])
        self.assertEqual(library["playlists"][0]["tracks"], [])

    def test_source_refusal_preserves_queue_until_explicit_resume(self):
        self.login()
        tracks = [
            {"id": letter * 22, "title": letter, "artist": "Artist"}
            for letter in ("a", "b")
        ]
        self.client.post("/api/prepare", json={"tracks": tracks}, headers=self.origin)
        with patch(
            "provider.download",
            side_effect=server.provider.PreparationError("Fonte recusou o acesso"),
        ):
            server.prepare_track("a" * 22)
        library = self.client.get("/api/library").json
        self.assertTrue(library["preparation"]["paused"])
        states = {t["id"]: t["status"] for t in library["tracks"]}
        self.assertEqual(states["a" * 22], "error")
        self.assertEqual(states["b" * 22], "queued")
        # New requests remain safely queued while the source is paused.
        self.assertEqual(
            self.client.post(
                "/api/prepare", json={"tracks": tracks}, headers=self.origin
            ).status_code,
            202,
        )
        self.assertEqual(
            self.client.post("/api/resume", json={}, headers=self.origin).status_code,
            200,
        )
        library = self.client.get("/api/library").json
        self.assertFalse(library["preparation"]["paused"])
        self.assertTrue(all(t["status"] == "queued" for t in library["tracks"]))

    def test_input_validation_and_static_traversal(self):
        self.login()
        response = self.client.post(
            "/api/prepare",
            json={"tracks": [{"id": "../../session.key", "title": "x"}]},
            headers=self.origin,
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/../state/session.key").status_code, 404)
        self.assertEqual(
            self.client.get("/api/library").headers["Cache-Control"], "no-store"
        )

    def test_import_failure_is_persistent_and_retryable(self):
        self.login()
        link = "https://open.spotify.com/playlist/" + "p" * 22
        first = self.client.post(
            "/api/import", json={"url": link}, headers=self.origin
        ).json
        with server.db() as db:
            job = dict(
                db.execute(
                    "SELECT * FROM jobs WHERE id=?", (first["job_id"],)
                ).fetchone()
            )
        with patch("provider.collection", side_effect=ValueError("metadata")):
            server.import_job(job)
        library = self.client.get("/api/library").json
        self.assertEqual(library["jobs"][0]["status"], "error")
        self.assertEqual(library["tracks"], [])
        retry = self.client.post(
            "/api/import", json={"url": link}, headers=self.origin
        ).json
        self.assertNotEqual(first["job_id"], retry["job_id"])

    def test_large_playlist_prepares_by_id_without_request_payload(self):
        self.login()
        ids = [f"{i:022d}" for i in range(1500)]
        with server.db() as db:
            server.save_tracks(
                db, [dict(id=i, title=i, artist="Artist", art="") for i in ids]
            )
            db.execute(
                "INSERT INTO playlists VALUES (?,?,?)",
                ("large", "Large", json.dumps(ids)),
            )
        first = self.client.post(
            "/api/playlists/large/prepare", json={}, headers=self.origin
        )
        second = self.client.post(
            "/api/playlists/large/prepare", json={}, headers=self.origin
        )
        self.assertEqual(first.status_code, 202)
        self.assertEqual(first.json["job_id"], second.json["job_id"])
        job = self.client.get("/api/library").json["jobs"][0]
        self.assertEqual(job["total"], 1500)
        self.assertEqual(job["ready"], 0)

    def test_restart_reconciles_promoted_and_missing_files(self):
        with server.db() as db:
            server.save_tracks(
                db,
                [dict(id=i * 22, title=i, artist="Artist", art="") for i in ("x", "y")],
            )
            db.execute("UPDATE tracks SET status='queued' WHERE id=?", ("x" * 22,))
            db.execute("UPDATE tracks SET status='ready' WHERE id=?", ("y" * 22,))
        audio = server.MEDIA / ("x" * 22 + ".m4a")
        audio.write_bytes(b"complete-file-promoted-before-database-commit")
        abandoned = server.DATA / "prepare-abandoned"
        abandoned.mkdir(exist_ok=True)
        (abandoned / "partial.m4a").write_bytes(b"partial")
        private = server.DATA / "private"
        private.mkdir(exist_ok=True)
        (private / "session.txt").write_text("private-fixture")
        server.recover_preparations()
        with server.db() as db:
            states = {t["id"]: t["status"] for t in db.execute("SELECT * FROM tracks")}
        self.assertEqual(states["x" * 22], "ready")
        self.assertEqual(states["y" * 22], "queued")
        self.assertFalse(abandoned.exists())
        self.assertTrue((private / "session.txt").is_file())
        audio.unlink()


if __name__ == "__main__":
    unittest.main()
