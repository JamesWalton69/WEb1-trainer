# Storage and configuration

FitTrainer keeps your workout history in SQLite on your own server, with
`localStorage` in the browser as a write-ahead cache. This document is the
precise version of that: what is stored, where, and what happens when a piece of
it is unavailable.

## No accounts, one password

There is no authentication in the app and no user table. Opening it drops you
straight onto the Dashboard.

Access control lives entirely in nginx: a single HTTP Basic Auth password guards
the app and the API together. Everyone who knows it shares one workout history —
the data is namespaced under a fixed local id (`guest`) and there is no notion
of separate users anywhere in the schema.

Removed long ago, and not coming back: Firebase Authentication, Firestore, the
`/login` route and all session handling.

## Where data lives

### On the server

SQLite at `/var/lib/fittrainer/fittrainer.sqlite` (WAL mode), four tables:

| Table | Contents |
|---|---|
| `sessions` | One row per workout: date, status, active minutes, pauses, last exercise, your feedback, routine name |
| `routines` | Custom routines, with a `deleted` flag rather than a real delete |
| `progression` | Progressive-overload rep and hold offsets, one row per exercise |
| `profile` | Key/value preferences. Currently just `userName` |

Every row carries `updated_at`, and every write is an upsert that only lands if
it is not older than the row already there. That is what makes two devices safe:
they never overwrite each other's workouts, and a same-row conflict settles on
the newer edit. Routine deletes leave tombstones so an offline phone cannot
resurrect something you removed.

Schema and queries: `server/db.mjs`. Routes: `server/index.mjs`.

### In the browser

| Key | Contents |
|---|---|
| `fittrainer_sessions_guest` | Workout history, most recent 500 |
| `fittrainer_routines_guest` | Custom routines |
| `fittrainer_progression_guest` | Per-exercise offsets |
| `fittrainer_outbox` | Writes that have not reached the server yet |
| `userName` | Display name, mirrored to the server's `profile` table |

`src/lib/localStore.js` owns these. It writes locally first and pushes in the
background through `src/lib/api.js`.

## What happens when things break

**Server down, or phone offline.** Everything keeps working. Reads come from
`localStorage`, writes go there and queue in `fittrainer_outbox`, and the queue
is replayed the next time any request succeeds. You lose cross-device sync until
it is back; you do not lose data.

**Browser data cleared.** History comes back from the server on the next load.
This is the failure the old localStorage-only version could not survive.

**Two devices, same day.** Both converge. Sessions are separate rows; a routine
edited on both settles on the later edit.

**Private mode, or Safari's 7-day eviction.** Only the cache is affected. The
server copy is the real one.

The sync rules are not asserted here on faith — `npm test` runs 28 checks
against a real server, including a browser whose storage has been wiped mid-way,
and another 21 over the pure logic behind the dashboard.

## Privacy

Your data sits on your server, in a file you can copy. It is not encrypted at
rest, so anyone with root on that box, or with the Basic Auth password, can read
it. Back it up: `deploy/fittrainer-backup.timer` takes a nightly snapshot and
keeps fourteen.

Loading a page makes no third-party request at all — the fonts are self-hosted
and there is no analytics, no CDN and no AI API. Two features reach outside if
you use them, both opt-in per session: the Spotify mini-player loads an embed
from `open.spotify.com` when you tap the music button, and voice commands use the
browser's `SpeechRecognition`, which in Chrome means the audio is processed on
Google's servers. Neither is on unless you press its button.

## Configuration

No `.env` and no build-time variables. The client always talks to `/api` on its
own origin — Vite proxies it in development, nginx proxies it in production — so
there is nothing to switch between environments.

The server reads a few environment variables, all set in
`deploy/fittrainer-api.service`:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Listen port |
| `HOST` | `127.0.0.1` | Listen address. Non-loopback needs a token or an explicit override |
| `FITTRAINER_DB` | `server/data/fittrainer.sqlite` | Database file |
| `FITTRAINER_TOKEN` | unset | Requires `X-FitTrainer-Token` on every request. For binding beyond loopback |
| `FITTRAINER_ALLOW_INSECURE` | unset | Permits a non-loopback bind with no auth. Only for a genuinely private network |
| `FITTRAINER_BACKUP_DIR` | `<db dir>/backups` | Where snapshots go |
| `FITTRAINER_KEEP` | `14` | Snapshots to retain |

The API refuses to start if you bind it to a public interface without either a
token or `FITTRAINER_ALLOW_INSECURE=1`, because that would publish a writable
database to the internet.

## Deployment

Node 22.13+ on the server, nginx in front, systemd for the API.
[DEPLOY.md](./DEPLOY.md) is the walkthrough.

