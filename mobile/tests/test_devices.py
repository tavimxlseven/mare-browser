import json
import unittest
from test_server import server


class DeviceTests(unittest.TestCase):
    def setUp(self):
        self.origin={"Origin":"https://music.example"}
        self.admin=server.app.test_client()
        with server.db() as con:
            for table in ("device_commands","device_events","device_codes","music_devices","sessions","playlists","jobs","tracks"):
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
