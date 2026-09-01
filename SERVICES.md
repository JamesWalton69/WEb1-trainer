# FitTrainer Setup & Storage Guide

FitTrainer is a **fully local, account-free** application. This document describes how it stores data and what little configuration exists.

---

## 🔒 No Accounts, No Backend

There is no authentication, no user database, and no server-side component. Removed in favour of local-only operation:

- Firebase Authentication (email/password + Google OAuth)
- Firebase Firestore
- The `/login` route and all session handling

Opening the app takes you straight to the Dashboard. Nothing is gated.

---

## 💾 Where Data Lives

All persistence is browser `localStorage`, namespaced under a single fixed local id (`guest`).

| Key | Contents |
|---|---|
| `fittrainer_sessions_guest` | Workout log history (capped at 100 entries) |
| `fittrainer_routines_guest` | User-built custom routines |
| `fittrainer_progression_guest` | Progressive-overload rep/hold offsets per exercise |
| `userName` | Display name shown on the Dashboard (editable via the **Name** button) |

The implementing module is `src/lib/localStore.js`.

Implications worth understanding:

- Data is **per-browser and per-device**. Using Chrome and Firefox gives you two separate histories, and your phone will not see your desktop's data.
- **Clearing site data deletes everything permanently.** There is no server copy to restore from.
- Data is **not encrypted**. Anyone with access to the browser profile can read it via DevTools.
- `localStorage` is typically capped around 5–10 MB per origin. The 100-session cap keeps usage far below that.

To export your history manually, open DevTools console and run:

```js
copy(localStorage.getItem('fittrainer_sessions_guest'))
```

---

## ☁️ External Services

None. The app makes no outbound network calls. Everything runs locally in your browser.

---

## ⚙️ Environment Configuration (`.env`)

No environment variables are required or supported.

---

## 🚢 Deployment

The production build is a directory of static files with no runtime dependencies — no Node process, no database, no secrets on the server.

```bash
npm run build   # outputs to dist/
```

See **[DEPLOY.md](./DEPLOY.md)** for the full VPS + nginx + HTTPS guide.

