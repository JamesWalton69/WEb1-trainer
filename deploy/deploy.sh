#!/usr/bin/env bash
# Build FitTrainer locally and sync it to a VPS over rsync/ssh.
#
# Usage:
#   ./deploy/deploy.sh user@your-server
#   ./deploy/deploy.sh user@your-server /var/www/fittrainer
#
# Requires: node/npm locally, ssh access to the target, rsync on both ends.
# Reads nothing secret; the build contains no server-side credentials.

set -euo pipefail

TARGET="${1:-}"
REMOTE_DIR="${2:-/var/www/fittrainer}"

if [[ -z "$TARGET" ]]; then
  echo "usage: $0 user@host [remote-dir]" >&2
  exit 64
fi

# Resolve the project root from this script's location so it works
# regardless of the directory you invoke it from.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "==> Building (project root: $PROJECT_ROOT)"
npm run build

if [[ ! -f dist/index.html ]]; then
  echo "error: dist/index.html missing after build; aborting" >&2
  exit 1
fi

echo "==> Syncing dist/ to ${TARGET}:${REMOTE_DIR}"
# --delete prunes stale hashed assets from earlier builds.
rsync -avz --delete dist/ "${TARGET}:${REMOTE_DIR}/"

echo "==> Reloading nginx"
# Validate before reloading so a bad config cannot take the site down.
ssh "$TARGET" 'sudo nginx -t && sudo systemctl reload nginx'

echo "==> Done."
