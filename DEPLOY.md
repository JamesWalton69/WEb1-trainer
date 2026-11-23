# Deploying FitTrainer on your own server

This is the whole thing: a static React app, a small Node API, SQLite, nginx,
one password, and a nightly backup. Everything runs on one box. Nothing calls
out to a cloud service.

## What you end up with

```
   your phone / laptop
          |  HTTPS + one Basic Auth password
          v
   nginx  :443 ──────────────► /var/www/fittrainer   (the built app)
          └── /api/* ────────► 127.0.0.1:3001        (fittrainer-api, systemd)
                                      |
                                      v
                              /var/lib/fittrainer/fittrainer.sqlite
                              /var/lib/fittrainer/backups/  (nightly)
```

The API listens on loopback only, so nginx is the single door in and the
password cannot be bypassed by hitting the port directly. There is no login
screen and no accounts: the nginx password guards both the app and the API.

## Before you start

You need a server running Debian 12 or Ubuntu 22.04/24.04 with `sudo`, a domain
or subdomain with an A record pointing at it, and ports 80 and 443 open. Ten
minutes of attention, roughly.

Two things differ from the old static-only setup. Node now runs **on the
server** (it did not before), and **22.13 or newer** is required — the API uses
Node's built-in `node:sqlite`, which needed an experimental flag before 22.13.
The distro packages are too old on every release listed above, so step 1
installs it from NodeSource.

## 1. Install the packages

```bash
sudo apt update
sudo apt install -y nginx certbot rsync git apache2-utils curl

# Node 22 LTS. Read the script before running it if you like — it just adds
# NodeSource's apt repository and key.
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs

node -v      # must print v22.13.0 or higher
```

If `node -v` prints anything lower, stop here — the API will fail to start with
an error about `node:sqlite` being unavailable.

## 2. Create the service account and directories

The API runs as its own unprivileged user that owns nothing but its database.

```bash
sudo useradd --system --home-dir /srv/fittrainer --shell /usr/sbin/nologin fittrainer

sudo mkdir -p /srv/fittrainer /var/www/fittrainer
sudo chown -R "$USER":fittrainer /srv/fittrainer
sudo chmod 755 /srv/fittrainer
sudo chown -R "$USER":www-data /var/www/fittrainer
```

You own the checkout so `git pull` and `npm` never need `sudo`; the
`fittrainer` user only needs to read `server/*.mjs`. The database directory is
not created here — systemd's `StateDirectory=` makes `/var/lib/fittrainer` with
the right ownership on first start.

## 3. Clone and build on the server

Building on the server rather than on your laptop avoids rsync-on-Windows and
any host/target mismatch, and Node is already here for the API.

```bash
cd /srv/fittrainer
git clone <your-repo-url> .
npm ci
npm run fonts     # downloads the Inter/Outfit .woff2 files (not in git)
npm run build     # writes dist/
```

`npm run fonts` is not optional. The font binaries are gitignored, and without
them the app silently falls back to system fonts.

Copy the build to the web root. nginx serves from `/var/www/fittrainer` so the
served files stay separate from the checkout — a half-finished `git pull` can
never leave the site broken.

```bash
rsync -a --delete /srv/fittrainer/dist/ /var/www/fittrainer/
```

## 4. Start the API

```bash
sudo cp /srv/fittrainer/deploy/fittrainer-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fittrainer-api
systemctl status fittrainer-api --no-pager
```

Check it for yourself:

```bash
curl -s http://127.0.0.1:3001/api/health
# {"ok":true,"sessions":0,...}
```

If that fails, `journalctl -u fittrainer-api -n 40 --no-pager` will say why. The
usual causes are a Node older than 22.13 and a `node` binary somewhere other
than `/usr/bin/node` (`command -v node` tells you; edit `ExecStart` to match).

Nothing is reachable from outside yet — that is the point of the loopback bind.

## 5. Set the password

This is the edge credential protecting the app and the API. Use `-B -C 12` to force
bcrypt hashing with a cost factor of 12 (4,096 rounds), preventing offline cracking
attacks:

```bash
sudo htpasswd -B -C 12 -c /etc/nginx/.htpasswd yourname
sudo chown root:www-data /etc/nginx/.htpasswd
sudo chmod 640 /etc/nginx/.htpasswd
```

Use `sudo htpasswd -B -C 12 /etc/nginx/.htpasswd othername` (no `-c`) to add a second
person later; `-c` overwrites the file.

## 6. Get the certificate first, then install the site config

Order matters here. `deploy/nginx-site.conf` references certificate files, and
nginx refuses to start if they are missing — so install a temporary HTTP-only
config, get the certificate with it, then swap in the real file.

```bash
sudo tee /etc/nginx/sites-available/fittrainer >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name fit.example.com;
    root /var/www/html;
    location /.well-known/acme-challenge/ { root /var/www/html; }
}
EOF

sudo ln -s /etc/nginx/sites-available/fittrainer /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/html -d fit.example.com
```

Now install the real config, with your domain substituted in:

```bash
sudo cp /srv/fittrainer/deploy/nginx-site.conf /etc/nginx/sites-available/fittrainer
sudo sed -i 's/fit\.example\.com/YOUR.DOMAIN.HERE/g' /etc/nginx/sites-available/fittrainer
sudo nginx -t && sudo systemctl reload nginx

sudo ufw allow 'Nginx Full'      # if you use ufw
sudo certbot renew --dry-run     # confirm renewals will work unattended
```

Read `deploy/nginx-site.conf` once — the comments explain why caching is set
where it is, and why no `location` block may declare its own `add_header`.

## 7. Turn on nightly backups

`VACUUM INTO` snapshots, kept 14 deep, taken at 03:30 with a random delay. A
plain `cp` of a live SQLite database in WAL mode can produce a torn file, which
is why this exists rather than a cron `cp`.

```bash
sudo cp /srv/fittrainer/deploy/fittrainer-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fittrainer-backup.timer

sudo systemctl start fittrainer-backup.service    # take one now
journalctl -u fittrainer-backup -n 20 --no-pager
sudo ls -lh /var/lib/fittrainer/backups/
```

Snapshots stay on the same disk, so they protect against a bad write, not a
dead server. Pull one down every so often:

```bash
sudo ls -lh /var/lib/fittrainer/backups/
scp you@your-server:/var/lib/fittrainer/backups/<file> .
```

The `--list` flag does the same thing with sizes and a count, but it reads
`FITTRAINER_BACKUP_DIR` from the environment rather than from the systemd unit,
so pass it in or it will report on the wrong (empty) directory:

```bash
sudo -u fittrainer FITTRAINER_BACKUP_DIR=/var/lib/fittrainer/backups \
  node /srv/fittrainer/server/backup.mjs --list
```

To restore, stop the API, put the snapshot in place, start it again:

```bash
sudo systemctl stop fittrainer-api
sudo -u fittrainer cp /var/lib/fittrainer/backups/<file> /var/lib/fittrainer/fittrainer.sqlite
sudo rm -f /var/lib/fittrainer/fittrainer.sqlite-wal /var/lib/fittrainer/fittrainer.sqlite-shm
sudo systemctl start fittrainer-api
```

Deleting the stale `-wal` and `-shm` files matters: left behind, SQLite would
try to replay a write-ahead log belonging to the database you just replaced.

## 8. Verify

From your machine:

```bash
curl -I https://YOUR.DOMAIN                    # 401 — auth is working
curl -I -u yourname https://YOUR.DOMAIN        # 200
curl -I -u yourname https://YOUR.DOMAIN/build  # 200, SPA fallback on a client route
curl -s -u yourname https://YOUR.DOMAIN/api/health
```

A 401 on the first line is the correct answer, not a problem.

Then in a browser, and this is the part that matters:

1. Open the site, enter the password, land on the Dashboard.
2. Complete a workout (or the shortest routine you have) and rate it.
3. Reload. The session is still in history — that much worked before.
4. Now open the site in a **different browser**, or a private window, or on
   your phone. The same session is there. That is the thing that was broken on
   Vercel, and it is the one test worth doing properly.
5. Optional: DevTools → Application → Storage → Clear site data, reload. The
   history comes back from the server.

### Your existing history is not lost

The app treats the server as a replica, not a replacement. The first time you
open the deployed site in a browser that already has workouts in
`localStorage`, that history is uploaded and merged rather than overwritten. So
load the new site once in your usual browser before clearing anything.

### If the API is down

The app keeps working. Reads come from `localStorage`, writes go there first and
queue in an outbox, and the queue is replayed the next time a request succeeds.
You lose cross-device sync until the API is back; you do not lose data.

## Updating after you change something

On the server:

```bash
cd /srv/fittrainer
git pull
npm ci                    # only if package.json changed
npm run fonts             # no-op once the files are there
npm run build
rsync -a --delete dist/ /var/www/fittrainer/
sudo systemctl restart fittrainer-api      # only if server/ changed
```

Or drive it from your laptop with the bundled script, which builds locally,
refuses to ship a bundle that still references a third-party origin, syncs both
`dist/` and `server/`, restarts the API and then checks that it answered:

```bash
./deploy/deploy.sh you@your-server
```

It needs bash and rsync, so on Windows run it from Git Bash or WSL. It never
touches `/var/lib/fittrainer` or `/etc/nginx/.htpasswd`.

Phones pick up a new build on their own — the service worker updates in the
background and `index.html`, `sw.js` and the manifest are served `no-store`, so
nothing pins an old bundle.

## When something is wrong

**502 Bad Gateway on /api** — the API is not running. `systemctl status
fittrainer-api` then `journalctl -u fittrainer-api -n 50 --no-pager`.

**The password prompt keeps reappearing** — usually a typo in
`/etc/nginx/.htpasswd`; recreate it with `sudo htpasswd -c`. On iOS, an app
installed to the home screen may not inherit Safari's saved credentials, so it
asks once inside the installed app. That is expected; enter it once.

**Stale UI after a deploy** — hard-reload once, or DevTools → Application →
Service Workers → Unregister. If it persists, confirm `curl -I` on
`/index.html` shows `Cache-Control: private, no-store`.

**Sync seems one-directional** — check that `/api/state` returns your rows:
`curl -s -u yourname https://YOUR.DOMAIN/api/state | head -c 400`.

**`node:sqlite` errors on start** — Node is older than 22.13. `node -v`.

## The Docker alternative

If you would rather not install Node on the host, `deploy/docker-compose.yml`
runs the same two pieces as containers — nginx serving `dist/` and proxying
`/api` to a Node container, with the database in a named volume.

```bash
npm run fonts && npm run build
htpasswd -c deploy/.htpasswd yourname
docker compose -f deploy/docker-compose.yml up -d --build
```

It publishes on `127.0.0.1:8080` and terminates no TLS, so you still need
something in front with a certificate. The bare-metal path above is the one
these docs test against; the compose files are provided as a working
alternative, not as the recommended route.

## What runs where, in one paragraph

`server/index.mjs` is the whole backend: `node:http` and `node:sqlite`, no npm
dependencies, fourteen routes under `/api`. `server/db.mjs` holds the
schema and every write as a row-level upsert guarded by `updated_at`, which is
what makes two devices safe to use at once — they never clobber each other, and
an edit to the same row settles on whichever is newer. Deletes leave tombstones
so an offline phone cannot resurrect a routine you removed. On the client,
`src/lib/localStore.js` writes to `localStorage` first and pushes in the
background through `src/lib/api.js`, which is built so that every network
failure is survivable. `npm test` runs all three suites — 49 checks covering the
sync rules, the request handling, and the dashboard arithmetic, including the
case of a browser that has had its storage wiped.







