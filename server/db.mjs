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
const SCHEMA_VERSION = 1;

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
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions (date DESC);

  CREATE TABLE IF NOT EXISTS routines (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    exercises  TEXT NOT NULL,
    settings   TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS progression (
    exercise   TEXT PRIMARY KEY,
    reps       INTEGER NOT NULL DEFAULT 0,
    tension    REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * Ordered migrations from version N-1 to N. Index 0 takes a fresh database to
 * version 1; each later entry is applied in turn to whatever is already there.
 *
 * Rules for adding one: it must be idempotent-safe to *skip* (never re-run), it
 * runs inside a transaction with the version bump, and it must not assume any
 * data is present. Use `ALTER TABLE ... ADD COLUMN`, which SQLite supports, and
 * give the column a default so existing rows stay valid.
 */
const MIGRATIONS = [
  (db) => db.exec(SCHEMA),
];

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
const UPSERT_SESSION = `
  INSERT INTO sessions
    (id, date, timestamp, status, active_minutes, pauses, last_exercise, feedback, routine_name, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    date           = excluded.date,
    timestamp      = excluded.timestamp,
    status         = excluded.status,
    active_minutes = excluded.active_minutes,
    pauses         = excluded.pauses,
    last_exercise  = excluded.last_exercise,
    feedback       = COALESCE(excluded.feedback, sessions.feedback),
    routine_name   = excluded.routine_name,
    updated_at     = excluded.updated_at
  WHERE excluded.updated_at >= sessions.updated_at
`;

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
    String(s.updated_at ?? nowIso()),
  );
}

export function listSessions(db, limit = 500) {
  return db
    .prepare('SELECT * FROM sessions ORDER BY timestamp DESC LIMIT ?')
    .all(Math.min(Math.max(Math.trunc(limit) || 500, 1), 5000))
    .map((r) => ({ ...r }));
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

const UPSERT_ROUTINE = `
  INSERT INTO routines (id, name, exercises, settings, updated_at, deleted)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name       = excluded.name,
    exercises  = excluded.exercises,
    settings   = excluded.settings,
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
    String(r.updatedAt ?? r.updated_at ?? nowIso()),
    r.deleted ? 1 : 0,
  );
}

export function listRoutines(db, { includeDeleted = false } = {}) {
  const sql = includeDeleted
    ? 'SELECT * FROM routines ORDER BY updated_at DESC'
    : 'SELECT * FROM routines WHERE deleted = 0 ORDER BY updated_at DESC';
  return db.prepare(sql).all().map((r) => ({
    id: r.id,
    name: r.name,
    exercises: safeParse(r.exercises, []),
    settings: safeParse(r.settings, {}),
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
  INSERT INTO progression (exercise, reps, tension, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(exercise) DO UPDATE SET
    reps       = excluded.reps,
    tension    = excluded.tension,
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
      updatedAt,
    );
  }
}

export function getProgression(db) {
  const out = {};
  for (const row of db.prepare('SELECT * FROM progression').all()) {
    out[row.exercise] = { reps: row.reps, tension: row.tension };
  }
  return out;
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
    routines: listRoutines(db, { includeDeleted: true }),
    progression: getProgression(db),
    profile: getProfile(db),
  };
}


