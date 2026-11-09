import json
import unittest
from test_server import server


class DeviceTests(unittest.TestCase):
    def setUp(self):
        self.origin={"Origin":"https://music.example"}
        self.admin=server.app.test_client()
        with server.db() as con:
            for table in ("music_playback","device_commands","device_events","device_codes","music_devices","sessions","playlists","jobs","tracks"):
                con.execute("DELETE FROM "+table)
        server.accounts.attempts.clear()
        self.assertEqual(self.admin.post('/api/login',json={'password':'test-password'},headers=self.origin).status_code,200)

    def pair(self):
        code=self.admin.post('/api/devices/pair',json={},headers=self.origin).json['code']
        client=server.app.test_client()
        response=client.post('/api/devices/claim',json={'code':code,'name':'Fixture PC'},headers=self.origin)
        self.assertEqual(response.status_code,200)
        headers={**self.origin,'Authorization':'Bearer '+response.json['token']}
        return client,headers,response.json['id'],code

    def test_desktop_uses_the_same_account_without_saving_the_password(self):
        client=server.app.test_client()
        self.assertEqual(client.post('/api/devices/login',json={'username':'admin','password':'wrong'},headers=self.origin).status_code,401)
        result=client.post('/api/devices/login',json={'username':'admin','password':'test-password'},headers=self.origin)
        self.assertEqual(result.status_code,200)
        self.assertNotIn('password',result.json)
        headers={**self.origin,'Authorization':'Bearer '+result.json['token']}
        self.assertEqual(client.post('/api/devices/sync',json={},headers=headers).status_code,200)
        self.assertEqual(client.get('/api/admin/invites',headers=headers).status_code,403)
        self.assertEqual(client.post('/api/devices/disconnect',json={},headers=headers).status_code,200)
        self.assertEqual(client.post('/api/devices/sync',json={},headers=headers).status_code,401)

    def test_pair_is_single_use_and_device_cannot_manage_accounts(self):
        client,headers,identifier,code=self.pair()
        self.assertEqual(client.post('/api/devices/claim',json={'code':code},headers=self.origin).status_code,401)
        self.assertEqual(client.get('/api/admin/invites',headers=headers).status_code,403)
        self.assertEqual(client.post('/api/devices/pair',json={},headers=headers).status_code,403)
        self.assertEqual(client.post('/api/devices/sync',json={},headers=headers).status_code,200)
        self.assertEqual(client.post('/api/devices/disconnect',json={},headers=headers).status_code,200)
        self.assertEqual(client.post('/api/devices/sync',json={},headers=headers).status_code,401)

    def test_events_are_idempotent_and_sources_prepare_in_the_background(self):
        client,headers,identifier,_=self.pair()
        track='a'*22
        events=[{'id':'1'*32,'type':'track','data':{'id':track,'title':'Fixture','artists':'Artist'}},
                {'id':'2'*32,'type':'playlist','data':{'id':'local:1','name':'Created','tracks':[track]}},
                {'id':'3'*32,'type':'source','data':{'url':'spotify:playlist:'+'b'*22,'name':'Imported'}}]
        events.extend([{'id':'4'*32,'type':'track','data':{'id':'','title':'Legacy local audio'}},{'id':'5'*32,'type':'delete_track','data':{'id':''}}])
        for _ in range(2):
            response=client.post('/api/devices/sync',json={'events':events},headers=headers)
            self.assertEqual(response.status_code,200)
            self.assertEqual(len(response.json['accepted']),5)
        with server.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM jobs WHERE kind='import'").fetchone()[0],1)
            self.assertEqual(con.execute('SELECT count(*) FROM device_events').fetchone()[0],5)
            self.assertEqual(json.loads(con.execute("SELECT tracks FROM playlists WHERE id=?",('pc:'+identifier+':1',)).fetchone()[0]),[track])

    def test_commands_are_account_scoped_bounded_and_acknowledged(self):
        client,headers,identifier,_=self.pair()
        with server.db() as con:
            con.execute("INSERT INTO music_devices(id,owner,name,kind,last_seen) VALUES ('other-device','other-owner','Other','web',0)")
        self.assertEqual(self.admin.post('/api/devices/commands',json={'target':'other-device','command':{'action':'pause'}},headers=self.origin).status_code,404)
        self.assertEqual(self.admin.post('/api/devices/commands',json={'target':identifier,'command':{'action':'eval'}},headers=self.origin).status_code,400)
        self.assertEqual(self.admin.post('/api/devices/commands',json={'target':identifier,'command':{'action':'pause'}},headers=self.origin).status_code,200)
        response=client.post('/api/devices/sync',json={},headers=headers).json
        command=response['commands'][0]
        self.assertEqual(command['command'],{'action':'pause'})
        response=client.post('/api/devices/sync',json={'ack':command['id'],'revision':response['revision']},headers=headers).json
        self.assertEqual(response['commands'],[])
        self.assertNotIn('library',response)
        self.assertFalse(any(d['id']=='other-device' for d in response['devices']))

    def test_one_account_output_is_mirrored_without_idle_devices_stealing_playback(self):
        pc,headers,pc_id,_=self.pair()
        phone_id=self.admin.post("/api/devices/register",json={"name":"Fixture phone"},headers=self.origin).json["id"]
        track="a"*22
        player=dict(track_id=track,title="Fixture song",artist="Fixture artist",state="playing",position_ms=1234,duration_ms=190000,queue=["b"*22],activation=100)
        response=self.admin.post("/api/devices/sync",json={"id":phone_id,"player":player},headers=self.origin)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json["session"]["device_id"],phone_id)
        mirror=pc.post("/api/devices/sync",json={"player":{}},headers=headers).json["session"]
        self.assertEqual(mirror["player"]["track_id"],track)
        self.assertEqual(mirror["player"]["position_ms"],1234)
        self.assertEqual(mirror["device_id"],phone_id)
        self.assertTrue(mirror["online"])
        pc_player={**player,"activation":200,"position_ms":5000}
        response=pc.post("/api/devices/sync",json={"player":pc_player},headers=headers).json
        self.assertEqual(response["session"]["device_id"],pc_id)
        response=self.admin.post("/api/devices/sync",json={"id":phone_id,"player":player},headers=self.origin).json
        self.assertEqual(response["session"]["device_id"],pc_id)
        self.assertEqual(response["commands"][0]["command"],dict(action="pause",expected_activation=100))
        response=pc.post("/api/devices/sync",json={"player":{**pc_player,"state":"paused"}},headers=headers).json
        self.assertEqual(response["session"]["device_id"],pc_id)
        self.assertEqual(response["session"]["player"]["state"],"paused")
        self.assertEqual(self.admin.post("/api/devices/commands",json={"target":pc_id,"command":{"action":"next"}},headers=self.origin).status_code,200)
        self.assertEqual(pc.post("/api/devices/sync",json={},headers=headers).json["commands"][-1]["command"]["action"],"next")
        self.assertEqual(pc.post("/api/devices/sync",json={"player":{**pc_player,"activation":-1}},headers=headers).status_code,400)

    def test_output_selection_works_while_paused_and_never_exposes_another_account(self):
        pc,headers,pc_id,_=self.pair()
        response=pc.post("/api/devices/sync",json={"player":{"activation":1,"state":"paused"}},headers=headers).json
        self.assertEqual(response["session"]["device_id"],pc_id)
        with server.db() as con:
            con.execute("UPDATE music_devices SET last_seen=0 WHERE id=?",(pc_id,))
        self.assertFalse(self.admin.get("/api/devices",headers=self.origin).json["devices"][0]["online"])
        with server.db() as con:
            con.execute("INSERT INTO music_devices(id,owner,name,kind,last_seen,player) VALUES ('foreign','another-owner','Private device','web',0,?)",(json.dumps({"title":"Private song"}),))
            con.execute("UPDATE music_playback SET device_id='foreign'")
        self.assertIsNone(pc.post("/api/devices/sync",json={},headers=headers).json["session"])
        self.assertEqual(self.admin.post("/api/devices/commands",json={"target":pc_id,"command":{"action":"queue","queue":["invalid"]}},headers=self.origin).status_code,400)
