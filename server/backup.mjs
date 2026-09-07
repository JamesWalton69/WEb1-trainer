#!/usr/bin/env node
// backup.mjs — point-in-time snapshot of the workout database.
//
//   node server/backup.mjs            # write a snapshot, prune old ones
//   node server/backup.mjs --list     # show what snapshots exist
//
// Uses SQLite's `VACUUM INTO`, which takes a consistent snapshot while the
// server is still running and writing. Do NOT back up by copying the .sqlite
// file: in WAL mode the newest commits live in the -wal sidecar, so a plain
// copy can be silently short of data or torn mid-transaction.
//
// Env: FITTRAINER_DB, FITTRAINER_BACKUP_DIR, FITTRAINER_KEEP (default 14)

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.FITTRAINER_DB || join(ROOT, 'server', 'data', 'fittrainer.sqlite');
// Snapshots default to living beside the database they came from, so pointing
// FITTRAINER_DB somewhere else does not silently leave the backups behind in
// the checkout. systemd sets both explicitly anyway.
const BACKUP_DIR = process.env.FITTRAINER_BACKUP_DIR || join(dirname(DB_FILE), 'backups');
const KEEP = Math.max(Number(process.env.FITTRAINER_KEEP) || 14, 1);

const PREFIX = 'fittrainer-';
const SUFFIX = '.sqlite';

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function listBackups() {
  try {
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
      .sort() // timestamped names sort chronologically
      .map((f) => ({ name: f, path: join(BACKUP_DIR, f), size: statSync(join(BACKUP_DIR, f)).size }));
  } catch {
    return [];
  }
}

if (process.argv.includes('--list')) {
  const found = listBackups();
  if (!found.length) {
    console.log(`No backups in ${BACKUP_DIR}`);
  } else {
    for (const b of found) console.log(`  ${b.name}  ${kb(b.size)}`);
    console.log(`\n${found.length} backup(s) in ${BACKUP_DIR}`);
  }
  process.exit(0);
}

// Colons are legal on Linux but make the filename painful to scp to a Mac or
// Windows box, so the timestamp is flattened.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
const target = join(BACKUP_DIR, `${PREFIX}${stamp}${SUFFIX}`);

mkdirSync(BACKUP_DIR, { recursive: true });

let db;
try {
  // Read-only: a backup must never be able to modify the live database.
  db = new DatabaseSync(DB_FILE, { readOnly: true });
} catch (err) {
  console.error(`Cannot open ${DB_FILE}: ${err.message}`);
  console.error('Has the server run yet? The database is created on first start.');
  process.exit(1);
}

try {
  // The path is interpolated rather than bound because VACUUM INTO does not
  // accept a parameter. It comes from env/argv on the server, never from a
  // request, and the quote-doubling below keeps a stray apostrophe harmless.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} catch (err) {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
} finally {
  db.close();
}

const { n } = (() => {
  const snap = new DatabaseSync(target, { readOnly: true });
  const row = snap.prepare('SELECT COUNT(*) AS n FROM sessions').get();
  snap.close();
  return row;
})();

console.log(`Wrote ${target}`);
console.log(`  ${kb(statSync(target).size)}, ${n} session(s) — verified readable.`);

// Prune oldest first, keeping the newest KEEP snapshots.
const all = listBackups();
for (const old of all.slice(0, Math.max(all.length - KEEP, 0))) {
  unlinkSync(old.path);
  console.log(`  pruned ${old.name}`);
}
