import hashlib
import json
import sqlite3
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from test_server import server


class AccountTests(unittest.TestCase):
    def test_activity_cleanup_is_account_scoped(self):
        friend = self.friend()
        with server.db() as con:
            job = server.create_job(
                con,
                "prepare",
                "",
                "Private activity",
                [],
                friend.get("/api/me").json["user"]["id"],
            )
        self.admin.post("/api/jobs/cleanup", json={}, headers=self.origin)
        with server.db() as con:
            self.assertEqual(
                con.execute("SELECT archived FROM jobs WHERE id=?", (job,)).fetchone()[
                    0
                ],
                0,
            )

    def setUp(self):
        self.origin = {"Origin": "https://music.example"}
        self.admin = server.app.test_client()
        with server.db() as con:
            for table in (
                "sessions",
                "invites",
                "user_tracks",
                "playlists",
                "jobs",
                "tracks",
                "settings",
            ):
                con.execute(f"DELETE FROM {table}")
            con.execute("DELETE FROM users WHERE id!='admin'")
        server.accounts.attempts.clear()
        self.assertEqual(
            self.admin.post(
                "/api/login",
                json={"username": "admin", "password": "test-password"},
                headers=self.origin,
            ).status_code,
            200,
        )

    def invite(self):
        response = self.admin.post("/api/admin/invites", json={}, headers=self.origin)
        self.assertEqual(response.status_code, 201)
        return response.json

    def test_playlist_delete_only_removes_the_owners_playlist(self):
        friend = self.friend()
        for client in (self.admin, friend):
            self.assertEqual(
                client.post(
                    "/api/playlists",
                    json={"id": "same", "name": "Fixture", "tracks": []},
                    headers=self.origin,
                ).status_code,
                200,
            )
        self.assertEqual(
            friend.post(
                "/api/playlists/same/delete", json={}, headers=self.origin
            ).status_code,
            200,
        )
        self.assertEqual(
            friend.post(
                "/api/playlists/same/delete", json={}, headers=self.origin
            ).status_code,
            404,
        )
        self.assertEqual(len(self.admin.get("/api/library").json["playlists"]), 1)
        self.assertEqual(friend.get("/api/library").json["playlists"], [])

    def friend(self, username="friend"):
        client = server.app.test_client()
        response = client.post(
            "/api/register",
            json={
                "username": username,
                "password": "private-test-password",
                "invite": self.invite()["code"],
            },
            headers=self.origin,
        )
        self.assertEqual(response.status_code, 201)
        return client

    def test_invite_is_single_use_and_member_cannot_administer(self):
        invitation = self.invite()
        friend = server.app.test_client()
        body = {
            "username": "friend",
            "password": "private-test-password",
            "invite": invitation["code"],
        }
        self.assertEqual(
            friend.post("/api/register", json=body, headers=self.origin).status_code,
            201,
        )
        self.assertFalse(friend.get("/api/me").json["user"]["is_admin"])
        body["username"] = "another"
        self.assertEqual(
            server.app.test_client()
            .post("/api/register", json=body, headers=self.origin)
            .status_code,
            400,
        )
        self.assertEqual(
            friend.post("/api/admin/invites", json={}, headers=self.origin).status_code,
            403,
        )
        self.assertEqual(friend.get("/api/admin/invites").status_code, 403)
        with server.db() as con:
            row = con.execute(
                "SELECT * FROM invites WHERE id=?", (invitation["id"],)
            ).fetchone()
            self.assertNotEqual(row["code_hash"], invitation["code"])
            password = con.execute(
                "SELECT password_hash FROM users WHERE username='friend'"
            ).fetchone()[0]
            self.assertNotEqual(password, "private-test-password")
        self.assertNotIn(
            invitation["code"], json.dumps(self.admin.get("/api/admin/invites").json)
        )

    def test_revoked_expired_and_concurrent_invites(self):
        invitation = self.invite()
        self.admin.post(
            "/api/admin/invites/" + invitation["id"] + "/revoke",
            json={},
            headers=self.origin,
        )
        body = {
            "username": "friend",
            "password": "private-test-password",
            "invite": invitation["code"],
        }
        self.assertEqual(
            server.app.test_client()
            .post("/api/register", json=body, headers=self.origin)
            .status_code,
            400,
        )
        expired = self.invite()
        with server.db() as con:
            con.execute("UPDATE invites SET expires=0 WHERE id=?", (expired["id"],))
        body["invite"] = expired["code"]
        self.assertEqual(
            server.app.test_client()
            .post("/api/register", json=body, headers=self.origin)
            .status_code,
            400,
        )
        invitation = self.invite()

        def register(name):
            return (
                server.app.test_client()
                .post(
                    "/api/register",
                    json={
                        "username": name,
                        "password": "private-test-password",
                        "invite": invitation["code"],
                    },
                    headers=self.origin,
                )
                .status_code
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(register, ["first", "second"]))
        self.assertEqual(sorted(statuses), [201, 400])

    def test_libraries_jobs_and_media_are_isolated(self):
        friend = self.friend()
        track = {"id": "c" * 22, "title": "Song", "artist": "Singer", "art": ""}
        with server.db() as con:
            server.save_tracks(con, [track])
            con.execute("UPDATE tracks SET status='ready'")
        audio = server.MEDIA / (track["id"] + ".m4a")
        audio.write_bytes(b"audio-fixture")
        try:
            self.admin.post(
                "/api/playlists",
                json={"id": "same", "name": "Private", "tracks": [track["id"]]},
                headers=self.origin,
            )
            self.assertEqual(friend.get("/api/library").json["tracks"], [])
            self.assertEqual(friend.get("/media/" + track["id"]).status_code, 404)
            self.assertEqual(friend.get("/artwork/" + track["id"]).status_code, 404)
            self.assertEqual(
                friend.post(
                    "/api/tracks/" + track["id"],
                    json={"liked": True},
                    headers=self.origin,
                ).status_code,
                404,
            )
            self.assertEqual(
                friend.post(
                    "/api/playlists/same/prepare", json={}, headers=self.origin
                ).status_code,
                404,
            )
            self.assertEqual(
                friend.post(
                    "/api/playlists",
                    json={"name": "Attempt", "tracks": [track["id"]]},
                    headers=self.origin,
                ).status_code,
                404,
            )
            # Both may independently add the same public song.
            friend.post("/api/prepare", json={"tracks": [track]}, headers=self.origin)
            friend.post(
                "/api/prepare",
                json={
                    "tracks": [
                        {**track, "title": "Client-edited title", "artist": "Edited"}
                    ]
                },
                headers=self.origin,
            )
            self.assertEqual(
                self.admin.get("/api/library").json["tracks"][0]["title"], "Song"
            )
            friend.post(
                "/api/playlists",
                json={"id": "same", "name": "Friend list", "tracks": [track["id"]]},
                headers=self.origin,
            )
            friend.post(
                "/api/tracks/" + track["id"], json={"liked": True}, headers=self.origin
            )
            self.assertEqual(
                self.admin.get("/api/library").json["tracks"][0]["liked"], 0
            )
            self.assertEqual(friend.get("/api/library").json["tracks"][0]["liked"], 1)
            self.assertEqual(
                self.admin.get("/api/library").json["playlists"][0]["name"], "Private"
            )
            self.assertEqual(
                friend.get("/api/library").json["playlists"][0]["name"], "Friend list"
            )
            self.assertEqual(self.admin.get("/api/library").json["jobs"], [])
            friend.post(
                "/api/tracks/" + track["id"],
                json={"action": "delete"},
                headers=self.origin,
            )
            self.assertEqual(friend.get("/api/library").json["tracks"], [])
            response = self.admin.get("/media/" + track["id"])
            self.assertEqual(response.status_code, 200)
            response.close()
        finally:
            audio.unlink(missing_ok=True)

    def test_legacy_migration_preserves_admin_data_only(self):
        con = sqlite3.connect(":memory:")
        con.row_factory = sqlite3.Row
        con.executescript("""
          CREATE TABLE tracks(id TEXT PRIMARY KEY,title TEXT,artist TEXT,art TEXT,status TEXT,error TEXT,liked INTEGER);
          INSERT INTO tracks VALUES ('fixture','Song','Singer','','ready','',1);
          CREATE TABLE playlists(id TEXT PRIMARY KEY,name TEXT,tracks TEXT);
          INSERT INTO playlists VALUES ('list','Old list','["fixture"]');
          CREATE TABLE jobs(id TEXT PRIMARY KEY,tracks TEXT);
          CREATE TABLE sessions(token TEXT PRIMARY KEY,expires INTEGER);
          INSERT INTO sessions VALUES ('shared-session',9999999999);
        """)
        with con:
            server.accounts.initialize(con)
        with con:
            server.accounts.initialize(con)
        self.assertEqual(
            con.execute("SELECT owner FROM playlists").fetchone()[0], "admin"
        )
        self.assertEqual(
            con.execute("SELECT owner,liked FROM user_tracks").fetchone()[:],
            ("admin", 1),
        )
        self.assertEqual(con.execute("SELECT count(*) FROM users").fetchone()[0], 1)
        self.assertEqual(con.execute("SELECT count(*) FROM sessions").fetchone()[0], 0)
        con.close()

    def test_artwork_is_resolved_for_exact_track_and_cached(self):
        track = {"id": "d" * 22, "title": "Song", "artist": "Singer", "art": ""}
        with server.db() as con:
            server.save_tracks(con, [track])
        cover = "https://i.scdn.co/image/exact-track-fixture"
        with patch("provider.artwork", return_value=cover) as fetch:
            response = self.admin.get("/artwork/" + track["id"])
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.headers["Location"], cover)
            self.admin.get("/artwork/" + track["id"])
            fetch.assert_called_once_with(track["id"])
        self.assertEqual(self.admin.get("/api/library").json["tracks"][0]["art"], cover)


if __name__ == "__main__":
    unittest.main()
