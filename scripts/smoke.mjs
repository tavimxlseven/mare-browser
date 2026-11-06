#!/usr/bin/env node
// Run against an already open debug build with its own disposable QA profile:
// node scripts/smoke.mjs --cdp=http://127.0.0.1:9227 --profile=D:\DevCache\mare-native-qa-cdp
// Node 24+ is sufficient; no npm packages are required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const argumentsByName = new Map(process.argv.slice(2).map(argument => {
  const equals = argument.indexOf('=');
  return equals < 0 ? [argument, true] : [argument.slice(0, equals), argument.slice(equals + 1)];
}));
if (argumentsByName.has('--help')) {
  console.log('node scripts/smoke.mjs --cdp=http://127.0.0.1:9227 --profile=<absolute disposable QA profile>');
  process.exit(0);
}
const cdpEndpoint = new URL(argumentsByName.get('--cdp') || 'http://127.0.0.1:9227');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(cdpEndpoint.hostname), 'CDP must use a loopback address.');
const profile = argumentsByName.get('--profile');
assert.ok(typeof profile === 'string' && isAbsolute(profile), 'Pass an absolute disposable QA profile with --profile=.');
assert.match(profile, /(?:qa|smoke)/i, 'The profile path must identify a disposable QA/smoke profile.');
const stateFile = join(profile, 'state.json');
await realpath(profile);

class DevTools {
  pending = new Map();
  sequence = 0;
  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`CDP ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }
  static async connect(address) {
    const socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not open the local CDP socket.')), { once: true });
    });
    return new DevTools(socket);
  }
  async call(method, params = {}) {
    const id = ++this.sequence;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 12_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`UI evaluation failed: ${result.exceptionDetails.text}`);
    return result.result.value;
  }
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('CDP connection closed.'));
    }
    this.pending.clear();
    this.socket.close();
  }
}

async function until(description, callback, timeout = 18_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await callback();
      if (result) return result;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`);
}
async function persisted() { return JSON.parse(await readFile(stateFile, 'utf8')); }

let tools;
const targets = await fetch(new URL('/json/list', cdpEndpoint), { signal: AbortSignal.timeout(5_000) }).then(response => response.json());
for (const target of targets.filter(target => target.type === 'page')) {
  const candidate = await DevTools.connect(target.webSocketDebuggerUrl);
  if (await candidate.evaluate('Boolean(window.mare?.receive && window.ipc?.postMessage)')) {
    tools = candidate;
    break;
  }
  candidate.close();
}
assert.ok(tools, 'No Maré interface was found on the supplied CDP endpoint.');
const runId = randomBytes(8).toString('hex');
const routePrefix = `/__mare_smoke_${runId}`;
const publicCookie = `mare_public_${runId}`;
const privateCookie = `mare_private_${runId}`;
const downloadContent = Buffer.from(`Maré native download integration fixture ${runId}\n`, 'utf8');
const requests = [];
const checks = [];
const testTabs = [];
let originalActive;
let fixtureOrigin;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (!pathname.startsWith(`${routePrefix}/`)) { response.writeHead(404).end(); return; }
  const route = pathname.slice(routePrefix.length);
  requests.push({ route, cookie: request.headers.cookie || '', time: Date.now() });
  response.setHeader('Cache-Control', 'no-store');
  if (route === '/set-public') response.setHeader('Set-Cookie', `${publicCookie}=1; Path=${routePrefix}/; HttpOnly; SameSite=Lax`);
  if (route === '/set-private') response.setHeader('Set-Cookie', `${privateCookie}=1; Path=${routePrefix}/; HttpOnly; SameSite=Lax`);
  if (route === '/download') {
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="mare-smoke.txt"',
      'Content-Length': downloadContent.length,
    });
    response.end(downloadContent);
    return;
  }
  const titles = {
    '/a': 'Maré Smoke A', '/b': 'Maré Smoke B', '/private': 'Maré Smoke Private',
    '/same-title-a': 'Maré Smoke Same', '/same-title-b': 'Maré Smoke Same',
  };
  const title = `${titles[route] || `Maré Smoke Fixture ${route}`} ${runId}`;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>A local integration fixture for real native navigation.</p><a href="${routePrefix}/b">Next page</a><a href="${routePrefix}/download">Download fixture</a></main></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
const fixtureUrl = route => `${fixtureOrigin}${routePrefix}${route}`;
const send = command => tools.evaluate(`window.ipc.postMessage(${JSON.stringify(JSON.stringify(command))}); true`);
const snapshot = () => tools.evaluate('window.__mareSmoke?.state');
const active = state => state?.tabs?.find(tab => tab.id === state.active_id);
async function navigate(route) {
  const url = fixtureUrl(route);
  await send({ cmd: 'navigate', url });
  return until(`native navigation to ${route}`, async () => {
    const state = await snapshot();
    const tab = active(state);
    return tab?.url === url && !tab.loading && tab.title.includes(runId) && state;
  });
}
function passed(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

try {
  await tools.evaluate(`(() => {
    const original = window.mare.receive;
    window.__mareSmoke = { original, state: null };
    window.mare.receive = state => { window.__mareSmoke.state = typeof state === 'string' ? JSON.parse(state) : state; original(state); };
  })()`);
  await send({ cmd: 'ready' });
  const initial = await until('initial native snapshot', snapshot);
  originalActive = initial.active_id;
  await send({ cmd: 'new_tab', url: 'mare://start', private: false });
  let state = await until('new public tab', async () => {
    const state = await snapshot();
    return state.active_id !== originalActive && active(state)?.url === 'mare://start' && state;
  });
  const normalId = state.active_id;
  testTabs.push(normalId);
  state = await navigate('/a');
  assert.ok(requests.some(request => request.route === '/a'), 'The HTTP fixture did not receive a real browser request.');
  assert.equal(active(state).title, `Maré Smoke A ${runId}`);
  passed('real HTTP navigation and document title');

  await navigate('/b');
  await send({ cmd: 'back' });
  await until('native back history', async () => {
    const state = await snapshot();
    return active(state)?.url === fixtureUrl('/a') && active(state)?.title === `Maré Smoke A ${runId}` && !active(state).loading;
  });
  await send({ cmd: 'forward' });
  await until('native forward history', async () => {
    const state = await snapshot();
    return active(state)?.url === fixtureUrl('/b') && !active(state).loading;
  });
  passed('native back and forward');

  await navigate('/same-title-a');
  state = await navigate('/same-title-b');
  assert.equal(active(state).title, `Maré Smoke Same ${runId}`, 'A second page with the same document.title lost its title.');
  await until('identical document title persisted for the second URL', async () => {
    const state = await persisted();
    return state.tabs.some(tab => tab.id === normalId && tab.url === fixtureUrl('/same-title-b') && tab.title === `Maré Smoke Same ${runId}`);
  });
  passed('identical document titles preserved across different URLs');
  await navigate('/b');

  await send({ cmd: 'toggle_bookmark' });
  await send({ cmd: 'add_reading' });
  state = await until('bookmark and reading persistence', async () => {
    const state = await persisted();
    return state.bookmarks.some(item => item.url === fixtureUrl('/b')) && state.reading_list.some(item => item.url === fixtureUrl('/b')) && state;
  });
  assert.ok(state.history.some(item => item.url === fixtureUrl('/a')), 'Real visits were not persisted.');
  assert.ok(state.tabs.some(tab => tab.id === normalId && tab.url === fixtureUrl('/b')), 'The public session was not saved.');
  passed('bookmarks, reading list, visit history and public session persistence');

  await navigate('/set-public');
  await navigate('/cookie-normal');
  assert.ok(requests.findLast(request => request.route === '/cookie-normal').cookie.includes(`${publicCookie}=1`), 'The normal profile did not retain the fixture cookie.');
  await send({ cmd: 'new_tab', url: fixtureUrl('/private'), private: true });
  state = await until('private page', async () => {
    const state = await snapshot();
    return active(state)?.private && active(state)?.url === fixtureUrl('/private') && !active(state).loading && state;
  });
  const privateId = state.active_id;
  testTabs.push(privateId);
  assert.ok(!requests.findLast(request => request.route === '/private').cookie.includes(`${publicCookie}=`), 'A normal-profile cookie leaked into the private profile.');
  await navigate('/set-private');
  const rawProfile = await readFile(stateFile, 'utf8');
  assert.ok(!rawProfile.includes(fixtureUrl('/private')) && !rawProfile.includes(fixtureUrl('/set-private')), 'Private URLs were persisted.');
  assert.ok(!(await persisted()).tabs.some(tab => tab.private), 'A private tab was persisted.');
  await send({ cmd: 'activate', id: normalId });
  await navigate('/cookie-after-private');
  const normalCookies = requests.findLast(request => request.route === '/cookie-after-private').cookie;
  assert.ok(normalCookies.includes(`${publicCookie}=1`), 'The private tab disturbed normal-profile cookies.');
  assert.ok(!normalCookies.includes(`${privateCookie}=`), 'A private-profile cookie leaked into the normal profile.');
  passed('bidirectional cookie isolation and private-session exclusion');

  await send({ cmd: 'navigate', url: fixtureUrl('/download') });
  const download = await until('completed native download', async () => {
    const state = await persisted();
    return state.downloads.find(item => item.filename.endsWith('mare-smoke.txt') && item.status === 'completed');
  }, 25_000);
  const downloadDirectory = await realpath(join(profile, 'Downloads'));
  const downloadedPath = await realpath(download.path);
  const downloadRelative = relative(downloadDirectory, downloadedPath);
  assert.ok(downloadRelative && downloadRelative !== '..' && !downloadRelative.startsWith(`..${sep}`) && !isAbsolute(downloadRelative), 'The completed download escaped its profile Downloads directory.');
  assert.deepEqual(await readFile(downloadedPath), downloadContent, 'The downloaded bytes differ from the HTTP response.');
  passed('native attachment download, destination containment and exact bytes');

  await navigate('/before-clear');
  await send({ cmd: 'clear_data' });
  await until('asynchronous cookie clearing', async () => {
    const before = Date.now();
    await navigate(`/after-clear-${before}`);
    const request = requests.findLast(request => request.route === `/after-clear-${before}`);
    return request && !request.cookie.includes(`${publicCookie}=`);
  }, 25_000);
  passed('asynchronous normal-profile cookie and site-data clearing');

  console.log(JSON.stringify({ success: true, passed: checks.length, checks }, null, 2));
} catch (error) {
  console.error(`FAIL ${error.message}`);
  console.error(JSON.stringify({ success: false, passed: checks.length, checks }));
  process.exitCode = 1;
} finally {
  try {
    const state = await persisted();
    for (const bookmark of state.bookmarks.filter(item => item.url.startsWith(`${fixtureOrigin}${routePrefix}/`))) {
      await send({ cmd: 'remove_bookmark', id: bookmark.id });
    }
    for (const item of state.reading_list.filter(item => item.url.startsWith(`${fixtureOrigin}${routePrefix}/`))) {
      await send({ cmd: 'remove_reading', id: item.id });
    }
  } catch {}
  for (const id of testTabs.reverse()) {
    try { await send({ cmd: 'close_tab', id }); } catch {}
  }
  if (originalActive !== undefined) {
    try { await send({ cmd: 'activate', id: originalActive }); } catch {}
  }
  try { await tools.evaluate('if(window.__mareSmoke){window.mare.receive=window.__mareSmoke.original;delete window.__mareSmoke;}'); } catch {}
  tools.close();
  await new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  });
}
