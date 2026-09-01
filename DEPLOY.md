# FitTrainer — VPS Deployment Guide

## What you need

- A VPS with Ubuntu/Debian, root or `sudo` access
- A domain (or subdomain) with an **A record** pointing at the VPS IP
- Node.js on your local Windows machine (to run the build)
- No Node needed on the server — only static files are copied up

---

## Step 1 — Build locally

```powershell
cd E:\Coding\Projects\WEb1-trainer-main
npm install
npm run build
```

This produces `dist/` — roughly 2 MB of JS plus a service worker. Verify:

```powershell
dir dist
dir dist\assets
```

---

## Step 2 — Prepare the VPS

SSH into your server and run:

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx rsync
sudo mkdir -p /var/www/fittrainer
sudo chown -R $USER:$USER /var/www/fittrainer
sudo ufw allow 'Nginx Full'
```

---

## Step 3 — Configure nginx

Create the site config:

```bash
sudo tee /etc/nginx/sites-available/fittrainer << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name YOUR_DOMAIN;

    root /var/www/fittrainer;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires off;
    }

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires off;
    }

    location = /manifest.webmanifest {
        add_header Cache-Control "no-cache";
        expires off;
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml application/manifest+json;
    gzip_min_length 1024;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    client_max_body_size 1m;
}
EOF
```

Replace `YOUR_DOMAIN` with your actual domain. Then:

```bash
sudo ln -s /etc/nginx/sites-available/fittrainer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 4 — HTTPS (required for camera + mic)

The camera, microphone, and service worker only work over HTTPS. `localhost` is exempt; a domain over plain HTTP is not.

```bash
sudo certbot --nginx -d YOUR_DOMAIN
```

Certbot rewrites the nginx config to add TLS and installs a renewal timer. Verify:

```bash
sudo certbot renew --dry-run
```

---

## Step 5 — Deploy the files

From your Windows machine, copy the build output:

```powershell
scp -r dist\* user@YOUR_SERVER:/var/www/fittrainer/
```

Or if you have rsync available on Windows (Git Bash / WSL):

```powershell
rsync -avz --delete dist/ user@YOUR_SERVER:/var/www/fittrainer/
```

Then reload nginx on the server to clear any cache:

```bash
ssh user@YOUR_SERVER 'sudo nginx -t && sudo systemctl reload nginx'
```

---

## Step 6 — Verify

```powershell
curl -I https://YOUR_DOMAIN          # expect 200
curl -I https://YOUR_DOMAIN/dashboard # expect 200 (SPA fallback)
```

In a browser:
1. Load `https://YOUR_DOMAIN` — should land on the Dashboard with no login.
2. Start a workout — browser should ask for camera permission (if you enable AI tracking).
3. Open DevTools → Application → Service Workers — confirm one is registered.
4. Complete a workout, reload, confirm the session appears in history.

---

## Updating after edits

Whenever you make changes locally:

```powershell
cd E:\Coding\Projects\WEb1-trainer-main
npm run build
rsync -avz --delete dist/ user@YOUR_SERVER:/var/www/fittrainer/
ssh user@YOUR_SERVER 'sudo nginx -t && sudo systemctl reload nginx'
```

Or use the bundled script (run from Git Bash / WSL):

```bash
./deploy/deploy.sh user@YOUR_SERVER
```

---

## Optional: HTTP Basic Auth (private deployment)

If you want to restrict access:

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd yourname
```

Add inside the `server` block in the nginx config:

```nginx
auth_basic "FitTrainer";
auth_basic_user_file /etc/nginx/.htpasswd;
```

Then `sudo systemctl reload nginx`.
