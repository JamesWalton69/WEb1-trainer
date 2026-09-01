# Minimal static image for FitTrainer. Build dist/ first:
#   npm run build && docker build -t fittrainer .
#
# The app is 100% client-side, so this image contains no secrets and
# needs no environment variables at runtime.
#
# TLS is NOT terminated here. Camera, microphone, and service worker
# require a secure origin, so put Caddy/Traefik/host-nginx in front
# of this container with a real certificate. See DEPLOY.md.

FROM nginx:1.27-alpine

COPY dist/ /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
