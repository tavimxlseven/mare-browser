import base64
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch, Mock

from test_server import server
from source_browser_daemon import Browser

COOKIES = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSAPISID\tfixture-only-not-a-session\n'


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.origin = {"Origin": "https://music.example"}
        with server.db() as con:
            for table in ("settings", "jobs", "playlists", "tracks", "sessions"):
                con.execute("DELETE FROM " + table)
            con.execute("UPDATE users SET is_admin=1 WHERE id='admin'")
        server.accounts.attempts.clear()
        server.maintenance.event.clear()
        self.client.post('/api/login', json={'password':'test-password'}, headers=self.origin)
        self.path = Path(server.DATA) / 'maintenance-fixture.txt'
        self.env = patch.dict(os.environ, SUNNIFY_COOKIES_FILE=str(self.path))
        self.env.start()

    def tearDown(self):
        self.path.unlink(missing_ok=True)
        self.env.stop()

    def test_repeated_requests_are_queued_once_and_rate_limit_never_refreshes_cookies(self):
        with patch('pathlib.Path.is_socket', return_value=True):
            for _ in range(5):
                self.assertEqual(server.maintenance.request()['state'], 'queued')
        self.assertTrue(server.maintenance.event.is_set())
        server.maintenance.event.clear()
        server.maintenance.failure('rate_limited')
        state = server.maintenance.snapshot()
        self.assertEqual(state['state'], 'waiting')
        self.assertGreater(state['next_attempt'], time.time())
        with patch('pathlib.Path.is_socket', return_value=True):
            self.assertEqual(server.maintenance.request(manual=True)['state'], 'waiting')
        self.assertFalse(server.maintenance.event.is_set())

    def test_refresh_only_retries_blocked_track_and_does_not_expose_session(self):
        with server.db() as con:
            server.save_tracks(con, [dict(id=c*22,title=c,artist='Fixture',art='') for c in 'ab'])
            con.execute("UPDATE tracks SET status='error'")
            con.execute("INSERT INTO settings VALUES ('blocked_track',?)", ('a'*22,))
        with patch('source_browser.call', return_value={'ok':True,'cookies':COOKIES}):
            server.maintenance.refresh()
        self.assertEqual(self.path.read_text(), COOKIES)
        with server.db() as con:
            self.assertEqual(con.execute("SELECT status FROM tracks WHERE id=?",('a'*22,)).fetchone()[0], 'queued')
            self.assertEqual(con.execute("SELECT status FROM tracks WHERE id=?",('b'*22,)).fetchone()[0], 'error')
            self.assertFalse(con.execute("SELECT 1 FROM settings WHERE key='blocked_track'").fetchone())
        status = self.client.get('/api/source/session')
        self.assertNotIn('fixture-only', status.text)
        self.assertNotIn(str(self.path), status.text)
        self.assertEqual(status.json['maintenance']['state'], 'refreshed')
        server.maintenance.event.clear()
        server.maintenance.failure()
        self.assertEqual(server.maintenance.snapshot()['state'], 'needs_login')
        self.assertFalse(server.maintenance.event.is_set())

    def test_missing_browser_session_keeps_previous_file_and_asks_for_login(self):
        server.source_session.install(server.DATA, COOKIES)
        with patch('source_browser.call', return_value={'ok':True,'cookies':'# Netscape HTTP Cookie File\n'}):
            server.maintenance.refresh()
        self.assertEqual(server.maintenance.snapshot()['state'], 'needs_login')
        self.assertEqual(self.path.read_text(), COOKIES)

    def test_manual_replacement_takes_precedence_over_an_older_automatic_attempt(self):
        def response(*args, **kwargs):
            server.maintenance.accept(COOKIES)
            return {'ok':True, 'cookies':COOKIES.replace('fixture-only','obsolete')}
        with patch('source_browser.call', side_effect=response):
            server.maintenance.refresh()
        self.assertEqual(self.path.read_text(), COOKIES)

    def test_browser_api_requires_admin_same_origin_and_session_bound_lease(self):
        with patch('source_browser.call', return_value={'ok':True}) as browser:
            self.assertEqual(self.client.post('/api/source/browser/start',json={}).status_code,403)
            start=self.client.post('/api/source/browser/start',json={},headers=self.origin)
            self.assertEqual(start.status_code,200)
            first=browser.call_args.kwargs['lease']
            other=server.app.test_client()
            other.post('/api/login',json={'password':'test-password'},headers=self.origin)
            other.post('/api/source/browser/start',json={},headers=self.origin)
            self.assertNotEqual(first,browser.call_args.kwargs['lease'])
            self.assertEqual(len(first),64)
            self.assertEqual(self.client.post('/api/source/browser/input',json={'kind':'evaluate'},headers=self.origin).status_code,400)
            with server.db() as con:con.execute("UPDATE users SET is_admin=0 WHERE id='admin'")
            try:
                before=browser.call_count
                self.assertEqual(self.client.get('/api/source/browser/frame').status_code,403)
                self.assertEqual(self.client.post('/api/source/refresh',json={},headers=self.origin).status_code,403)
                self.assertEqual(browser.call_count,before)
            finally:
                with server.db() as con:con.execute("UPDATE users SET is_admin=1 WHERE id='admin'")


class BrowserBridgeTests(unittest.TestCase):
    def test_bridge_rejects_wrong_lease_arbitrary_commands_and_unbounded_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            browser=Browser(directory)
            browser.lease='a'*64
            browser.connection=object()
            self.assertEqual(browser.handle(dict(action='frame',lease='b'*64))['error'],'forbidden')
            for payload in (dict(action='evaluate'),dict(action='text',text='x'*1025),
                            dict(action='click',x=1201,y=5),dict(action='key',key='F12')):
                self.assertEqual(browser.handle(dict(lease='a'*64,**payload))['error'],'invalid')

    def test_export_preserves_session_cookies_and_excludes_unrelated_sites(self):
        with tempfile.TemporaryDirectory() as directory:
            browser=Browser(directory)
            browser.command=Mock(return_value={'cookies':[
                dict(domain='.youtube.com',name='SAPISID',value='fixture',expires=-1,secure=True),
                dict(domain='.unrelated.example',name='session',value='never-export',expires=-1)]})
            text=browser.cookies()
            self.assertIn('SAPISID',text)
            self.assertNotIn('never-export',text)
            with patch.dict(os.environ,SUNNIFY_COOKIES_FILE=str(Path(directory)/'session.txt')):
                server.source_session.install(directory,text)
