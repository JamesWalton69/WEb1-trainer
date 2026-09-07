# The static half of the FitTrainer container stack. Build dist/ first:
#   npm run fonts && npm run build
#   docker compose -f deploy/docker-compose.yml up -d --build
#
# This image serves the app and proxies /api to the `api` service, so it is only
# useful as part of that compose stack — on its own, every sync request 502s.
# The primary deployment path is bare metal: systemd for the API and the host's
# nginx for the site. See DEPLOY.md.
#
# No secrets are baked in. The single Basic Auth password lives in
# deploy/.htpasswd, which compose mounts read-only at runtime.
#
# TLS is NOT terminated here. The service worker needs a secure origin, and
# Basic Auth over plain HTTP leaks the password on every request, so put
# Caddy/Traefik/host-nginx in front with a real certificate.

FROM nginx:1.27-alpine

COPY dist/ /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# /healthz rather than /: everything else is behind the password now, and wget
# cannot supply it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
