import base64
import unittest
from test_server import server


class PlaylistMetadataTests(unittest.TestCase):
    def setUp(self):
        self.client=server.app.test_client()
        self.origin={"Origin":"https://music.example"}
        server.accounts.attempts.clear()
        self.assertEqual(self.client.post("/api/login",json={"password":"test-password"},headers=self.origin).status_code,200)
        self.identifier="metadata-fixture"
        self.cover="data:image/png;base64,"+base64.b64encode(b"\x89PNG\r\n\x1a\nfixture").decode()
        with server.db() as con:
            con.execute("DELETE FROM playlists WHERE id=?",(self.identifier,))
        self.client.post("/api/playlists",json={"id":self.identifier,"name":"Imported","tracks":[]},headers=self.origin)

    def test_custom_name_and_cover_survive_refresh_and_are_shared_with_pc(self):
        endpoint=f"/api/playlists/{self.identifier}/metadata"
        self.assertEqual(self.client.post(endpoint,json={"name":"My playlist","art":self.cover},headers=self.origin).status_code,200)
        # A later importer updates the source metadata, never the user's override.
        with server.db() as con:
            con.execute("UPDATE playlists SET name='Source refreshed' WHERE owner='admin' AND id=?",(self.identifier,))
            synced=next(p for p in server.devices.library(con,"admin")["playlists"] if p["id"]==self.identifier)
        shown=next(p for p in self.client.get("/api/library").json["playlists"] if p["id"]==self.identifier)
        self.assertEqual(shown["name"],"My playlist")
        self.assertEqual(shown["art"],self.cover)
        self.assertEqual(synced["art"],self.cover)
        self.assertEqual(self.client.post(endpoint,json={"name":"My playlist","art":""},headers=self.origin).status_code,200)

    def test_covers_reject_svg_external_fetches_and_oversized_payloads(self):
        endpoint=f"/api/playlists/{self.identifier}/metadata"
        for art in ("data:image/svg+xml;base64,PHN2Zz4=","https://private.example/secret.png",self.cover+"A"*32768,"data:image/png;base64,aGVsbG8="):
            self.assertEqual(self.client.post(endpoint,json={"name":"My playlist","art":art},headers=self.origin).status_code,400)

    def test_cannot_edit_another_accounts_playlist(self):
        with server.db() as con:
            con.execute("DELETE FROM playlists WHERE owner='other-user' AND id='private-fixture'")
            con.execute("INSERT INTO playlists(owner,id,name,tracks) VALUES ('other-user','private-fixture','Private','[]')")
        self.assertEqual(self.client.post("/api/playlists/private-fixture/metadata",json={"name":"Changed"},headers=self.origin).status_code,404)

    def test_legacy_playlist_uses_a_track_cover_without_reimporting_audio(self):
        track=dict(id="m"*22,title="Fixture",artists="Artist",thumbnail="https://i.scdn.co/image/fixture")
        with server.db() as con:
            server.save_tracks(con,[server.provider.track(track)],"admin",authoritative=True)
        self.client.post(f"/api/playlists/{self.identifier}/tracks",json=track,headers=self.origin)
        shown=next(p for p in self.client.get("/api/library").json["playlists"] if p["id"]==self.identifier)
        self.assertEqual(shown["art"],track["thumbnail"])
