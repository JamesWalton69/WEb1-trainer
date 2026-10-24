# FitTrainer

A self-hosted workout coach that runs as an installable web app. It takes you
through a routine set by set, times your holds and rests, speaks the cues out
loud, and keeps your history in a SQLite database on your own server.

No accounts, no login screen, no third-party backend. One shared password at the
nginx layer is the whole access-control story.

## How your data is stored

Every workout is written to `localStorage` first and then pushed to a small Node
API on your server, which stores it in SQLite. That ordering is deliberate: the
app stays fully usable with the server down or the phone offline, and anything
that failed to send is queued and replayed later.

Because the server holds the real copy, clearing your browser data no longer
loses anything, and your phone and your laptop see the same history. Writes are
row-level upserts guarded by a timestamp, so two devices used the same day
cannot overwrite each other, and deleting a routine leaves a tombstone so an
offline device cannot resurrect it.

See [SERVICES.md](./SERVICES.md) for exactly what is stored where.

## Features

1. **Guided sessions.** The workout engine walks each set with prep, tension,
   reset and rest timers, a progress ring, and spoken cues through the browser's
   `SpeechSynthesis` API.
2. **Progressive overload.** Per-exercise rep and hold offsets that carry — now driven by exercise ladders
   forward, applied to the routine each time you run it — with the app's
   Easy/Just Right/Hard feedback moving you up harder variations (push-ups →
   decline → archer, pull-ups → slow negatives → weighted, and so on).
3. **Custom routines.** Build your own, or run the built-in weekly calisthenics
   plan from `src/lib/workout-routine.json`.
4. **History and charts.** Streak calendar, badges, and volume charts built from
   your logged sessions.
5. **Voice commands.** Say "pause", "play" or "stop" instead of touching a
   sweaty phone, via the `SpeechRecognition` API. Optional, off until you press
   the mic button — and worth knowing that Chrome implements this by sending the
   audio to Google's servers, so leave it off if that bothers you.
6. **Spotify mini-player.** An embedded playlist behind the music button. This
   is the one thing in the app that loads anything from a third party, and only
   after you tap it.
7. **Installable PWA.** Service worker, offline shell, home-screen install.
   Sync requests are deliberately never cached.

## Running it locally

```bash
npm install
npm run fonts     # downloads the self-hosted Inter/Outfit files, once
npm run dev       # http://localhost:5173
```

In a second terminal, start the API so sync works:

```bash
npm run server    # http://127.0.0.1:3001
```

Vite proxies `/api` to it, so the client talks to the same origin in development
and in production. There is no base URL to configure and no CORS anywhere.

Without the API running the app still works — it just keeps everything in
`localStorage` and queues the pushes.

```bash
npm test          # 49 checks: the API, the client's sync rules, the pure logic
npm run lint
npm run build     # static files into dist/
```

Node 22.13 or newer is required. The server uses Node's built-in `node:sqlite`,
which needed an experimental flag before that version.

## Tech

React 19 and Vite 8 on the client, with Recharts and Lucide. On the server,
`node:http` plus `node:sqlite` and **zero npm dependencies** — no Express, no
native modules, nothing to compile on the VPS. Fonts are self-hosted, so a page
load makes no outbound request at all.

## Deploying

[DEPLOY.md](./DEPLOY.md) is the full walkthrough for your own server: Node,
nginx as reverse proxy, the systemd unit, HTTPS via Let's Encrypt, the shared
password, and nightly SQLite backups. `deploy/docker-compose.yml` is there if
you prefer containers.
