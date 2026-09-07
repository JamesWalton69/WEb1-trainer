#!/usr/bin/env bash
# Build FitTrainer locally and sync it to your server over rsync/ssh.
#
# Usage:
#   ./deploy/deploy.sh user@your-server
#   ./deploy/deploy.sh user@your-server /var/www/fittrainer /srv/fittrainer
#
# Requires: node >= 22.13 and npm locally, ssh access to the target, rsync on
# both ends, and passwordless sudo (or an interactive tty) for the systemctl
# calls at the end.
#
# What this touches on the server:
#   <web-root>/          replaced from dist/          (--delete)
#   <app-dir>/server/    replaced from server/        (--delete, data/ excluded)
#   <app-dir>/deploy/    replaced from deploy/        (reference copies)
#
# What it never touches: /var/lib/fittrainer (the database and its backups),
# /etc/nginx/.htpasswd (the password), and /etc/systemd/system (unit files are
# copied by hand once — see DEPLOY.md).

set -euo pipefail

TARGET="${1:-}"
WEB_ROOT="${2:-/var/www/fittrainer}"
APP_DIR="${3:-/srv/fittrainer}"

if [[ -z "$TARGET" ]]; then
  echo "usage: $0 user@host [web-root] [app-dir]" >&2
  exit 64
fi

# Resolve the project root from this script's location so it works
# regardless of the directory you invoke it from.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "==> Fetching webfonts"
# The .woff2 files are gitignored, so a fresh clone has none and the build would
# ship CSS pointing at fonts that do not exist. The script is a no-op when they
# are already present.
npm run fonts

echo "==> Building (project root: $PROJECT_ROOT)"
npm run build

if [[ ! -f dist/index.html ]]; then
  echo "error: dist/index.html missing after build; aborting" >&2
  exit 1
fi

# Catch the one build mistake that silently breaks the whole point of this
# deploy: a bundle still pointing at a hosted font or model file. Same-origin
# only is the rule.
if grep -rIl --exclude=\*.map -E 'https?://(fonts\.(googleapis|gstatic)|cdn\.jsdelivr|unpkg|storage\.googleapis|tfhub)' dist/ >/dev/null 2>&1; then
  echo "error: built output still references a third-party origin:" >&2
  grep -rIo --exclude=\*.map -E 'https?://(fonts\.(googleapis|gstatic)|cdn\.jsdelivr|unpkg|storage\.googleapis|tfhub)[^"'"'"' )]*' dist/ | sort -u >&2
  exit 1
fi

echo "==> Syncing dist/ to ${TARGET}:${WEB_ROOT}"
# --delete prunes stale hashed assets from earlier builds.
rsync -avz --delete dist/ "${TARGET}:${WEB_ROOT}/"

echo "==> Syncing server/ to ${TARGET}:${APP_DIR}/server"
# data/ is excluded so --delete can never reach a database that someone ran
# in-place with `npm run server`. In the documented setup the real database
# lives in /var/lib/fittrainer and is nowhere near this path.
rsync -avz --delete --exclude 'data/' server/ "${TARGET}:${APP_DIR}/server/"

# Unit files and nginx configs are installed by hand once (DEPLOY.md), but
# keeping a current copy on the box means the reference is always to hand.
echo "==> Syncing deploy/ to ${TARGET}:${APP_DIR}/deploy"
rsync -avz --delete --exclude '.htpasswd' deploy/ "${TARGET}:${APP_DIR}/deploy/"

echo "==> Restarting the API and reloading nginx"
# nginx -t before the reload so a bad config cannot take the site down. The API
# restart comes first: if the new server code is broken, the health check below
# fails while nginx is still serving the old, working page.
ssh "$TARGET" 'set -e
  sudo systemctl restart fittrainer-api
  sudo nginx -t
  sudo systemctl reload nginx'

echo "==> Checking the API answered"
# Straight to the API port, bypassing nginx, so this proves the service is up
# without needing the Basic Auth password inside a deploy script.
if ! ssh "$TARGET" 'curl -fsS --max-time 5 http://127.0.0.1:3001/api/health'; then
  echo >&2
  echo "error: the API is not answering on 127.0.0.1:3001." >&2
  echo "       ssh in and run: journalctl -u fittrainer-api -n 40 --no-pager" >&2
  exit 1
fi

echo
echo "==> Done. The site is live; your password is unchanged."
