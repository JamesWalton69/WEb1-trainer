#!/usr/bin/env node
// test-sync.mjs — proves the client's offline-first sync against the real API.
//
//   npm run test:sync
//
// This is the test that matters for the bug that started all this: workout
// history disappearing. It drives src/lib/localStore.js directly, with a fake
// localStorage and fetch pointed at a real server on a throwaway database, and
// asserts the situations that used to lose data:
//
//   * feedback written after the session log must land on the same row
//   * a save made while offline must reach the server later, exactly once
//   * a browser that clears its storage must recover history from the server
//   * two devices must converge instead of overwriting each other
//   * a payload the server will never accept must not block the queue behind it
//   * a full localStorage must not report a workout as saved
//   * "Push-ups" and "Pushups" must share one progression row

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// `import()` of a bare Windows path throws ERR_UNSUPPORTED_ESM_URL_SCHEME: Node
// reads the drive letter as a protocol ('e:'). file:// URLs work on both.
const lib = (name) => pathToFileURL(join(ROOT, 'src', 'lib', name)).href;
const PORT = 3500 + (process.pid % 300);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'fittrainer-sync-'));

// ===== fake browser =====

// One store object per "device"; swapping it is how we simulate a second phone
// or a browser that has wiped its data.
let store = new Map();
// Set to an Error to make every write throw, the way Safari private mode and a
// full quota do.
let storageError = null;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (storageError) throw storageError;
    store.set(k, String(v));
  },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
// Node 22 ships a read-only `navigator`, so patch the one property we read.
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

// api.js fetches the relative path /api/...; give it an origin, and a switch to
// simulate the server being unreachable.
const realFetch = globalThis.fetch;
let offline = false;
globalThis.fetch = (url, opts) => {
  if (offline) return Promise.reject(new Error('simulated offline'));
  return realFetch(String(url).startsWith('http') ? url : ORIGIN + url, opts);
};

const child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
  env: { ...process.env, PORT: String(PORT), FITTRAINER_DB: join(DATA_DIR, 'sync.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => (serverLog += d));
child.stderr.on('data', (d) => (serverLog += d));

const { logWorkoutSession, getWorkoutHistory, saveCustomWorkout, getCustomWorkouts,
        deleteCustomWorkout, saveUserProgression, getUserProgression, updateUserProgression,
        getDisplayName, setDisplayName,
        getSyncStatus } = await import(lib('localStore.js'));
const { invalidateState, flushOutbox } = await import(lib('api.js'));

// weeklyPlan.js does `import workoutRoutine from './workout-routine.json'`, which
// Vite handles but plain Node rejects without an import attribute. Supplying the
// attribute in a load hook is what lets this test check applyProgression against
// the real plan instead of a copy that could drift out of step with it.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return nextLoad(url, { ...context, importAttributes: { type: 'json' } });
    return nextLoad(url, context);
  },
});
const { applyProgression } = await import(lib('weeklyPlan.js'));

const USER = 'guest';
const serverState = async () => (await realFetch(`${ORIGIN}/api/state`)).json();

let passed = 0;
async function check(name, fn) {
  await fn();
  console.log(`  ok  ${name}`);
  passed++;
}

// The client caches /state for 2s to collapse a page load's reads; tests move
// faster than that, so drop the cache between them.
const settle = async () => { invalidateState(); await new Promise((r) => setTimeout(r, 25)); };

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await realFetch(`${ORIGIN}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server never came up.\n${serverLog}`);
}

// ===== tests =====

async function run() {
  await waitForServer();

  await check('a logged session reaches the server', async () => {
    const id = await logWorkoutSession(USER, {
      id: 'w-100', status: 'Completed', active_minutes: 24.5, pauses: 0, last_exercise: 'Plank',
      routine_name: 'Push Day',
    });
    assert.equal(id, 'w-100');
    await settle();
    const remote = await serverState();
    assert.equal(remote.sessions.length, 1);
    assert.equal(remote.sessions[0].last_exercise, 'Plank');
    assert.equal(remote.sessions[0].routine_name, 'Push Day');
  });

  await check('feedback lands on the same row instead of being dropped', async () => {
    // This is the exact PostWorkout sequence: log on mount, then the user taps
    // "Too Hard". The old dedupe key made the second write look like a
    // duplicate and threw it away.
    await logWorkoutSession(USER, {
      id: 'w-100', status: 'Completed', active_minutes: 24.5, pauses: 0, last_exercise: 'Plank',
      routine_name: 'Push Day', feedback: 'hard',
    });
    await settle();
    const local = JSON.parse(localStorage.getItem('fittrainer_sessions_guest'));
    assert.equal(local.length, 1, 'must not create a second local row');
    assert.equal(local[0].feedback, 'hard');
    const remote = await serverState();
    assert.equal(remote.sessions.length, 1, 'must not create a second server row');
    assert.equal(remote.sessions[0].feedback, 'hard');
  });

  await check('a save made offline is queued, then delivered once', async () => {
    offline = true;
    await logWorkoutSession(USER, {
      id: 'w-200', status: 'Incomplete', active_minutes: 6, pauses: 2, last_exercise: 'Squats',
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(JSON.parse(localStorage.getItem('fittrainer_outbox')).length, 1, 'should be queued');
    assert.equal((await getSyncStatus()).pending, 1);

    offline = false;
    await settle();
    await getWorkoutHistory(USER); // flushes the outbox on load
    await settle();
    const remote = await serverState();
    assert.equal(remote.sessions.length, 2);
    assert.ok(remote.sessions.some((s) => s.id === 'w-200'));
    assert.equal(localStorage.getItem('fittrainer_outbox'), null, 'outbox should be drained');
  });

  await check('a browser that clears its storage recovers history from the server', async () => {
    // The failure the whole rewrite exists to fix: Safari evicting localStorage
    // after 7 days, or the user clearing site data, used to mean the history
    // was simply gone.
    store = new Map();
    await settle();
    const history = await getWorkoutHistory(USER);
    assert.equal(history.length, 2, 'both sessions should come back');
    assert.equal(history.find((s) => s.id === 'w-100').feedback, 'hard');
    // ...and be re-cached locally so the next load works offline.
    assert.equal(JSON.parse(localStorage.getItem('fittrainer_sessions_guest')).length, 2);
  });

  await check('two devices converge instead of overwriting each other', async () => {
    // Device B was offline while A logged w-100/w-200, and has a session of its
    // own that the server has never seen.
    store = new Map();
    localStorage.setItem('fittrainer_sessions_guest', JSON.stringify([{
      id: 'w-300', status: 'Completed', active_minutes: 12, pauses: 0, last_exercise: 'Burpees',
      date: '2026-09-03', timestamp: '2026-09-03T06:00:00.000Z', updated_at: '2026-09-03T06:30:00.000Z',
    }]));
    await settle();

    const history = await getWorkoutHistory(USER);
    assert.deepEqual(history.map((s) => s.id).sort(), ['w-100', 'w-200', 'w-300']);
    await settle();
    // B's local-only session must have been uploaded, not just displayed.
    const remote = await serverState();
    assert.deepEqual(remote.sessions.map((s) => s.id).sort(), ['w-100', 'w-200', 'w-300']);
  });

  await check('the newer edit of the same session wins', async () => {
    // A stale device re-pushes an old copy of w-100 with no feedback.
    store = new Map();
    localStorage.setItem('fittrainer_sessions_guest', JSON.stringify([{
      id: 'w-100', status: 'Incomplete', active_minutes: 0.5, pauses: 9, last_exercise: 'STALE',
      date: '2026-09-01', timestamp: '2026-09-01T06:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z',
    }]));
    await settle();
    const history = await getWorkoutHistory(USER);
    const w100 = history.find((s) => s.id === 'w-100');
    assert.equal(w100.last_exercise, 'Plank', 'the stale copy must not win');
    assert.equal(w100.feedback, 'hard');
    await settle();
    assert.equal((await serverState()).sessions.find((s) => s.id === 'w-100').last_exercise, 'Plank');
  });

  await check('routines sync, and a delete does not come back', async () => {
    store = new Map();
    const id = await saveCustomWorkout(USER, null, 'Core Blast', [{ name: 'Plank', reps: 1, tension: 60 }], { sets: 3 });
    await settle();
    assert.equal((await serverState()).routines.length, 1);

    // A second device sees it.
    store = new Map();
    await settle();
    assert.equal((await getCustomWorkouts(USER)).length, 1);

    await deleteCustomWorkout(USER, id);
    await settle();
    assert.equal((await getCustomWorkouts(USER)).length, 0);

    // The first device, still holding the routine locally, must not resurrect it.
    store = new Map();
    localStorage.setItem('fittrainer_routines_guest', JSON.stringify([{
      id, name: 'Core Blast', exercises: [], settings: {}, updatedAt: '2020-01-01T00:00:00.000Z',
    }]));
    await settle();
    assert.equal((await getCustomWorkouts(USER)).length, 0, 'tombstone must hold');
  });

  await check('progression merges per exercise rather than per blob', async () => {
    store = new Map();
    await saveUserProgression(USER, { Pushups: { reps: 4, tension: 0 } });
    await settle();
    // Second device only ever touched a different exercise.
    store = new Map();
    await saveUserProgression(USER, { 'Jump Squats': { reps: -2, tension: 0 } });
    await settle();
    const merged = await getUserProgression(USER);
    // Keys are canonical on the way in, so both devices' rows survive under the
    // folded spelling.
    assert.deepEqual(merged, {
      pushup: { reps: 4, tension: 0 },
      jumpsquat: { reps: -2, tension: 0 },
    });
  });

  await check('"Push-ups" and "Pushups" tune the same exercise', async () => {
    // The plan spells it "Push-ups"; the builder used to spell it "Pushups".
    // Before exerciseKey.js those were two rows, so a user who set up a custom
    // routine and then ran the weekly plan got none of their own progression.
    store = new Map();
    await saveUserProgression(USER, { 'Push-ups': { reps: 6, tension: 0 } });
    await settle();
    const merged = await getUserProgression(USER);
    assert.equal(merged.pushup.reps, 6, 'the hyphenated name must land on the same row');
    assert.equal(Object.keys(merged).filter((k) => k.startsWith('pushup')).length, 1);

    // And applyProgression must find it from either spelling.
    assert.equal(applyProgression([{ name: 'Pushups', reps: 10, tension: 2 }], merged)[0].reps, 16);
    assert.equal(applyProgression([{ name: 'Push-ups', reps: 10, tension: 2 }], merged)[0].reps, 16);
    assert.equal(applyProgression([{ name: 'PUSH UPS', reps: 10, tension: 2 }], merged)[0].reps, 16);
  });

  await check('"too hard" eases off but stops at the floor', async () => {
    // The floor has to be tested against what the user actually performed, not
    // against the base reps. This once added the stored offset a second time, so
    // 3 reps with a -2 offset was checked as 3 + (-2) - 2 = -1 < 1 → refuse,
    // while 1 rep with a -6 offset read as 1 + (-6) - 2 and the offset kept
    // running away below the floor.
    //
    // Offline on purpose: getUserProgression lets server rows win, and the push
    // from the previous step is still in flight, so leaving the network in would
    // make each read a race against it. The arithmetic is the subject here.
    store = new Map();
    offline = true;
    try {
      // A 5-rep exercise with no history: two rounds of "too hard" reach 1 rep.
      const routine = (reps, tension = 2) => [{ name: 'Chair dips', reps, tension }];
      await updateUserProgression(USER, routine(5), 'hard');
      assert.equal((await getUserProgression(USER)).chairdip.reps, -2);

      await updateUserProgression(USER, routine(3), 'hard');
      assert.equal((await getUserProgression(USER)).chairdip.reps, -4, 'should reach the floor exactly');

      // At 1 rep there is nowhere left to go.
      await updateUserProgression(USER, routine(1), 'hard');
      assert.equal((await getUserProgression(USER)).chairdip.reps, -4, 'must not go below MIN_REPS');

      // "Too easy" has no ceiling, and must survive the round trip through
      // storage rather than being recomputed from the base each time.
      await updateUserProgression(USER, routine(1), 'easy');
      assert.equal((await getUserProgression(USER)).chairdip.reps, -2);

      // Static holds use their own floor of 5 seconds.
      store = new Map();
      await updateUserProgression(USER, [{ name: 'Plank', reps: 1, tension: 10 }], 'hard');
      assert.equal((await getUserProgression(USER)).plank.tension, -5);
      await updateUserProgression(USER, [{ name: 'Plank', reps: 1, tension: 5 }], 'hard');
      assert.equal((await getUserProgression(USER)).plank.tension, -5, 'must not go below MIN_HOLD');

      // "right" means leave it exactly where it is.
      await updateUserProgression(USER, [{ name: 'Plank', reps: 1, tension: 5 }], 'right');
      assert.equal((await getUserProgression(USER)).plank.tension, -5);
    } finally {
      offline = false;
      store = new Map();
    }
  });

  await check('a rejected payload is dropped instead of blocking the queue', async () => {
    // The wedge this fixes: the outbox used to re-queue on any failure and stop.
    // A payload the server will refuse forever therefore sat at the head of the
    // queue and no workout ever synced again.
    store = new Map();
    localStorage.setItem('fittrainer_outbox', JSON.stringify([
      { sessions: [{ date: '2026-09-06', status: 'Completed' }] },   // no id → 400
      { sessions: [{ id: 'w-900', date: '2026-09-06', timestamp: '2026-09-06T06:00:00.000Z',
                     status: 'Completed', active_minutes: 20, pauses: 0, last_exercise: 'Burpees',
                     updated_at: '2026-09-06T06:30:00.000Z' }] },
    ]));

    const sent = await flushOutbox();
    assert.equal(sent, 1, 'the good payload must get through');
    assert.equal(localStorage.getItem('fittrainer_outbox'), null, 'the queue must drain');
    await settle();
    assert.ok((await serverState()).sessions.some((s) => s.id === 'w-900'),
      'the payload behind the bad one must have landed');
  });

  await check('a retriable failure keeps the queue in order', async () => {
    store = new Map();
    const entry = (id) => ({ sessions: [{ id, date: '2026-09-06', timestamp: `2026-09-06T07:0${id.at(-1)}:00.000Z`,
      status: 'Completed', active_minutes: 5, pauses: 0, last_exercise: 'Plank',
      updated_at: '2026-09-06T07:30:00.000Z' }] });
    localStorage.setItem('fittrainer_outbox', JSON.stringify([entry('w-a1'), entry('w-a2')]));

    offline = true;
    assert.equal(await flushOutbox(), 0);
    assert.equal(JSON.parse(localStorage.getItem('fittrainer_outbox')).length, 2,
      'nothing may be dropped just because the network is down');

    offline = false;
    assert.equal(await flushOutbox(), 2);
    assert.equal(localStorage.getItem('fittrainer_outbox'), null);
  });

  await check('a full localStorage does not report a phantom save', async () => {
    // Six call sites used to ignore writeLocal's return value, so a quota error
    // was logged and the app cheerfully said "Saved". The session now goes to the
    // server synchronously — it is the only copy left — and getSyncStatus admits
    // that storage is broken.
    store = new Map();
    await settle();
    storageError = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    try {
      await logWorkoutSession(USER, {
        id: 'w-950', status: 'Completed', active_minutes: 15, pauses: 0, last_exercise: 'Wall sit',
      });
    } finally {
      storageError = null;
    }
    await settle();
    assert.ok((await serverState()).sessions.some((s) => s.id === 'w-950'),
      'the session must reach the server even though storage refused it');
    assert.equal((await getSyncStatus()).storageFailed, true, 'the UI has to be able to say so');
  });

  await check('the display name follows you to a new device', async () => {
    store = new Map();
    assert.equal(setDisplayName('  Riddhiman  '), 'Riddhiman', 'should trim');

    // setDisplayName pushes in the background, so wait for it to land rather
    // than assuming a fixed delay.
    let onServer = '';
    for (let i = 0; i < 40 && onServer !== 'Riddhiman'; i++) {
      await new Promise((r) => setTimeout(r, 25));
      onServer = (await serverState()).profile?.userName || '';
    }
    assert.equal(onServer, 'Riddhiman');

    // A second device with empty storage learns the name instead of falling
    // back to "Athlete".
    store = new Map();
    await settle();
    assert.equal(await getDisplayName(), 'Riddhiman');
    assert.equal(localStorage.getItem('userName'), 'Riddhiman');

    // And a device holding an older name is corrected, not humoured.
    store = new Map();
    localStorage.setItem('userName', 'Stale Name');
    await settle();
    assert.equal(await getDisplayName(), 'Riddhiman');
  });

  await check('reads still work with the server down', async () => {
    // Load once online so the device has a local copy, the way a real user
    // would have before losing signal.
    store = new Map();
    await settle();
    const online = await getWorkoutHistory(USER);
    assert.ok(online.length >= 3);

    offline = true;
    await settle();
    const offlineHistory = await getWorkoutHistory(USER);
    assert.equal(offlineHistory.length, online.length, 'must fall back to the local copy');
    const status = await getSyncStatus();
    assert.equal(status.reachable, false);
    offline = false;
  });
}

// Same teardown race as server/test.mjs: on Windows the SQLite file stays
// locked until the child has actually exited, so removing the temp directory
// immediately throws EPERM and fails a run in which every check passed.
async function cleanup() {
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
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
