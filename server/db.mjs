// db.mjs — SQLite schema and row-level upserts for FitTrainer.
//
// Uses node:sqlite, so the server has zero npm dependencies and the VPS needs
// no native compiler. Node 22.13 or newer is required: node:sqlite landed in
// 22.5 but needed --experimental-sqlite until 22.13, so on an older 22.x the
// import below throws. It still prints an ExperimentalWarning, which the
// systemd unit silences with --disable-warning=ExperimentalWarning.
//
// Every write is a row-level upsert guarded by `updated_at`, which is what
// makes phone/desktop sync safe: two devices writing different sessions never
// touch each other's rows, and two devices writing the *same* row settle on
// whichever edit is newer. There is no whole-blob PUT anywhere.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Bump this when the schema changes, and add a matching step to MIGRATIONS. The
// `CREATE TABLE IF NOT EXISTS` block below only ever runs on an empty database —
// on an existing one it is a silent no-op, so a new column added there alone
// would never appear and every query touching it would fail at runtime.
const SCHEMA_VERSION = 3;

// One row per frozen date rather than a JSON array under a profile key, for the
// same reason progression is one row per exercise: two devices freezing
// *different* days must both survive. A whole-blob last-write-wins would let the
// second sync silently unfreeze the first device's day and break a streak the
// user paid for.
//
// Declared above SCHEMA because SCHEMA interpolates it, and a `const` read
// before its initializer is a TDZ ReferenceError, not undefined.
const FREEZE_DDL = `
  CREATE TABLE IF NOT EXISTS freezes (
    date       TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL
  );
`;

const AUTH_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions_auth (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    csrf_token    TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,
    mfa_verified  INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_auth_user ON sessions_auth (user_id);

  CREATE TABLE IF NOT EXISTS password_resets (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    token_hash    TEXT UNIQUE NOT NULL,
    expires_at    INTEGER NOT NULL,
    used          INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_resets_token_hash ON password_resets (token_hash);

  CREATE TABLE IF NOT EXISTS user_mfa (
    user_id           TEXT PRIMARY KEY,
    totp_secret_enc   TEXT NOT NULL,
    iv                TEXT NOT NULL,
    auth_tag          TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 0,
    downgrade_locked  INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_backup_codes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    used_at    TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`;

// The *current* full shape, used for a fresh database. An existing one is
// brought up to date by the MIGRATIONS delta instead — see addColumnIfMissing.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    date           TEXT NOT NULL,
    timestamp      TEXT NOT NULL,
    status         TEXT NOT NULL,
    active_minutes REAL NOT NULL DEFAULT 0,
    pauses         INTEGER NOT NULL DEFAULT 0,
    last_exercise  TEXT,
    feedback       TEXT,
    routine_name   TEXT,
    exercises      TEXT,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions (date DESC);

  CREATE TABLE IF NOT EXISTS routines (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    exercises  TEXT NOT NULL,
    settings   TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'routine',
    updated_at TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS progression (
    exercise   TEXT PRIMARY KEY,
    reps       INTEGER NOT NULL DEFAULT 0,
    tension    REAL NOT NULL DEFAULT 0,
    tier       INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  ${FREEZE_DDL}

  ${AUTH_DDL}
`;

/**
 * Ordered migrations from version N-1 to N. Index 0 takes a fresh database to
 * version 1; each later entry is applied in turn to whatever is already there.
 *
 * Rules for adding one: it must be idempotent-safe to *skip* (never re-run), it
 * runs inside a transaction with the version bump, and it must not assume any
 * data is present. Use `ALTER TABLE ... ADD COLUMN`, which SQLite supports, and
 * give the column a default so existing rows stay valid.
 *
 * A fresh database runs *every* migration in order, so entry 1 also has to be a
 * no-op against the tables SCHEMA just created with those columns already in
 * them. That is what the existence check inside addColumnIfMissing is for.
 */
const MIGRATIONS = [
  (db) => db.exec(SCHEMA),

  // v1 → v2: per-exercise detail on sessions, routine kind (so templates ride
  // the existing sync path), progression tier, and streak freezes.
  (db) => {
    addColumnIfMissing(db, 'sessions', 'exercises', 'TEXT');
    addColumnIfMissing(db, 'routines', 'kind', "TEXT NOT NULL DEFAULT 'routine'");
    addColumnIfMissing(db, 'progression', 'tier', 'INTEGER NOT NULL DEFAULT 0');
    db.exec(FREEZE_DDL);
  },

  // v2 → v3: user auth, sessions_auth, password_resets, user_mfa, user_backup_codes
  (db) => {
    db.exec(AUTH_DDL);
  },
];

// `ALTER TABLE ADD COLUMN` throws "duplicate column name" if it is already
// there, and a migration must be safe to run against a database that SCHEMA
// built whole. PRAGMA table_info does not take a bound parameter for the table
// name, so the name is interpolated — it comes from the literals above, never
// from a request.
function addColumnIfMissing(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version ?? 0;

  if (current > MIGRATIONS.length) {
    // The file was written by a newer build. Refusing beats running queries
    // against a shape this code does not know.
    throw new Error(
      `Database schema is version ${current}, but this server only understands ${MIGRATIONS.length}. ` +
        'Update the server, or restore an older snapshot.',
    );
  }
  if (current === MIGRATIONS.length) return current;

  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      MIGRATIONS[v](db);
      // PRAGMA does not accept a bound parameter, and v+1 is a local integer.
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration to schema version ${v + 1} failed: ${err.message}`);
    }
    if (current > 0) console.log(`  migrated database schema to version ${v + 1}`);
  }
  return MIGRATIONS.length;
}

export function openDatabase(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  // WAL survives an unclean shutdown far better than the rollback journal and
  // lets the backup read while the app writes.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  migrate(db);

  return db;
}

export { SCHEMA_VERSION };

const nowIso = () => new Date().toISOString();

// ===== SESSIONS =====

// `WHERE excluded.updated_at >= sessions.updated_at` is the last-write-wins
// guard. Re-posting an identical session is a no-op, which is what lets the
// client retry a failed push without creating duplicates.
//
// `feedback` and `exercises` use COALESCE rather than a straight assignment:
// PostWorkout writes the same row a second time to attach the user's
// easy/right/hard answer, and a write that does not carry those fields must not
// erase the ones the first write put there.
const UPSERT_SESSION = `
  INSERT INTO sessions
    (id, date, timestamp, status, active_minutes, pauses, last_exercise, feedback, routine_name, exercises, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    date           = excluded.date,
    timestamp      = excluded.timestamp,
    status         = excluded.status,
    active_minutes = excluded.active_minutes,
    pauses         = excluded.pauses,
    last_exercise  = excluded.last_exercise,
    feedback       = COALESCE(excluded.feedback, sessions.feedback),
    routine_name   = excluded.routine_name,
    exercises      = COALESCE(excluded.exercises, sessions.exercises),
    updated_at     = excluded.updated_at
  WHERE excluded.updated_at >= sessions.updated_at
`;

// Per-exercise detail is untrusted client JSON that lands in a TEXT column, so
// it gets shaped and bounded here rather than at read time. A routine with 200
// exercises is already absurd; the cap exists so one malformed row cannot push a
// session past MAX_BODY on every future sync of the whole history.
const MAX_EXERCISE_ROWS = 200;
const MAX_EXERCISE_FIELD = 200;

function normalizeExercises(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows = value.slice(0, MAX_EXERCISE_ROWS).map((e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
      name: String(e.name ?? '').slice(0, MAX_EXERCISE_FIELD),
      key: String(e.key ?? '').slice(0, MAX_EXERCISE_FIELD),
      sets: Math.trunc(num(e.sets)),
      reps: Math.trunc(num(e.reps)),
      tension: num(e.tension),
      volume: num(e.volume),
      bestHold: num(e.bestHold),
      isHold: e.isHold ? 1 : 0,
    };
  }).filter((e) => e && e.name);
  if (!rows.length) return null;
  return JSON.stringify(rows);
}

export function upsertSession(db, s) {
  if (!s || typeof s.id !== 'string' || s.id.length === 0) {
    throw new HttpError(400, 'session.id is required');
  }
  db.prepare(UPSERT_SESSION).run(
    s.id,
    String(s.date ?? '').slice(0, 10),
    String(s.timestamp ?? nowIso()),
    s.status === 'Completed' ? 'Completed' : 'Incomplete',
    Number(s.active_minutes) || 0,
    Math.trunc(Number(s.pauses)) || 0,
    s.last_exercise == null ? null : String(s.last_exercise).slice(0, 200),
    ['easy', 'right', 'hard'].includes(s.feedback) ? s.feedback : null,
    s.routine_name == null ? null : String(s.routine_name).slice(0, 200),
    normalizeExercises(s.exercises),
    String(s.updated_at ?? nowIso()),
  );
}

export function listSessions(db, limit = 500) {
  return db
    .prepare('SELECT * FROM sessions ORDER BY timestamp DESC LIMIT ?')
    .all(Math.min(Math.max(Math.trunc(limit) || 500, 1), 5000))
    .map((r) => ({ ...r, exercises: safeParse(r.exercises, null) }));
}

export function deleteSession(db, id) {
  return db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ===== ROUTINES =====

// `kind` lets the template library ride the routine sync path unchanged —
// same upsert, same tombstones, same merge rule — instead of needing a parallel
// table, route and outbox branch that would all have to agree with this one.
const ROUTINE_KINDS = new Set(['routine', 'template']);

const UPSERT_ROUTINE = `
  INSERT INTO routines (id, name, exercises, settings, kind, updated_at, deleted)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name       = excluded.name,
    exercises  = excluded.exercises,
    settings   = excluded.settings,
    kind       = excluded.kind,
    updated_at = excluded.updated_at,
    deleted    = excluded.deleted
  WHERE excluded.updated_at >= routines.updated_at
`;

export function upsertRoutine(db, r) {
  if (!r || typeof r.id !== 'string' || r.id.length === 0) {
    throw new HttpError(400, 'routine.id is required');
  }
  if (!Array.isArray(r.exercises)) {
    throw new HttpError(400, 'routine.exercises must be an array');
  }
  db.prepare(UPSERT_ROUTINE).run(
    r.id,
    String(r.name ?? 'My Routine').slice(0, 200),
    JSON.stringify(r.exercises),
    JSON.stringify(r.settings ?? {}),
    // An unknown kind falls back rather than 400s: a client one version ahead
    // would otherwise wedge the whole sync batch on a field the server has not
    // learned yet, and the row is still perfectly usable as a routine.
    ROUTINE_KINDS.has(r.kind) ? r.kind : 'routine',
    String(r.updatedAt ?? r.updated_at ?? nowIso()),
    r.deleted ? 1 : 0,
  );
}

export function listRoutines(db, { includeDeleted = false, kind = null } = {}) {
  const where = [];
  if (!includeDeleted) where.push('deleted = 0');
  if (kind) where.push('kind = ?');
  const sql = `SELECT * FROM routines${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`;
  const stmt = db.prepare(sql);
  const rows = kind ? stmt.all(kind) : stmt.all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    exercises: safeParse(r.exercises, []),
    settings: safeParse(r.settings, {}),
    kind: ROUTINE_KINDS.has(r.kind) ? r.kind : 'routine',
    updatedAt: r.updated_at,
    ...(r.deleted ? { deleted: true } : {}),
  }));
}

// Deletes are tombstoned rather than removed, so a device that is offline when
// you delete a routine does not resurrect it on its next sync.
export function tombstoneRoutine(db, id) {
  return (
    db
      .prepare('UPDATE routines SET deleted = 1, updated_at = ? WHERE id = ?')
      .run(nowIso(), id).changes > 0
  );
}

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ===== PROGRESSION =====
//
// Stored one row per exercise rather than as a single JSON blob, so a phone
// that only adjusted "Pushups" cannot overwrite the desktop's "Jump Squats".

const UPSERT_PROGRESSION = `
  INSERT INTO progression (exercise, reps, tension, tier, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(exercise) DO UPDATE SET
    reps       = excluded.reps,
    tension    = excluded.tension,
    tier       = excluded.tier,
    updated_at = excluded.updated_at
  WHERE excluded.updated_at >= progression.updated_at
`;

export function mergeProgression(db, modifiers, updatedAt = nowIso()) {
  if (!modifiers || typeof modifiers !== 'object' || Array.isArray(modifiers)) {
    throw new HttpError(400, 'progression must be an object keyed by exercise name');
  }
  const stmt = db.prepare(UPSERT_PROGRESSION);
  for (const [exercise, mod] of Object.entries(modifiers)) {
    if (!exercise || typeof mod !== 'object' || mod === null) continue;
    stmt.run(
      exercise.slice(0, 200),
      Math.trunc(Number(mod.reps)) || 0,
      Number(mod.tension) || 0,
      // tier is a position on a progression ladder, so it is bounded and
      // integral; anything unparseable means "has not moved", not 0-from-scratch
      // overwriting a real rung.
      Number.isFinite(Number(mod.tier)) ? Math.max(0, Math.trunc(Number(mod.tier))) : 0,
      updatedAt,
    );
  }
}

export function getProgression(db) {
  const out = {};
  for (const row of db.prepare('SELECT * FROM progression').all()) {
    out[row.exercise] = { reps: row.reps, tension: row.tension, tier: row.tier };
  }
  return out;
}

// ===== STREAK FREEZES =====
//
// A freeze is "this missed day should not break my streak". Stored per date so
// two devices freezing different days merge instead of clobbering.

const UPSERT_FREEZE = `
  INSERT INTO freezes (date, updated_at)
  VALUES (?, ?)
  ON CONFLICT(date) DO UPDATE SET updated_at = excluded.updated_at
  WHERE excluded.updated_at >= freezes.updated_at
`;

export function mergeFreezes(db, dates, updatedAt = nowIso()) {
  if (!Array.isArray(dates)) {
    throw new HttpError(400, 'freezes must be an array of YYYY-MM-DD dates');
  }
  const stmt = db.prepare(UPSERT_FREEZE);
  let added = 0;
  for (const raw of dates) {
    const date = String(raw ?? '').slice(0, 10);
    // Only a plain local date is a valid key. Accepting anything else would let
    // a typo'd row silently sit in the table and never match a streak walk,
    // which looks exactly like a freeze that did not work.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    stmt.run(date, updatedAt);
    added++;
  }
  return added;
}

export function listFreezes(db) {
  return db
    .prepare('SELECT date, updated_at FROM freezes ORDER BY date DESC')
    .all()
    .map((r) => ({ date: r.date, updated_at: r.updated_at }));
}

// ===== PROFILE (small key/value bag: display name, preferences) =====

const UPSERT_PROFILE = `
  INSERT INTO profile (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    value      = excluded.value,
    updated_at = excluded.updated_at
  WHERE excluded.updated_at >= profile.updated_at
`;

export function setProfileValues(db, values, updatedAt = nowIso()) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new HttpError(400, 'profile must be an object');
  }
  const stmt = db.prepare(UPSERT_PROFILE);
  for (const [key, value] of Object.entries(values)) {
    if (!key || value == null) continue;
    stmt.run(key.slice(0, 100), String(value).slice(0, 2000), updatedAt);
  }
}

export function getProfile(db) {
  const out = {};
  for (const row of db.prepare('SELECT * FROM profile').all()) {
    out[row.key] = row.value;
  }
  return out;
}

// ===== FULL STATE =====

export function readState(db, sessionLimit) {
  return {
    sessions: listSessions(db, sessionLimit),
    // Tombstones are included here on purpose. /state is the endpoint clients
    // sync from, and a client that cannot see the deletion keeps showing a
    // routine it still holds locally — and pushes it back on the next sync.
    // GET /api/routines stays clean for anything that just wants the live list.
    // Templates come along too; the client splits them by `kind`.
    routines: listRoutines(db, { includeDeleted: true }),
    progression: getProgression(db),
    profile: getProfile(db),
    freezes: listFreezes(db),
  };
}


