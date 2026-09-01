# FitTrainer 🚀 — Web AI Workout Companion

**FitTrainer** is an offline-first Progressive Web Application (PWA) that acts as your personal fitness coach directly in the browser.

It runs **entirely on your device**. There is no account, no login, and no backend database. Your workout history never leaves your browser.

Through client-side computer vision (TensorFlow.js) and Web Speech APIs, FitTrainer tracks your reps, speaks advice, and lets you build custom routines.

---

## 🔒 No Accounts, No Cloud

- **No sign-in.** Opening the app drops you straight onto the Dashboard.
- **No user database.** Sessions, routines, and progression live in your browser's `localStorage`.
- **No telemetry.** The only outbound request the app can make is to the Gemini API, and only if *you* choose to use the AI Coach with your own key.
- **Clearing your browser data erases your history.** Nothing is recoverable from a server, because there is no server.

---

## 🔥 Features

1. **AI Posture Tracking & Auto Rep Counting** 📷
   Using `@tensorflow-models/pose-detection` (MoveNet), the app tracks your key movement angles (e.g., knee hinge during squats, elbow depth during pushups). It only counts a repetition when it recognizes that you hit the correct biological angle!
2. **Talkback Form Correction** 🗣️
   Built with the browser's `SpeechSynthesis` framework. If you don't drop low enough during a squat, or if you break form, the AI will audibly coach you (e.g., *"Squat deeper!"* or *"Lower your chest!"*).
3. **Voice Commands** 🎙️
   Using the `SpeechRecognition` API, you never have to touch your mouse while sweating. Simply shout **"Pause"**, **"Play"**, or **"Stop"** across the room.
5. **Spotify Music Embeds** 🎶
   Launch your favorite workout playlist via an integrated Spotify floating mini-player accessible directly within the core Workout Engine.
6. **Robust PWA Capabilities** 📱
   Includes the comprehensive `vite-plugin-pwa`. Built with offline caching logic exceeding 5MB capabilities so all UI/UX components run fluidly regardless of internet connection.

---

## 💻 Tech Stack

- **Framework**: React 19 + Vite 8 + ESModules
- **Storage**: Browser `localStorage` (no backend)
- **Computer Vision Model**: TensorFlow.js (MoveNet Architecture)
- **Charts / UI Vectors**: Recharts, Lucide-React
- **PWA Service Worker**: VitePWA Wrapper

---

## 🛠️ Running Locally

```bash
cd E:\Coding\Projects\WEb1-trainer-main
npm install
npm run dev
```

Then open `http://localhost:5173/`.

### Production build

```bash
npm run build
npm run preview
```

The production build lands in `dist/` as plain static files — HTML, JS, CSS, and a service worker. Any static web server can host it.

---

## 🚢 Deploying to your own VPS

See **[DEPLOY.md](./DEPLOY.md)** for the full self-hosting guide (nginx, HTTPS via Let's Encrypt, and a one-command deploy script).

The short version: `npm run build`, copy `dist/` to the server, serve it with nginx using an SPA fallback.

---


