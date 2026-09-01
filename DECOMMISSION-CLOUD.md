# Decommissioning Vercel & Firebase (without deleting anything)

FitTrainer no longer uses Firebase or Vercel. This is the checklist for **standing those services down while keeping the projects and data intact**, so you can revive them later if you change your mind.

Nothing here is destructive. Every step is reversible, and none of it deletes a project, a database, or a user record.

> I could not perform these steps for you — they require your logged-in Vercel and Firebase accounts, and both affect live hosted resources. Each item below is something you do in the dashboard or with your own authenticated CLI session.

---

## Local state: already clean

Checked in this project directory:

| Artifact | Status |
|---|---|
| `.vercel/` (project link) | not present |
| `.firebase/`, `firebase.json`, `.firebaserc` | not present |
| `.env`, `.env.local` | not present |
| `firebase` npm dependency | **removed** from `package.json` and `node_modules` |
| `src/lib/firebase.js` | **deleted** |
| `src/pages/Login.jsx` | **deleted** |
| `src/lib/firestoreService.js` | **renamed** to `src/lib/localStore.js` (localStorage only) |
| Firebase endpoints in `dist/` bundle | **absent** (verified by grep) |

So there is nothing local to disconnect. The work is all account-side.

---

## Part 1 — Vercel

### 1. Stop new deployments (choose one)

**Option A — disconnect the Git integration.** Keeps the project, domains, and all past deployments; simply stops auto-deploying on push.

> Vercel Dashboard → your project → **Settings** → **Git** → **Disconnect**

**Option B — pause the project.** Keeps everything and returns a paused placeholder to visitors.

> Project → **Settings** → **General** → scroll to **Pause Project**

Option A is usually what you want. Option B if you also want the URL to stop serving the app.

### 2. Remove the environment variables

These are the Firebase and Gemini keys you pasted in earlier. They are no longer read by the code, but leaving live credentials sitting in a deployment config is needless exposure.

> Project → **Settings** → **Environment Variables** → remove `VITE_FIREBASE_*` and `VITE_GEMINI_API_KEY`

Copy the values into your password manager first if you want them retrievable.

### 3. Release the domain (only if reusing it on the VPS)

If you plan to point the same domain at your VPS, remove it from Vercel first, or the DNS change will conflict.

> Project → **Settings** → **Domains** → remove the domain

Then set the **A record** at your DNS provider to your VPS IP. Allow up to a few hours for propagation; check with `dig +short fit.example.com`.

Skip this entirely if the VPS gets a different hostname.

### 4. Leave alone

Do **not** delete the project. Past deployments stay browsable and redeployable, which is your rollback path if the VPS gives you trouble.


---

## Part 2 — Firebase

The goal is to make the project inert without destroying the Firestore data.

### 1. Back up Firestore first

Do this **before** touching rules or providers. If you ever had real users, this is the only copy of their history.

```bash
# Requires the gcloud CLI, authenticated to the right project.
gcloud firestore export gs://YOUR_BUCKET/fittrainer-backup-$(date +%Y%m%d) \
  --project=YOUR_PROJECT_ID
```

Or via console: **Firestore Database** → **Import/Export** → **Export**. Needs a Cloud Storage bucket in the same location.

If the database only ever held your own test data, you can skip this — but it costs nothing to keep.

### 2. Lock Firestore to deny-all

This blocks all client reads and writes while leaving every document in place.

> **Firestore Database** → **Rules** → replace with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Publish. Data is untouched; it is simply unreachable from the web SDK. Reverting is a one-line edit.

### 3. Disable the sign-in providers

> **Authentication** → **Sign-in method** → open **Email/Password** → toggle **Disable** → Save
>
> Repeat for **Google**

Existing user accounts remain listed under **Authentication → Users**. Nobody can authenticate, but no record is erased.

### 4. Restrict or rotate the API keys

The Firebase web API key was shipped in your public bundle, so treat it as exposed. Two choices:

- **Restrict it** (safer, reversible): Google Cloud Console → **APIs & Services** → **Credentials** → select the browser key → under **Application restrictions** set **HTTP referrers** and remove your old Vercel domain, or under **API restrictions** limit it to nothing in use.
- **Delete just that key**: also fine, and does not affect the project or data.

Do the same for the **Gemini** key if you ever committed it or set it as a build variable — that one bills against your quota, so it matters more. Regenerate it in [AI Studio](https://aistudio.google.com/app/apikey) and keep the new one out of any `VITE_` variable.

### 5. Confirm you are not accruing cost

> **Usage and billing** → confirm the project is on the **Spark (free)** plan, or that Blaze usage has gone flat

With deny-all rules and no traffic, Firestore reads drop to zero.

### 6. Leave alone

Do **not** use **Project settings → Delete project**. That is the one irreversible action in this whole document, and it takes the Firestore data with it.


---

## Reversing all of this

If you want the cloud version back:

1. Restore Firestore rules to the user-owned-write version.
2. Re-enable the Email/Password and Google providers.
3. Reconnect Git in Vercel and restore the environment variables.
4. In code: reinstate `src/lib/firebase.js` and `src/pages/Login.jsx`, re-add the `firebase` dependency, and revert `src/lib/localStore.js` to the dual-write `firestoreService.js`.

Steps 1–3 are dashboard clicks. Step 4 is a code change, so commit the current state to Git before going further — that gives you a restore point.

---

## Verifying the standdown

```bash
# Old Vercel URL should stop serving the app (404, paused page, or NXDOMAIN)
curl -I https://your-old-app.vercel.app

# DNS points at the VPS, not Vercel
dig +short fit.example.com
```

In the Firebase console, **Firestore → Usage** should flatten to zero reads within a day.
