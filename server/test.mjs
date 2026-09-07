#!/usr/bin/env node
// test.mjs — smoke test for the FitTrainer API. Zero dependencies.
//
//   npm run test:server
//
// Spawns the real server against a throwaway database, exercises every route,
// and asserts the sync guarantees the app depends on: writes are idempotent,
// stale writes lose, and two devices editing different rows never clobber.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION } from './db.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 3200 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}/api`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'fittrainer-test-'));
const DB_PATH = join(DATA_DIR, 'test.sqlite');

const child = spawn(process.execPath, [join(HERE, 'index.mjs')], {
  env: { ...process.env, PORT: String(PORT), FITTRAINER_DB: DB_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (d) => (serverLog += d));
child.stderr.on('data', (d) => (serverLog += d));

const api = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

// A hand-written request, for the things fetch() will not let us send: a
// malformed Host header, or a Content-Length that lies about the body.
function rawRequest(text) {
  return new Promise((resolve, reject) => {
    const socket = connect(PORT, '127.0.0.1', () => socket.write(text));
    let out = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('raw request timed out')); });
    socket.on('data', (d) => (out += d));
    socket.on('close', () => resolve({
      status: Number(out.split(' ')[1]) || 0,
      body: out.split('\r\n\r\n').slice(1).join('\r\n\r\n'),
    }));
    // A reset before any reply is itself a result — that is what the 413 bug
    // looked like — so resolve rather than reject and let the test judge.
    socket.on('error', (err) => resolve({ status: 0, body: '', error: err.code }));
  });
}

const session = (over = {}) => ({
  id: 's-1',
  date: '2026-09-04',
  timestamp: '2026-09-04T06:10:00.000Z',
  status: 'Completed',
  active_minutes: 31.5,
  pauses: 1,
  last_exercise: 'Plank',
  updated_at: '2026-09-04T06:40:00.000Z',
  ...over,
});

let passed = 0;
async function check(name, fn) {
  await fn();
  console.log(`  ok  ${name}`);
  passed++;
}

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server never came up.\n${serverLog}`);
}

async function run() {
  await waitForServer();

  await check('health reports an empty database', async () => {
    const { status, json } = await api('GET', '/health');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.sessions, 0);
  });

  await check('sync accepts sessions, routines, progression and profile', async () => {
    const { status, json } = await api('POST', '/sync', {
      sessions: [session(), session({ id: 's-2', date: '2026-09-05', status: 'Incomplete', active_minutes: 8.2 })],
      routines: [{ id: 'r-1', name: 'My Core', exercises: [{ name: 'Plank', reps: 1, tension: 60 }], settings: { sets: 3 }, updatedAt: '2026-09-05T06:00:00.000Z' }],
      progression: { Pushups: { reps: 2, tension: 0 } },
      profile: { userName: 'RIDDHIMAN' },
    });
    assert.equal(status, 200);
    assert.deepEqual(json.applied, { sessions: 2, routines: 1 });
    assert.equal(json.sessions.length, 2);
    assert.equal(json.routines[0].name, 'My Core');
    assert.deepEqual(json.progression.Pushups, { reps: 2, tension: 0 });
    assert.equal(json.profile.userName, 'RIDDHIMAN');
  });

  await check('re-posting the same session does not duplicate it', async () => {
    await api('POST', '/sessions', { sessions: [session()] });
    await api('POST', '/sessions', { sessions: [session()] });
    const { json } = await api('GET', '/sessions');
    assert.equal(json.sessions.length, 2, 'expected still exactly 2 sessions');
  });

  await check('a newer write attaches post-workout feedback', async () => {
    await api('POST', '/sessions', {
      sessions: [session({ feedback: 'hard', updated_at: '2026-09-05T07:00:00.000Z' })],
    });
    const { json } = await api('GET', '/sessions');
    assert.equal(json.sessions.find((s) => s.id === 's-1').feedback, 'hard');
  });

  await check('a stale write loses to the newer row', async () => {
    await api('POST', '/sessions', {
      sessions: [session({ status: 'Incomplete', active_minutes: 0.1, pauses: 99, last_exercise: 'STALE', updated_at: '2020-01-01T00:00:00.000Z' })],
    });
    const s = (await api('GET', '/sessions')).json.sessions.find((x) => x.id === 's-1');
    assert.equal(s.last_exercise, 'Plank');
    assert.equal(s.active_minutes, 31.5);
    assert.equal(s.pauses, 1);
    assert.equal(s.feedback, 'hard', 'feedback must survive a stale write');
  });

  await check('two devices tuning different exercises do not clobber', async () => {
    await api('PATCH', '/progression', { progression: { 'Jump Squats': { reps: -2, tension: 0 } } });
    const { json } = await api('GET', '/progression');
    assert.deepEqual(json.progression, {
      Pushups: { reps: 2, tension: 0 },
      'Jump Squats': { reps: -2, tension: 0 },
    });
  });

  await check('deleting a routine tombstones it instead of dropping the row', async () => {
    assert.equal((await api('DELETE', '/routines/r-1')).status, 200);
    assert.equal((await api('GET', '/routines')).json.routines.length, 0);
    await api('PUT', '/routines/r-1', { name: 'Resurrected', exercises: [], updatedAt: '2020-01-01T00:00:00.000Z' });
    assert.equal((await api('GET', '/routines')).json.routines.length, 0, 'a stale sync must not resurrect it');
  });

  await check('bad input is rejected with 4xx, not a crash', async () => {
    assert.equal((await api('POST', '/sessions', { sessions: [{ date: '2026-09-05' }] })).status, 400);
    assert.equal((await api('PATCH', '/progression', { progression: [] })).status, 400);
    assert.equal((await api('GET', '/nope')).status, 404);
    assert.equal((await api('GET', '/../secret')).status, 404);
    const res = await fetch(`${BASE}/sync`, { method: 'POST', body: '{oops' });
    assert.equal(res.status, 400);
  });

  await check('a non-object body is refused instead of silently doing nothing', async () => {
    // The lie this fixes: `"hello"` parsed fine, matched none of body.sessions
    // / body.routines, and answered 200 {applied:{sessions:0,routines:0}} — so
    // the client crossed a workout off its outbox that the server never stored.
    for (const body of ['"hello"', '42', 'null', 'true', '[]']) {
      const res = await fetch(`${BASE}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      assert.equal(res.status, 400, `POST /sync with ${body} should be 400`);
      assert.match((await res.json()).error, /JSON object/);
    }
    // An empty body still means "nothing to apply", which the client relies on.
    const empty = await fetch(`${BASE}/sync`, { method: 'POST' });
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).applied, { sessions: 0, routines: 0 });
    // POST /api/sessions does take a bare array.
    assert.equal((await api('POST', '/sessions', [session({ id: 's-arr' })])).status, 200);
    assert.equal((await api('DELETE', '/sessions/s-arr')).status, 200);
  });

  await check('an oversized body gets a 413, not a dropped connection', async () => {
    // The distinction is the whole point: a reset looks like a network error to
    // src/lib/api.js, which marks it retriable and re-queues the payload to fail
    // in exactly the same way forever. A real 413 is terminal and gets dropped.
    const body = JSON.stringify({ sessions: [session({ last_exercise: 'x'.repeat(1_200_000) })] });
    const res = await rawRequest(
      `POST /api/sync HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
    assert.equal(res.status, 413, `expected 413, got ${res.status}${res.error ? ` (${res.error})` : ''}`);
    assert.match(res.body, /exceeds/);
    // ...and the server is still answering afterwards.
    assert.equal((await api('GET', '/health')).status, 200);
  });

  await check('a malformed Host header cannot kill the process', async () => {
    // `new URL(req.url, 'http://]')` throws, and it used to throw outside every
    // try/catch — one line of netcat from anywhere on the internet was an
    // outage, with systemd restart-looping behind it.
    for (const host of [']', 'a b', '%%%', '[::1', 'x:999999']) {
      const res = await rawRequest(
        `GET /api/health HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
      );
      assert.equal(res.status, 200, `Host: ${host} should still be served`);
    }
    assert.equal((await api('GET', '/health')).status, 200, 'server must still be up');
    assert.ok(child.exitCode === null, 'server must not have exited');
  });

  await check('the schema records its version so future columns can migrate', async () => {
    // CREATE TABLE IF NOT EXISTS is a no-op on an existing database, so without
    // this ledger a column added to the DDL would never appear on an upgrade and
    // every query touching it would fail at runtime.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  await check('the database survives a restart', async () => {
    const before = (await api('GET', '/state')).json;
    assert.equal(before.sessions.length, 2);
    assert.equal(before.profile.userName, 'RIDDHIMAN');
  });
}

// Windows keeps the SQLite file locked until the server process is genuinely
// gone, and child.kill() only asks it to leave. Removing the temp directory in
// the same tick fails with EPERM — which, thrown from .finally, failed a run
// whose every check had passed, and took the rest of `npm test` down with it
// through the && chain. So: ask, wait for the exit, retry, then give up
// quietly. A few KB left in the OS temp directory is not a test failure.
async function cleanup() {
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
      // Capped, because a wedged child must not hang the suite forever.
      const giveUp = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(giveUp); resolve(); });
    });
  }
  try {
    rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  } catch (err) {
    console.warn(`\n(left ${DATA_DIR} behind: ${err.code})`);
  }
}

run()
  .then(() => console.log(`\n${passed} checks passed.`))
  .catch((err) => {
    console.error(`\nFAILED: ${err.message}`);
    if (serverLog) console.error(`\n--- server output ---\n${serverLog}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
