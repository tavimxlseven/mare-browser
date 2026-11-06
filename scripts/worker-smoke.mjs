#!/usr/bin/env node
// Exercise the real compiled --native-app entry point without creating a browser window.
// Node 24+, no npm dependencies. CI should run this after cargo build --release.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const argumentsByName = new Map(process.argv.slice(2).map(argument => {
  const equals = argument.indexOf('=');
  return equals < 0 ? [argument, true] : [argument.slice(0, equals), argument.slice(equals + 1)];
}));
if (argumentsByName.has('--help')) {
  console.log('node scripts/worker-smoke.mjs --exe=<path to the compiled Mare.exe or mare-browser.exe>');
  process.exit(0);
}
assert.equal(typeof argumentsByName.get('--exe'), 'string', 'Pass the compiled executable with --exe=.');
const executable = await realpath(resolve(argumentsByName.get('--exe')));
assert.ok((await stat(executable)).isFile(), '--exe must point to a file.');
const temporaryRoot = await realpath(tmpdir());
const profilePrefix = 'mare-worker-smoke-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const runId = randomBytes(8).toString('hex');
const workers = [];
const pids = new Set();
const checks = [];

function pidExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function bounded(promise, description, milliseconds = 8_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

class Worker {
  sequence = 0;
  pending = new Map();
  buffer = '';
  stderr = '';
  closed = false;
  constructor(id, directory) {
    this.id = id;
    this.child = spawn(executable, ['--native-app', id, '--data-dir', directory], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer, 'utf8') > 256 * 1024) { this.fail(new Error(`${id} exceeded the response framing limit.`)); return; }
      while (this.buffer.includes('\n')) {
        const newline = this.buffer.indexOf('\n');
        const line = this.buffer.slice(0, newline).replace(/\r$/, '');
        this.buffer = this.buffer.slice(newline + 1);
        let response;
        try { response = JSON.parse(line); } catch { this.fail(new Error(`${id} wrote a non-JSON response.`)); return; }
        const pending = this.pending.get(response.id);
        if (!pending) { this.fail(new Error(`${id} returned an unexpected request ID.`)); return; }
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        pending.resolve(response);
      }
    });
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4096); });
    this.child.stdin.on('error', error => this.fail(new Error(`${id} input closed: ${error.message}`)));
    this.child.on('error', error => this.fail(error));
    this.exited = new Promise(resolveExit => this.child.once('close', (code, signal) => {
      this.closed = true;
      if (this.pending.size) this.fail(new Error(`${id} exited before replying (code ${code}): ${this.stderr.trim()}`));
      resolveExit({ code, signal });
    }));
    workers.push(this);
  }
  static async open(id, directory) {
    const worker = new Worker(id, directory);
    await bounded(once(worker.child, 'spawn'), `${id} process spawn`);
    assert.ok(worker.child.pid > 0);
    pids.add(worker.child.pid);
    const hello = await worker.request('hello');
    assert.equal(hello.error, null);
    assert.equal(hello.result.app_id, id);
    assert.equal(hello.result.protocol_version, 1);
    return worker;
  }
  fail(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  request(method, params = {}) {
    if (this.closed || this.child.stdin.writableEnded) return Promise.reject(new Error(`${this.id} is not accepting requests.`));
    const id = ++this.sequence;
    const promise = new Promise((resolveResponse, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.id}.${method} did not respond.`)); }, 8_000);
      this.pending.set(id, { resolve: resolveResponse, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return promise;
  }
  async closeGracefully() {
    if (!this.child.stdin.writableEnded) this.child.stdin.end();
    const exit = await bounded(this.exited, `${this.id} EOF shutdown`);
    assert.equal(exit.code, 0, `${this.id} failed on graceful EOF: ${this.stderr.trim()}`);
    assert.equal(exit.signal, null);
    assert.ok(!pidExists(this.child.pid), `${this.id} PID remained alive after close.`);
  }
  async cleanup() {
    if (this.closed) return;
    this.child.stdin.end();
    const exit = await Promise.race([this.exited.then(() => true), delay(500).then(() => false)]);
    if (!exit) { this.child.kill(); await bounded(this.exited, `${this.id} cleanup shutdown`); }
  }
}

function passed(name) { checks.push(name); console.log(`PASS ${name}`); }
try {
  let [notes, calculator] = await Promise.all([
    Worker.open('notes', join(profile, 'notes')),
    Worker.open('calculator', join(profile, 'calculator')),
  ]);
  assert.notEqual(notes.child.pid, calculator.child.pid);
  assert.ok(pidExists(notes.child.pid) && pidExists(calculator.child.pid));
  passed('real executable starts two independent native workers and answers the versioned protocol');

  const arithmetic = await calculator.request('calculate', { expression: '2 + 3 * (4 - 1)' });
  assert.equal(arithmetic.error, null);
  assert.equal(arithmetic.result.value, 11);
  const decimal = await calculator.request('calculate', { expression: '-(-2,5) / +0.5' });
  assert.equal(decimal.result.value, 5);
  for (const expression of ['1/0', 'process.exit(0)', '(1+2', '1e9999']) {
    const invalid = await calculator.request('calculate', { expression });
    assert.ok(invalid.error?.message && invalid.result === null, `Invalid arithmetic was accepted: ${expression}`);
  }
  const recovered = await calculator.request('calculate', { expression: '6 * 7' });
  assert.equal(recovered.result.value, 42);
  assert.ok(pidExists(notes.child.pid), 'Calculator operations interrupted the Notes worker.');
  passed('Rust arithmetic handles precedence and decimals and recovers after rejected expressions');

  const created = await notes.request('create', { title: `Worker QA ${runId}`, body: 'Initial text' });
  const noteId = created.result.selected_id;
  assert.ok(Number.isInteger(noteId));
  const updated = await notes.request('update', { id: noteId, title: `Saved ${runId}`, body: 'Persisted text' });
  assert.equal(updated.result.notes.find(note => note.id === noteId).body, 'Persisted text');
  const rejected = await notes.request('update', { id: noteId, body: 123 });
  assert.ok(rejected.error?.message);
  const afterInvalid = await notes.request('list');
  assert.equal(afterInvalid.result.notes.find(note => note.id === noteId).body, 'Persisted text');
  const invalidMethod = await notes.request('../notes.json', { body: 'Do not overwrite' });
  assert.ok(invalidMethod.error?.message);
  await notes.closeGracefully();
  notes = await Worker.open('notes', join(profile, 'notes'));
  const restarted = await notes.request('list');
  assert.equal(restarted.result.notes.find(note => note.id === noteId).title, `Saved ${runId}`);
  assert.equal(restarted.result.notes.find(note => note.id === noteId).body, 'Persisted text');
  const deleted = await notes.request('delete', { id: noteId });
  assert.ok(!deleted.result.notes.some(note => note.id === noteId));
  passed('native Notes CRUD persists across process restart and invalid operations do not corrupt data');

  const finalNote = await notes.request('create', { title: `EOF ${runId}`, body: 'Before final save' });
  const finalId = finalNote.result.selected_id;
  const finalUpdate = notes.request('update', { id: finalId, body: `Saved immediately before EOF ${runId}` });
  notes.child.stdin.end();
  assert.equal((await finalUpdate).error, null);
  await Promise.all([notes.closeGracefully(), calculator.closeGracefully()]);
  const onDisk = JSON.parse(await readFile(join(profile, 'notes', 'notes.json'), 'utf8'));
  assert.equal(onDisk.notes.find(note => note.id === finalId).body, `Saved immediately before EOF ${runId}`);
  assert.ok(!onDisk.notes.some(note => note.id === noteId));
  assert.ok([...pids].every(pid => !pidExists(pid)), 'A native worker remained alive after EOF shutdown.');
  passed('queued note save is durable on immediate EOF and every real child process exits cleanly');
  console.log(JSON.stringify({ success: true, passed: checks.length, checks }, null, 2));
} catch (error) {
  console.error(`FAIL ${error.message}`);
  console.error(JSON.stringify({ success: false, passed: checks.length, checks }));
  process.exitCode = 1;
} finally {
  await Promise.all(workers.map(worker => worker.cleanup()));
  // Delete only the exact temporary directory created by this invocation, after checking its parent.
  const resolvedProfile = await realpath(profile);
  assert.equal(dirname(resolvedProfile).toLowerCase(), temporaryRoot.toLowerCase(), 'Unexpected temporary profile parent; refusing cleanup.');
  assert.ok(basename(resolvedProfile).startsWith(profilePrefix), 'Unexpected temporary profile name; refusing cleanup.');
  assert.equal(resolvedProfile.toLowerCase(), profile.toLowerCase(), 'Temporary profile was redirected; refusing cleanup.');
  await rm(resolvedProfile, { recursive: true, force: false });
}
