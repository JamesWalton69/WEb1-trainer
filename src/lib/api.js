// api.js — talks to the FitTrainer server at /api.
//
// Two rules shape everything here:
//
//   1. The network is optional. Every function resolves instead of throwing —
//      it returns null (or false) when the server is unreachable. localStore.js
//      writes to localStorage first and treats the server as a replica, so a
//      dead server, a flaky phone connection, or a plane makes the app slower
//      to sync, never broken.
//
//   2. Same origin, always. In production nginx serves the bundle and proxies
//      /api to 127.0.0.1:3001; in dev, vite.config.js proxies /api to the same
//      place. So there is no base URL to configure, no CORS, and the nginx
//      Basic Auth cookie/header rides along for free on every request.
//
// Anything that fails to send is parked in an outbox in localStorage and
// retried on the next load, so closing the tab mid-sync does not lose a
// workout.

const BASE = '/api';
const TIMEOUT_MS = 8000;
const OUTBOX_KEY = 'fittrainer_outbox';

// Health is cached so a dozen components mounting at once do not each probe.
let healthPromise = null;
let healthCheckedAt = 0;
const HEALTH_TTL_MS = 15000;

// Same idea for /state, on a much shorter fuse: long enough to collapse one
// page load's worth of reads, short enough that a refresh always re-fetches.
let statePromise = null;
let stateFetchedAt = 0;
const STATE_TTL_MS = 2000;

// Set when nginx last answered 401. Read by getSyncStatus so the UI can say
// "sign in again" instead of the misleading "offline".
let unauthorized = false;

/** True if the last request was rejected for want of the Basic Auth password. */
export function isUnauthorized() {
  return unauthorized;
}

/**
 * One request. Never throws.
 *
 * Returns the parsed body on success, or a marker object explaining the
 * failure. The distinction matters enormously for the outbox: a 400 will fail
 * identically forever, so retrying it blocks every payload behind it, while a
 * network error will very likely succeed on the next attempt and must be kept.
 * The previous version returned null for both and could wedge sync permanently.
 */
async function request(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      // Send the Basic Auth credentials nginx asked for.
      credentials: 'same-origin',
      cache: 'no-store',
    });

    if (res.status === 401 || res.status === 403) {
      // nginx wants the password again. Not the payload's fault, and not a
      // reason to discard it — the user re-authenticating fixes it.
      unauthorized = true;
      console.warn('[api] not authorised — reload and re-enter the password');
      return { ok: false, retriable: true, status: res.status };
    }
    unauthorized = false;

    if (!res.ok) {
      // 4xx other than auth: this payload is malformed or refused, and will be
      // refused again. 5xx and 429: the server's problem, worth another go.
      const retriable = res.status >= 500 || res.status === 408 || res.status === 429;
      let detail = '';
      try {
        detail = (await res.json())?.error || '';
      } catch { /* not JSON; the status is enough */ }
      console.warn(`[api] ${method} ${path} -> ${res.status}${detail ? ` (${detail})` : ''}`);
      return { ok: false, retriable, status: res.status, error: detail };
    }

    return await res.json();
  } catch {
    // Offline, server down, DNS failure, or the 8s timeout. Always worth
    // retrying.
    return { ok: false, retriable: true, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// A request() result that is a failure marker rather than a response body.
const failed = (r) => r != null && r.ok === false && typeof r.status === 'number';

// Callers that only care whether they got data. Keeps the old `?? null` shape
// so nothing downstream has to learn about the marker objects.
const dataOrNull = (r) => (failed(r) ? null : r);

/** True if the server answered a health check recently. Never throws. */
export async function isServerReachable() {
  const fresh = Date.now() - healthCheckedAt < HEALTH_TTL_MS;
  if (!healthPromise || !fresh) {
    healthCheckedAt = Date.now();
    healthPromise = request('GET', '/health').then((r) => Boolean(dataOrNull(r)?.ok));
  }
  return healthPromise;
}

/** Whole server state, or null when offline. */
export function pullState() {
  // The dashboard loads sessions, routines and progression one after another,
  // and each wants server state. Without this the page would make three
  // identical round trips on every visit; with it they share one.
  if (statePromise && Date.now() - stateFetchedAt < STATE_TTL_MS) return statePromise;
  stateFetchedAt = Date.now();
  statePromise = request('GET', '/state').then((r) => {
    const data = dataOrNull(r);
    // Do not cache a failure — the next call should retry, not inherit null.
    if (!data) { statePromise = null; stateFetchedAt = 0; }
    return data;
  });
  return statePromise;
}

/** Drop the cached state so the next pull hits the server. Call after a push. */
export function invalidateState() {
  statePromise = null;
  stateFetchedAt = 0;
}

/**
 * Push local changes and get the merged state back. Returns null when the push
 * did not land. A retriable failure queues the payload; a rejection does not,
 * because replaying it would only fail again and hold up everything behind it.
 */
export async function pushChanges(payload) {
  if (!payload || !hasContent(payload)) return null;
  const res = await request('POST', '/sync', payload);
  if (failed(res)) {
    if (res.retriable) queue(payload);
    else console.error('[api] push rejected and dropped from the outbox:', res.status, res.error || '');
    return null;
  }
  invalidateState();
  return res;
}

/** Tombstone a routine server-side so other devices stop showing it. */
export async function deleteRoutineRemote(id) {
  const res = await request('DELETE', `/routines/${encodeURIComponent(id)}`);
  if (failed(res)) {
    // 404 means the server never had it, so the delete has already happened as
    // far as anyone can tell. Only queue when it might still be pending.
    if (res.retriable) {
      queue({ routines: [{ id, deleted: true, exercises: [], updatedAt: new Date().toISOString() }] });
    }
    return false;
  }
  invalidateState();
  return true;
}

// ===== outbox =====

// Bounds. The count cap stops an unbounded queue; the byte cap matters more,
// because one payload can carry 500 sessions and localStorage only has ~5 MB
// for the whole origin — the outbox filling it would break the main keys the
// app actually reads from.
const MAX_OUTBOX_ENTRIES = 50;
const MAX_OUTBOX_BYTES = 512_000;

function hasContent(p) {
  return Boolean(
    p.sessions?.length || p.routines?.length ||
    (p.progression && Object.keys(p.progression).length) ||
    (p.profile && Object.keys(p.profile).length),
  );
}

function readOutbox() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    // Drop anything that is not a usable payload. A corrupt entry — hand-edited
    // storage, a half-written value, a shape from an older version — would
    // otherwise be retried forever and block the queue.
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p === 'object' && hasContent(p)) : [];
  } catch {
    return [];
  }
}

/** Newest entries win when trimming: they carry the most recent state. */
function trimOutbox(entries) {
  let next = entries.slice(-MAX_OUTBOX_ENTRIES);
  while (next.length > 1 && JSON.stringify(next).length > MAX_OUTBOX_BYTES) next = next.slice(1);
  return next;
}

function queue(payload) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(trimOutbox([...readOutbox(), payload])));
  } catch { /* storage full or blocked; the data is still in the main keys */ }
}

function writeOutbox(entries) {
  try {
    if (entries.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(trimOutbox(entries)));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch { /* ignore */ }
}

/**
 * Replay anything queued while offline. Safe to call on every load: the
 * server's upserts are idempotent, so a replayed payload cannot double-count.
 * Returns the number of payloads drained.
 *
 * Rejected payloads are dropped rather than re-queued. That is the fix for a
 * real wedge: the old loop treated a 400 exactly like a timeout, re-queued it,
 * and stopped — so one malformed row parked at the head of the queue meant no
 * workout ever synced again.
 */
export async function flushOutbox() {
  const pending = readOutbox();
  if (!pending.length) return 0;

  let sent = 0;
  let dropped = 0;

  for (let i = 0; i < pending.length; i++) {
    const res = await request('POST', '/sync', pending[i]);
    if (!failed(res)) { sent++; continue; }
    if (res.retriable) {
      // Still offline (or unauthorised). Keep this entry and everything after
      // it, in order, for the next attempt.
      writeOutbox(pending.slice(i));
      if (sent || dropped) invalidateState();
      return sent;
    }
    // Permanently refused. Log it loudly — this is lost data, not a retry.
    dropped++;
    console.error('[api] dropping an unsyncable queued payload:', res.status, res.error || '');
  }

  writeOutbox([]);
  if (sent) invalidateState();
  return sent;
}

/** How many pushes are waiting for the server to come back. */
export function pendingCount() {
  return readOutbox().length;
}
