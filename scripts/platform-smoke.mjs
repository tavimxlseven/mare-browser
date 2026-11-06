#!/usr/bin/env node
// Native platform integration, using only a disposable QA profile and loopback HTTP/CDP.
// node scripts/platform-smoke.mjs --cdp=http://127.0.0.1:9227 --profile=D:\DevCache\mare-platform-qa
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const args = new Map(process.argv.slice(2).map(argument => {
  const equals = argument.indexOf('=');
  return equals < 0 ? [argument, true] : [argument.slice(0, equals), argument.slice(equals + 1)];
}));
if (args.has('--help')) {
  console.log('node scripts/platform-smoke.mjs --cdp=http://127.0.0.1:9227 --profile=<absolute disposable QA profile>');
  process.exit(0);
}
const endpoint = new URL(args.get('--cdp') || 'http://127.0.0.1:9227');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'CDP must use a loopback address.');
const profile = args.get('--profile');
assert.ok(typeof profile === 'string' && isAbsolute(profile), 'Pass an absolute disposable QA profile with --profile=.');
assert.match(profile, /(?:qa|smoke)/i, 'The profile path must identify a disposable QA/smoke profile.');
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, 12_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(`UI evaluation failed: ${response.exceptionDetails.text}`);
    return response.result.value;
  }
  close() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP connection closed.')); }
    this.pending.clear(); this.socket.close();
  }
}

async function until(description, callback, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await callback(); if (value) return value; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`);
}
function pidExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
const persisted = async () => JSON.parse(await readFile(join(profile, 'state.json'), 'utf8'));

let tools;
await until('live Maré interface on the supplied CDP endpoint', async () => {
  const targets = await fetch(new URL('/json/list', endpoint), { signal: AbortSignal.timeout(5_000) }).then(response => response.json());
  for (const target of targets.filter(target => target.type === 'page')) {
    const candidate = await DevTools.connect(target.webSocketDebuggerUrl);
    if (await candidate.evaluate('Boolean(window.mare?.receive && window.ipc?.postMessage)')) { tools = candidate; return true; }
    candidate.close();
  }
  return false;
});

const runId = randomBytes(8).toString('hex');
const prefix = `/__mare_platform_${runId}`;
const counters = { page: 0, ad: 0, allowed: 0, alive: 0 };
const liveDocuments = [];
const checks = [];
const testPids = new Set();
let originalState, originalSettings, originalInstalled, testTabId, noteId, fixtureOrigin;
let requestSequence = 500_000;
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === `${prefix}/page`) {
    counters.page++;
    const documentId = `${runId}-${counters.page}`;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Maré Platform ${runId}</title><script src="/ads/cbr.js?run=${runId}"></script><script src="${prefix}/allowed.js"></script></head><body><main><h1>Native platform fixture</h1><p>Only local test resources are used.</p></main><script>setInterval(()=>fetch('${prefix}/alive?document=${documentId}',{cache:'no-store'}).catch(()=>{}),150);</script></body></html>`);
  } else if (url.pathname === '/ads/cbr.js' && url.searchParams.get('run') === runId) {
    counters.ad++;
    response.writeHead(200, { 'Content-Type': 'application/javascript' });
    response.end('window.__mareFixtureAdLoaded=true;');
  } else if (url.pathname === `${prefix}/allowed.js`) {
    counters.allowed++;
    response.writeHead(200, { 'Content-Type': 'application/javascript' });
    response.end(`window.__mareFixtureAllowed=${JSON.stringify(runId)};`);
  } else if (url.pathname === `${prefix}/alive`) {
    counters.alive++;
    liveDocuments.push(url.searchParams.get('document'));
    response.writeHead(204).end();
  } else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
const fixtureUrl = `${fixtureOrigin}${prefix}/page`;
const send = command => tools.evaluate(`window.ipc.postMessage(${JSON.stringify(JSON.stringify(command))}); true`);
const snapshot = () => tools.evaluate('window.__marePlatformSmoke?.state');
const events = () => tools.evaluate('window.__marePlatformSmoke?.events || []');
const activeTab = state => state?.tabs?.find(tab => tab.id === state.active_id);
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }

async function appRequest(id, method, params = {}, expectError = false) {
  const requestId = ++requestSequence;
  await send({ cmd: 'apps_request', id, method, params, request_id: requestId });
  const event = await until(`${id}.${method} native response`, async () => (await events()).find(event => event.kind === 'response' && event.app_id === id && event.payload?.id === requestId));
  assert.equal(Boolean(event.payload.error), expectError, `${id}.${method} returned an unexpected result: ${JSON.stringify(event.payload.error)}`);
  return event.payload;
}
async function openApp(id) {
  await send({ cmd: 'apps_open', id });
  const state = await until(`${id} native child process`, async () => {
    const state = await snapshot();
    const child = state?.apps?.running?.find(app => app.id === id && app.status === 'running');
    return state?.apps?.active_id === id && child?.pid > 0 && state;
  });
  const pid = state.apps.running.find(app => app.id === id && app.status === 'running').pid;
  assert.ok(pidExists(pid), `The ${id} PID does not exist in the operating system.`);
  testPids.add(pid);
  return pid;
}
async function waitForNoApps() {
  await until('all native app children reaped', async () => {
    const state = await snapshot();
    return state?.apps?.active_id == null && state?.apps?.process_count === 0 && [...testPids].every(pid => !pidExists(pid));
  });
}
async function waitForReload(previousPageCount) {
  return until('reloaded fixture and allowed subresource', async () => {
    const state = await snapshot();
    return counters.page > previousPageCount && counters.allowed >= counters.page && activeTab(state)?.url === fixtureUrl && !activeTab(state)?.loading && state;
  });
}

try {
  await tools.evaluate(`(() => {
    const originalReceive=window.mare.receive, originalApps=window.mare.appsEvent;
    window.__marePlatformSmoke={originalReceive,originalApps,state:null,events:[]};
    window.mare.receive=state=>{window.__marePlatformSmoke.state=typeof state==='string'?JSON.parse(state):state;originalReceive(state);};
    window.mare.appsEvent=event=>{const log=window.__marePlatformSmoke.events;log.push(event);if(log.length>300)log.shift();originalApps?.(event);};
  })()`);
  await send({ cmd: 'ready' });
  originalState = await until('initial native snapshot with app/protection capabilities', async () => {
    const state = await snapshot(); return state?.apps?.catalog && state?.protection && state;
  });
  assert.equal(originalState.apps.active_id, null, 'Start the platform smoke with no native app open.');
  originalSettings = { shield_enabled: originalState.settings.shield_enabled, shield_exceptions: [...(originalState.settings.shield_exceptions || [])] };
  originalInstalled = new Set(originalState.apps.catalog.filter(app => app.installed).map(app => app.id));
  await send({ cmd: 'settings', settings: { shield_enabled: true, shield_exceptions: originalSettings.shield_exceptions.filter(host => host !== '127.0.0.1') } });
  await send({ cmd: 'new_tab', url: fixtureUrl, private: false });
  let state = await until('protected native fixture', async () => {
    const state = await snapshot();
    return state?.active_id !== originalState.active_id && activeTab(state)?.url === fixtureUrl && !activeTab(state)?.loading && activeTab(state)?.title.includes(runId) && counters.allowed > 0 && state?.protection?.blocked > 0 && state;
  });
  testTabId = state.active_id;
  await delay(200);
  assert.equal(counters.ad, 0, 'The supposedly blocked ad script reached the HTTP server.');
  assert.equal(state.protection.status, 'active');
  assert.ok(state.protection.rules_count > 100_000, 'The bundled filter lists were not loaded.');
  passed('real network ad blocking while allowed scripts reach the loopback server');

  let pagesBefore = counters.page, adsBefore = counters.ad;
  await send({ cmd: 'shield_site_toggle', enabled: false });
  state = await waitForReload(pagesBefore);
  await until('site exception allows the ad request', () => counters.ad > adsBefore);
  assert.equal(state.protection.site_enabled, false);
  await until('site exception persisted', async () => (await persisted()).settings.shield_exceptions.includes('127.0.0.1'));
  pagesBefore = counters.page; adsBefore = counters.ad;
  await send({ cmd: 'shield_site_toggle', enabled: true });
  state = await waitForReload(pagesBefore);
  await until('protection blocks again after removing the exception', async () => (await snapshot())?.protection?.blocked > 0);
  await delay(150); assert.equal(counters.ad, adsBefore);
  pagesBefore = counters.page;
  await send({ cmd: 'shield_toggle', enabled: false });
  state = await waitForReload(pagesBefore);
  await until('global disable permits the ad request', () => counters.ad > adsBefore);
  assert.equal(state.protection.enabled, false);
  await until('global disable persisted', async () => (await persisted()).settings.shield_enabled === false);
  pagesBefore = counters.page; adsBefore = counters.ad;
  await send({ cmd: 'shield_toggle', enabled: true });
  await waitForReload(pagesBefore);
  await until('global protection restored', async () => (await snapshot())?.protection?.blocked > 0);
  await delay(150); assert.equal(counters.ad, adsBefore);
  passed('per-site and global protection toggles change actual requests and persist settings');

  state = await snapshot();
  const preservedTab = { id: state.active_id, url: activeTab(state).url };
  const pageCountBeforeApps = counters.page;
  const retainedDocument = `${runId}-${pageCountBeforeApps}`;
  await until('current fixture document heartbeat', () => liveDocuments.at(-1) === retainedDocument);
  for (const id of ['notes', 'calculator']) if (!originalInstalled.has(id)) {
    await send({ cmd: 'apps_install', id });
    await until(`${id} installed`, async () => (await snapshot()).apps.catalog.some(app => app.id === id && app.installed));
  }
  assert.equal((await snapshot()).apps.process_count, 0, 'Installing a bundled app started a child process.');
  const calculatorPid = await openApp('calculator');
  const calculation = await appRequest('calculator', 'calculate', { expression: '2 + 3 * (4 - 1)' });
  assert.equal(calculation.result.value, 11);
  const invalidCalculation = await appRequest('calculator', 'calculate', { expression: '1 / 0' }, true);
  assert.match(invalidCalculation.error.message, /zero/i);
  passed('on-demand native process and Rust arithmetic with real error responses');

  const notesPid = await openApp('notes');
  assert.notEqual(notesPid, calculatorPid);
  assert.ok(pidExists(calculatorPid), 'Opening Notes terminated the Calculator app tab.');
  assert.equal((await snapshot()).apps.process_count, 2);
  const backgroundCalculation = await appRequest('calculator', 'calculate', { expression: '7 * 6' });
  assert.equal(backgroundCalculation.result.value, 42, 'A background native app could not process a request.');
  assert.equal((await snapshot()).apps.active_id, 'notes', 'A background response stole the foreground app.');
  const created = await appRequest('notes', 'create', { title: `Platform QA ${runId}`, body: 'Original native note' });
  noteId = created.result.selected_id;
  assert.ok(Number.isInteger(noteId));
  const updatedBody = `Queued final edit ${runId}`;
  await send({ cmd: 'apps_request', id: 'notes', method: 'update', params: { id: noteId, body: updatedBody }, request_id: ++requestSequence });
  await send({ cmd: 'apps_close', id: 'notes' });
  await until('only the explicitly closed Notes worker is reaped', async () => !pidExists(notesPid) && (await snapshot()).apps.process_count === 1);
  assert.ok(pidExists(calculatorPid), 'Closing the Notes tab also terminated Calculator.');
  const notebook = JSON.parse(await readFile(join(profile, 'apps', 'notes', 'notes.json'), 'utf8'));
  assert.equal(notebook.notes.find(note => note.id === noteId)?.body, updatedBody, 'The last queued save was lost on immediate app close.');
  const reopenedNotesPid = await openApp('notes');
  assert.notEqual(reopenedNotesPid, notesPid);
  const listed = await appRequest('notes', 'list');
  assert.equal(listed.result.notes.find(note => note.id === noteId)?.body, updatedBody);
  const deleted = await appRequest('notes', 'delete', { id: noteId });
  assert.ok(!deleted.result.notes.some(note => note.id === noteId));
  noteId = null;
  assert.equal(await openApp('calculator'), calculatorPid, 'Selecting an existing app tab created another process.');
  await send({ cmd: 'apps_close', id: 'notes' });
  await until('background Notes worker closed without touching foreground Calculator', async () => !pidExists(reopenedNotesPid) && (await snapshot()).apps.process_count === 1);
  assert.equal((await snapshot()).apps.active_id, 'calculator');
  await send({ cmd: 'activate', id: preservedTab.id });
  await until('web tab selected while native app stays open', async () => {
    const state = await snapshot();
    return state.apps.active_id == null && state.apps.process_count === 1 && pidExists(calculatorPid);
  });
  assert.equal(await openApp('calculator'), calculatorPid);
  await send({ cmd: 'apps_close', id: 'calculator' });
  await waitForNoApps();
  passed('native app tabs preserve background workers, durable notes and explicit per-tab shutdown');

  state = await snapshot();
  assert.equal(state.active_id, preservedTab.id);
  assert.equal(activeTab(state).url, preservedTab.url);
  assert.equal(counters.page, pageCountBeforeApps, 'The browser document was recreated while opening or closing an app.');
  const aliveBefore = counters.alive;
  await until('the retained browser document resumes', () => counters.alive > aliveBefore);
  assert.equal(liveDocuments.at(-1), retainedDocument, 'A different document resumed after the app cycle.');
  assert.ok(originalState.tabs.every(original => state.tabs.some(tab => tab.id === original.id && tab.url === original.url)));
  passed('browser tabs and the existing document survive the complete native app cycle');
  console.log(JSON.stringify({ success: true, passed: checks.length, checks }, null, 2));
} catch (error) {
  console.error(`FAIL ${error.message}`);
  console.error(JSON.stringify({ success: false, passed: checks.length, checks }));
  process.exitCode = 1;
} finally {
  try {
    const openIds = (await snapshot())?.apps?.open_ids || [];
    for (const id of openIds) await send({ cmd: 'apps_close', id });
    await waitForNoApps();
    if (noteId !== null && noteId !== undefined) {
      await openApp('notes');
      await appRequest('notes', 'delete', { id: noteId });
      await send({ cmd: 'apps_close', id: 'notes' });
      await waitForNoApps();
    }
    if (originalInstalled) for (const id of ['notes', 'calculator']) if (!originalInstalled.has(id)) await send({ cmd: 'apps_uninstall', id });
    if (originalSettings) await send({ cmd: 'settings', settings: originalSettings });
    if (testTabId !== undefined) await send({ cmd: 'close_tab', id: testTabId });
    if (originalState) await send({ cmd: 'activate', id: originalState.active_id });
  } catch (error) { console.error(`Cleanup: ${error.message}`); }
  try {
    await tools.evaluate('if(window.__marePlatformSmoke){window.mare.receive=window.__marePlatformSmoke.originalReceive;window.mare.appsEvent=window.__marePlatformSmoke.originalApps;delete window.__marePlatformSmoke;}');
  } catch {}
  tools.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
