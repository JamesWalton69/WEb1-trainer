#!/usr/bin/env node
// index.mjs — FitTrainer API. Zero npm dependencies: node:http + node:sqlite.
//
//   npm run server
//
// SECURITY MODEL — read this before changing HOST.
// The server has no authentication of its own. It binds to 127.0.0.1 so it is
// unreachable from the internet, and nginx in front of it enforces a single
// shared password with HTTP Basic Auth. That is deliberate: the app has no
// accounts and no login screen.
//
// If you bind to a non-loopback address you are publishing an unauthenticated,
// writable database to the internet. The server refuses to do that unless you
// set FITTRAINER_TOKEN (requests must then send `X-FitTrainer-Token`) or
// explicitly set FITTRAINER_ALLOW_INSECURE=1.
//
// Env: PORT, HOST, FITTRAINER_DB, FITTRAINER_TOKEN, FITTRAINER_ALLOW_INSECURE

import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import {
  openDatabase,
  readState,
  upsertSession,
  listSessions,
  deleteSession,
  upsertRoutine,
  listRoutines,
  tombstoneRoutine,
  mergeProgression,
  getProgression,
  mergeFreezes,
  listFreezes,
  setProfileValues,
  getProfile,
  HttpError,
} from './db.mjs';
import {
  registerUser,
  loginUser,
  invalidateSession,
  requestPasswordReset,
  confirmPasswordReset,
  getSession,
  verifyCsrfProtection,
} from './auth.mjs';
import {
  startMfaEnrollment,
  confirmMfaEnrollment,
  verifyMfaForSession,
  disableMfa,
} from './mfa.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.FITTRAINER_DB || join(ROOT, 'server', 'data', 'fittrainer.sqlite');
const TOKEN = process.env.FITTRAINER_TOKEN || '';
const ALLOW_INSECURE = process.env.FITTRAINER_ALLOW_INSECURE === '1';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const MAX_BODY = 1_000_000; // 1 MB — a full history push is a few hundred KB

if (!LOOPBACK.has(HOST) && !TOKEN && !ALLOW_INSECURE) {
  console.error(
    `Refusing to bind ${HOST}:${PORT} with no authentication.\n\n` +
      `This API can read and overwrite your whole workout database. Pick one:\n` +
      `  1. Leave HOST unset (127.0.0.1) and let nginx handle Basic Auth  <- recommended\n` +
      `  2. Set FITTRAINER_TOKEN=<a long random string>\n` +
      `  3. Set FITTRAINER_ALLOW_INSECURE=1 if the network is genuinely trusted\n`,
  );
  process.exit(1);
}

const db = openDatabase(DB_FILE);

// ===== helpers =====

// `close` adds `Connection: close`, which makes Node hang up once the response
// is flushed. That matters when we stop reading a request part-way through: on a
// keep-alive connection the rest of the upload would otherwise still be arriving
// with nobody left to read it.
function send(res, status, payload, { close = false } = {}) {
  if (res.headersSent || res.writableEnded) return; // already answered
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (close) headers.Connection = 'close';
  res.writeHead(status, headers);
  res.end(body);
}

/**
 * Read and JSON-parse a request body. Rejects with an HttpError the caller's
 * catch turns into a response.
 *
 * `shape` is what the route can actually use, and checking it here is the
 * difference between a clear 400 and a lie: `POST /api/sync` with a body of
 * `"hello"` used to parse fine, match none of the `body.sessions` lookups, and
 * answer `{applied:{sessions:0,routines:0}}` — telling a client its workout was
 * stored when nothing had been.
 *
 *   'object' — a JSON object, nothing else.
 *   'list'   — an object or an array (POST /api/sessions takes a bare array).
 *   'any'    — also strings and numbers, for PATCH /api/profile/:key.
 */
function readBody(req, res, shape = 'object') {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];

    // Both request and response can end more than once between them (a client
    // that aborts right as the body finishes, say), and a second settle would
    // otherwise be a silent no-op that hides which outcome won.
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (size > MAX_BODY) {
        // Answer before hanging up. Calling req.destroy() straight away — which
        // this used to do — resets the socket before the 413 can be written, so
        // the browser sees a network error, api.js treats it as retriable, and
        // the oversized payload goes back in the outbox to fail again forever.
        req.pause();
        send(res, 413, { error: `Request body exceeds ${MAX_BODY} bytes` }, { close: true });
        fail(new HttpError(413, 'Request body too large'));
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return done({});

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fail(new HttpError(400, 'Body is not valid JSON'));
      }

      // typeof null is 'object' and an array is one too, so neither test can be
      // left to typeof alone.
      const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
      if (shape === 'object' && !isObject) {
        return fail(new HttpError(400, 'Body must be a JSON object'));
      }
      if (shape === 'list' && !isObject && !Array.isArray(parsed)) {
        return fail(new HttpError(400, 'Body must be a JSON object or array'));
      }
      return done(parsed === null ? {} : parsed);
    });

    // 'aborted' fires when the client vanishes mid-upload; without it this
    // promise never settles and the request handler leaks.
    req.on('aborted', () => fail(new HttpError(400, 'Request aborted')));
    req.on('error', fail);
  });
}

/**
 * Run a batch of writes as one unit.
 *
 * BEGIN IMMEDIATE takes the write lock up front, so two devices syncing at the
 * same moment queue behind each other instead of one dying halfway through with
 * SQLITE_BUSY. The rollback's own failure is swallowed on purpose: if BEGIN
 * never took, ROLLBACK throws "no transaction is active" and that error would
 * replace the one actually worth reading.
 */
function inTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch { /* nothing to roll back */ }
    throw err;
  }
}

function tokenOk(req) {
  if (!TOKEN) return true;
  const given = String(req.headers['x-fittrainer-token'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || '127.0.0.1';
}

function getSessionFromReq(req) {
  const authHeader = req.headers['authorization'];
  let sid = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sid = authHeader.slice(7).trim();
  } else if (req.headers['x-session-id']) {
    sid = String(req.headers['x-session-id']).trim();
  }
  return sid ? getSession(db, sid) : null;
}

function requireAuthenticatedSession(req) {
  const session = getSessionFromReq(req);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session;
}

// ===== routes =====
//
// Every write is a row-level upsert (see db.mjs), so two devices syncing at
// once cannot clobber each other's data. There is no endpoint that replaces
// the whole database.

async function route(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const seg = pathname.split('/').filter(Boolean); // ['api', 'sessions', ':id']

  if (seg[0] !== 'api') throw new HttpError(404, 'Not found');
  const [, resource, id] = seg;

  // ===== AUTH ROUTES =====
  if (resource === 'auth') {
    const action = seg[2];
    const subAction = seg[3];
    const ip = getClientIp(req);

    if (action === 'register' && method === 'POST') {
      const body = await readBody(req, res);
      const user = registerUser(db, body);
      return send(res, 201, user);
    }

    if (action === 'login' && method === 'POST') {
      const body = await readBody(req, res);
      const result = loginUser(db, { ...body, ip });
      return send(res, 200, result);
    }

    if (action === 'logout' && method === 'POST') {
      const session = getSessionFromReq(req);
      if (session) {
        verifyCsrfProtection(req, session);
        invalidateSession(db, session.id);
      }
      return send(res, 200, { ok: true, message: 'Logged out successfully' });
    }

    if (action === 'password-reset') {
      if (subAction === 'request' && method === 'POST') {
        const body = await readBody(req, res);
        const result = requestPasswordReset(db, { ...body, ip });
        return send(res, 200, result);
      }
      if (subAction === 'confirm' && method === 'POST') {
        const body = await readBody(req, res);
        const result = confirmPasswordReset(db, { ...body, ip });
        return send(res, 200, result);
      }
    }

    if (action === 'mfa') {
      if (subAction === 'enroll' && method === 'POST') {
        const session = requireAuthenticatedSession(req);
        verifyCsrfProtection(req, session);
        const body = await readBody(req, res);
        const result = startMfaEnrollment(db, session.user_id, body.currentPassword);
        return send(res, 200, result);
      }
      if (subAction === 'confirm' && method === 'POST') {
        const session = requireAuthenticatedSession(req);
        verifyCsrfProtection(req, session);
        const body = await readBody(req, res);
        const result = confirmMfaEnrollment(db, session.user_id, body.code);
        return send(res, 200, result);
      }
      if (subAction === 'verify' && method === 'POST') {
        const body = await readBody(req, res);
        const session = getSessionFromReq(req);
        const sid = session ? session.id : body.sessionId;
        const result = verifyMfaForSession(db, sid, body);
        return send(res, 200, result);
      }
      if (subAction === 'disable' && method === 'POST') {
        const session = requireAuthenticatedSession(req);
        verifyCsrfProtection(req, session);
        const body = await readBody(req, res);
        const result = disableMfa(db, session.user_id, body);
        return send(res, 200, result);
      }
    }

    if (action === 'me' && method === 'GET') {
      const session = requireAuthenticatedSession(req);
      const user = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?').get(session.user_id);
      return send(res, 200, {
        user,
        session: {
          id: session.id,
          mfaVerified: Boolean(session.mfa_verified),
          expiresAt: session.expires_at,
        },
      });
    }

    throw new HttpError(404, `No auth route for ${method} ${pathname}`);
  }

  // If a request provides a session token, enforce CSRF and MFA verification
  const reqSession = getSessionFromReq(req);
  if (reqSession) {
    verifyCsrfProtection(req, reqSession);
    const mfa = db.prepare('SELECT enabled FROM user_mfa WHERE user_id = ?').get(reqSession.user_id);
    if (mfa && mfa.enabled === 1 && reqSession.mfa_verified !== 1) {
      throw new HttpError(403, 'Multi-factor authentication verification required');
    }
  }

  // GET /api/health — for systemd, nginx and a quick curl after deploying.
  if (method === 'GET' && resource === 'health') {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM sessions').get();
    return send(res, 200, { ok: true, sessions: n, db: DB_FILE, node: process.version });
  }

  // GET /api/state — one round trip for app load.
  if (method === 'GET' && resource === 'state') {
    return send(res, 200, readState(db, Number(url.searchParams.get('limit')) || 500));
  }

  // POST /api/sync — push local changes, get the merged result back.
  // The client sends only what it has; anything absent is left alone.
  if (method === 'POST' && resource === 'sync') {
    const body = await readBody(req, res);
    const applied = inTransaction(() => {
      const counts = { sessions: 0, routines: 0, freezes: 0 };
      for (const s of asArray(body.sessions)) {
        upsertSession(db, s);
        counts.sessions++;
      }
      for (const r of asArray(body.routines)) {
        upsertRoutine(db, r);
        counts.routines++;
      }
      if (body.progression) mergeProgression(db, body.progression);
      if (body.profile) setProfileValues(db, body.profile);
      if (body.freezes) counts.freezes = mergeFreezes(db, asArray(body.freezes));
      return counts;
    });
    return send(res, 200, { applied, ...readState(db, Number(body.limit) || 500) });
  }

  if (resource === 'sessions') {
    if (method === 'GET') {
      return send(res, 200, { sessions: listSessions(db, Number(url.searchParams.get('limit')) || 500) });
    }
    if (method === 'POST') {
      const body = await readBody(req, res, 'list');
      const incoming = asArray(body.sessions ?? body);
      inTransaction(() => {
        for (const s of incoming) upsertSession(db, s);
      });
      return send(res, 200, { saved: incoming.length });
    }
    if (method === 'DELETE' && id) {
      return send(res, deleteSession(db, id) ? 200 : 404, { deleted: id });
    }
  }

  if (resource === 'routines') {
    // ?kind=template narrows to the template library; with no parameter the
    // caller gets both kinds, which is what a client rebuilding its local copy
    // wants.
    if (method === 'GET') {
      const kind = url.searchParams.get('kind');
      return send(res, 200, {
        routines: listRoutines(db, kind ? { kind } : {}),
      });
    }
    if (method === 'PUT' && id) {
      const body = await readBody(req, res);
      upsertRoutine(db, { ...body, id });
      return send(res, 200, { saved: id });
    }
    if (method === 'POST') {
      const body = await readBody(req, res);
      upsertRoutine(db, body);
      return send(res, 200, { saved: body.id });
    }
    if (method === 'DELETE' && id) {
      return send(res, tombstoneRoutine(db, id) ? 200 : 404, { deleted: id });
    }
  }

  if (resource === 'progression') {
    if (method === 'GET') return send(res, 200, { progression: getProgression(db) });
    if (method === 'PATCH' || method === 'POST') {
      const body = await readBody(req, res);
      mergeProgression(db, body.progression ?? body);
      return send(res, 200, { progression: getProgression(db) });
    }
  }

  if (resource === 'profile') {
    if (method === 'GET') return send(res, 200, { profile: getProfile(db) });
    if (method === 'PATCH' || method === 'POST' || method === 'PUT') {
      // With a :key in the path the body may be a bare string — PATCH
      // /api/profile/displayName with "Riddhiman" is the natural way to write
      // one value — so only the keyless form insists on an object.
      const body = await readBody(req, res, id ? 'any' : 'object');
      setProfileValues(db, id ? { [id]: body?.value ?? body } : (body.profile ?? body));
      return send(res, 200, { profile: getProfile(db) });
    }
  }

  throw new HttpError(404, `No route for ${method} ${pathname}`);
}

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// ===== server =====

const server = createServer((req, res) => {
  // `new URL` throws on a malformed Host header, and a Host is trivially
  // attacker-controlled: `Host: ]` from any script on the internet used to throw
  // here, outside every try/catch, and take the process down. systemd restarts
  // it, but a loop of those is an outage. Fall back to a fixed authority — only
  // the path and query are ever read.
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(res, 400, { error: 'Malformed request URL' });
    }
  }

  if (!tokenOk(req)) return send(res, 401, { error: 'Invalid or missing X-FitTrainer-Token' });

  // route() is async, so a throw inside it lands here and nowhere else.
  route(req, res, url).catch((err) => {
    if (res.headersSent) return;
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`${req.method} ${url.pathname} ->`, err);
    send(res, status, { error: err.message || 'Internal error' });
  });
});

// A 413 hangs up mid-upload, which the client sees as a connection reset; Node
// surfaces that as a socket error with no handler and would crash the process.
server.on('clientError', (err, socket) => {
  if (socket.writable && !socket.destroyed) {
    const status = err.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large' : '400 Bad Request';
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  }
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`FitTrainer API listening on http://${HOST}:${PORT}`);
  console.log(`  database: ${DB_FILE}`);
  console.log(`  auth:     ${TOKEN ? 'X-FitTrainer-Token required' : 'none (expects nginx Basic Auth in front)'}`);
  if (!LOOPBACK.has(HOST) && !TOKEN) {
    console.warn('  WARNING: bound to a public interface with no token. Anyone who can reach this port can read and overwrite your data.');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another copy of the API is probably running:`);
    console.error(`  sudo systemctl status fittrainer-api`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

// ===== shutdown =====

let shuttingDown = false;

function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${reason}, shutting down.`);

  // Stop accepting new work, then close the WAL. An unclean exit leaves a -wal
  // file that the next start has to recover, and a mid-write kill can cost the
  // last transaction.
  server.close(() => {
    try {
      db.close();
    } catch { /* already closed */ }
    process.exit(code);
  });

  // A held-open keep-alive connection would otherwise stall server.close()
  // past systemd's TimeoutStopSec, turning a clean stop into a SIGKILL.
  server.closeIdleConnections?.();
  setTimeout(() => {
    try {
      db.close();
    } catch { /* already closed */ }
    process.exit(code);
  }, 3000).unref();
}

// systemd sends SIGTERM on `systemctl stop` / `restart`; close the WAL cleanly.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => shutdown(`${signal} received`));
}

// Last line of defence. Without these, one unexpected throw outside a request —
// a bad SQLite page, a filesystem error during a write — exits immediately and
// takes the open WAL with it. Logging first means journalctl says why, and the
// non-zero exit lets systemd's Restart=always do its job.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaught exception', 1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  shutdown('unhandled rejection', 1);
});


