// Real executable, disposable profile, loopback fixtures only. No sign-in or account access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSocket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connect, until } from './lib/cdp.mjs';

const exe = resolve(process.argv.find(arg => arg.startsWith('--exe='))?.slice(6) || 'dist/Mare/Mare.exe');
const profile = await mkdtemp(join(tmpdir(), 'compass-link-qa-'));
const received = [];
const fixture = createServer((request, response) => {
  received.push(request.url);
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<title>Compass external link QA</title><p>Local link fixture</p>');
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const portProbe = createSocket(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
const origin = `http://127.0.0.1:${fixture.address().port}`;
const first = '/first?state=a%2Bb&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb';
const second = '/second?state=another%2Bstate&value=a%26b';
const options = { windowsHide: true, stdio: 'ignore', env: { ...process.env, MARE_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } };
const primary = spawn(exe, ['--open-url', origin + first], options);
let c;
try {
  await until('initial external link', () => received.includes(first), 30000);
  await until('private test interface', async () => { try { c = await connect(port); return true; } catch { return false; } });
  await c.eval('window.__launchQA={state:null};var receiveLaunchQA=window.mare.receive;window.mare.receive=s=>{window.__launchQA.state=typeof s==="string"?JSON.parse(s):s;receiveLaunchQA(s)};true');
  await c.ipc({cmd:'ready'});
  await until('initial state', () => c.eval('Boolean(window.__launchQA.state)'));
  const before = await c.eval('window.__launchQA.state.tabs.length');
  const secondary = spawn(exe, ['--open-url', origin + second], options);
  const [code] = await once(secondary, 'close');
  assert.equal(code, 0);
  await until('second link in existing instance', () => received.includes(second));
  await until('new tab', async () => (await c.eval('window.__launchQA.state.tabs.length')) === before + 1);
  const endpoint = JSON.parse(await readFile(join(profile, 'runtime/browser-instance.json'), 'utf8'));
  assert.deepEqual(Object.keys(endpoint).sort(), ['nonce', 'port']);
  const focus = spawn(exe, [], options);
  assert.equal((await once(focus, 'close'))[0], 0);
  assert.equal(await c.eval('window.__launchQA.state.tabs.length'), before + 1);
  console.log('PASS command-line URL launch, exact OAuth query preservation, existing-window tab delivery and focus without extra tabs');
  await c.ipc({cmd:'window',action:'close'});
  await once(primary, 'close');
} finally {
  c?.close();
  if (primary.exitCode === null) primary.kill(); // Only the disposable process launched above.
  fixture.close();
}
