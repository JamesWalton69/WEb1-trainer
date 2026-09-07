// localStore.js — all workout persistence.
//
// localStorage is the write path; the server is a replica.
//
// Every save lands in localStorage synchronously and then pushes to /api in the
// background. That ordering is deliberate: the app must work with the server
// down, on a plane, or before nginx is even configured. A failed push is queued
// in api.js's outbox and replayed later, and because the server upserts by id
// a replay cannot duplicate anything.
//
// Reads merge the two sources. On load we pull server state and reconcile it
// with what is on the device, newest `updated_at` per row winning — the same
// rule the server itself applies. That is what makes the phone and the desktop
// converge, and what makes a browser that has cleared its storage recover
// its whole history from the server instead of starting over.
//
// The `userId` argument is a storage-key namespace, not an account. There are
// no accounts; nginx's shared password is the only gate.

// Extension included so this module also loads under plain Node, which is how
// scripts/test-sync.mjs exercises the merge rules against the real server.
import {
  pullState,
  pushChanges,
  deleteRoutineRemote,
  flushOutbox,
  isServerReachable,
  isUnauthorized,
  pendingCount,
} from './api.js';
import { normalizeExerciseKey, normalizeProgressionMap } from './exerciseKey.js';

export const LOCAL_USER_ID = 'guest';

// How many sessions to keep on the device. The server keeps its own 500; this
// is only about what a browser has to hold.
const LOCAL_SESSION_CAP = 500;

// Set when a write to localStorage failed for good. Surfaced by getSyncStatus so
// the UI can warn rather than pretend the save worked.
let storageFailed = false;

function keyFor(prefix, userId) {
  return `fittrainer_${prefix}_${userId || LOCAL_USER_ID}`;
}

function readLocal(prefix, userId, fallback) {
  try {
    const raw = localStorage.getItem(keyFor(prefix, userId));
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error(`Error reading ${prefix} from localStorage:`, e);
    return fallback;
  }
}

/**
 * Write one key, returning whether it stuck.
 *
 * On a quota error, retry with progressively fewer rows before giving up: the
 * oldest workouts are the least valuable thing in storage, and losing the tail
 * of a long history beats failing to record today's session. Callers that hold
 * data the user just produced should check the return value — a silent false is
 * how a workout disappears while the UI says it was saved.
 */
function writeLocal(prefix, userId, value) {
  const key = keyFor(prefix, userId);
  const attempts = [value];

  // Only arrays can be meaningfully shortened, and only sessions are ordered
  // newest-first, so trimming the tail drops the oldest.
  if (Array.isArray(value) && value.length > 20) {
    attempts.push(value.slice(0, Math.floor(value.length / 2)));
    attempts.push(value.slice(0, 20));
  }

  for (let i = 0; i < attempts.length; i++) {
    try {
      localStorage.setItem(key, JSON.stringify(attempts[i]));
      if (i > 0) {
        console.warn(
          `[store] ${prefix} did not fit in localStorage; kept the newest ${attempts[i].length} of ${value.length}.`,
        );
      }
      return true;
    } catch (e) {
      // Safari private mode throws on every setItem, so retrying smaller is
      // pointless there — but it is cheap, and the quota case is the common one.
      if (i === attempts.length - 1) {
        storageFailed = true;
        console.error(`Error writing ${prefix} to localStorage:`, e);
      }
    }
  }
  return false;
}

// Fire-and-forget: never let a slow or dead server block the UI. Callers do not
// await this.
function backgroundPush(payload) {
  pushChanges(payload).catch(() => { /* queued by api.js */ });
}

const nowIso = () => new Date().toISOString();

// Every date in storage is a local `YYYY-MM-DD` string from en-CA. Comparing
// those strings directly is both cheaper and more correct than parsing them:
// `new Date('2026-09-05')` is UTC midnight, so east of Greenwich it can land on
// the previous local day and shift a window by one.
const localDateStr = (d = new Date()) => d.toLocaleDateString('en-CA');

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

// Sessions written before ids existed are keyed by their timestamp, so a
// migration cannot fork one workout into two rows.
const sessionId = (s) => s.id || `legacy-${s.timestamp || s.date || Math.random().toString(36).slice(2)}`;

// ===== WORKOUT SESSION LOGGING =====

// Upserts by id. The old version deduped on date + last_exercise +
// active_minutes, which meant the second call from PostWorkout — the one
// carrying the user's "too easy / too hard" answer — looked like a duplicate
// and was silently dropped, so feedback never reached the log. WorkoutEngine
// now stamps each run with an id and that id is what identifies the row.
export async function logWorkoutSession(userId, summary) {
  const id = summary.id || `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session = {
    ...summary,
    id,
    timestamp: summary.timestamp || nowIso(),
    date: summary.date || localDateStr(),
    updated_at: nowIso(),
  };
  // `routine` is the exercise list, needed to compute progression but not worth
  // storing on every session row.
  delete session.routine;
  delete session.type;

  const sessions = readLocal('sessions', userId, []);
  const at = sessions.findIndex((s) => sessionId(s) === id);
  if (at >= 0) {
    // Keep a feedback value that a later write does not carry.
    sessions[at] = { ...sessions[at], ...session, feedback: session.feedback ?? sessions[at].feedback };
  } else {
    sessions.unshift(session);
  }
  const row = at >= 0 ? sessions[at] : session;
  const stored = writeLocal('sessions', userId, sessions.slice(0, LOCAL_SESSION_CAP));

  if (stored) {
    backgroundPush({ sessions: [row] });
  } else {
    // localStorage refused the write, so this workout exists nowhere yet. The
    // server is now the only place it can live — wait for that push instead of
    // firing and forgetting, so a caller that navigates away does not take the
    // request with it.
    await pushChanges({ sessions: [row] }).catch(() => {});
  }
  return id;
}

// ===== GET WORKOUT HISTORY =====

export async function getWorkoutHistory(userId) {
  const local = readLocal('sessions', userId, []);

  // Anything queued while offline goes out before we pull, so the response
  // already contains our own writes.
  await flushOutbox().catch(() => {});
  const remote = await pullState().catch(() => null);

  let merged = local;
  if (remote?.sessions) {
    merged = mergeById(local, remote.sessions);
    writeLocal('sessions', userId, merged.slice(0, LOCAL_SESSION_CAP));
    // A device that had rows the server lacked gets them uploaded here.
    const missing = merged.filter((s) => !remote.sessions.some((r) => r.id === sessionId(s)));
    if (missing.length) backgroundPush({ sessions: missing });
  }

  // Newest first, tolerating both ISO strings and legacy {seconds} shapes.
  return merged.sort((a, b) => {
    const timeA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp).getTime();
    const timeB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });
}

// Last write wins per row, by `updated_at`. Rows the other side has never seen
// are kept, never dropped — a merge must not be able to delete history.
function mergeById(local, remote) {
  const byId = new Map();
  for (const s of [...remote, ...local]) {
    const id = sessionId(s);
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { ...s, id });
      continue;
    }
    const a = existing.updated_at || existing.timestamp || '';
    const b = s.updated_at || s.timestamp || '';
    if (b > a) byId.set(id, { ...existing, ...s, id, feedback: s.feedback ?? existing.feedback });
  }
  return [...byId.values()];
}

// ===== COMPUTE USER STATS =====

/**
 * The numbers behind the dashboard.
 *
 * Two different questions are being asked, and conflating them is what made the
 * old tiles contradict each other ("Sessions: 4" beside "Total Active: 190m",
 * where the minutes included workouts the session count excluded):
 *
 *   achievement — did you finish? Drives `totalSessions`, `streak`, `level`.
 *     Only `status === 'Completed'` counts.
 *   effort — how long were you actually training? Drives the minute totals and
 *     the chart. Every logged session counts, finished or not; time spent on an
 *     abandoned workout is still time spent.
 *
 * Both are reported, so the UI can show "4 sessions · 1 partial" rather than
 * quietly picking one rule for one tile and another for the next.
 */
export function computeStats(sessions) {
  const completed = sessions.filter((s) => s.status === 'Completed');

  const sumMinutes = (rows) =>
    Math.round(rows.reduce((sum, s) => sum + (s.active_minutes || 0), 0) * 100) / 100;

  const completedDates = [...new Set(completed.map((s) => s.date).filter(Boolean))].sort().reverse();

  // Walk back from today. One day of grace: not having trained yet today does
  // not break a streak that was alive yesterday.
  let streak = 0;
  const today = localDateStr();
  const startedToday = completedDates.includes(today);
  for (let i = startedToday ? 0 : 1; ; i++) {
    if (!completedDates.includes(daysAgoStr(i))) break;
    streak++;
  }

  const weekStart = daysAgoStr(6); // today plus the six days before it
  const thisWeek = sessions.filter((s) => s.date && s.date >= weekStart);

  return {
    // achievement
    totalSessions: completed.length,
    streak,
    level: Math.max(1, Math.floor(completed.length / 5) + 1),
    completedDates,
    // effort
    totalMinutes: sumMinutes(sessions),
    weeklyMinutes: sumMinutes(thisWeek),
    weeklySessions: thisWeek.length,
    totalPauses: sessions.reduce((sum, s) => sum + (s.pauses || 0), 0),
    // the gap between the two, so the UI never has to imply it
    loggedSessions: sessions.length,
    incompleteSessions: sessions.length - completed.length,
  };
}

// ===== BADGES =====

export function computeBadges(stats, sessions) {
  const badges = [
    {
      id: 'first_workout',
      name: 'First Step',
      emoji: '🏅',
      description: 'Complete your first workout',
      unlocked: stats.totalSessions >= 1,
    },
    {
      id: 'streak_3',
      name: 'On Fire',
      emoji: '🔥',
      description: '3-day workout streak',
      unlocked: stats.streak >= 3,
    },
    {
      id: 'streak_7',
      name: 'Unstoppable',
      emoji: '⚡',
      description: '7-day workout streak',
      unlocked: stats.streak >= 7,
    },
    {
      id: 'streak_30',
      name: 'Iron Will',
      emoji: '🏆',
      description: '30-day workout streak',
      unlocked: stats.streak >= 30,
    },
    {
      id: 'sessions_10',
      name: 'Dedicated',
      emoji: '💪',
      description: 'Complete 10 workouts',
      unlocked: stats.totalSessions >= 10,
    },
    {
      id: 'sessions_50',
      name: 'Veteran',
      emoji: '🎖️',
      description: 'Complete 50 workouts',
      unlocked: stats.totalSessions >= 50,
    },
    {
      id: 'minutes_60',
      name: 'Hour Power',
      emoji: '⏱️',
      description: 'Accumulate 60 active minutes',
      unlocked: stats.totalMinutes >= 60,
    },
    {
      id: 'minutes_500',
      name: 'Marathon Mind',
      emoji: '🏃',
      description: 'Accumulate 500 active minutes',
      unlocked: stats.totalMinutes >= 500,
    },
    {
      id: 'no_pause',
      name: 'Zero Excuses',
      emoji: '🚫',
      description: 'Complete a workout with 0 pauses',
      unlocked: sessions.some(s => s.status === 'Completed' && s.pauses === 0),
    },
    {
      id: 'level_5',
      name: 'Level Up',
      emoji: '🌟',
      description: 'Reach Level 5',
      unlocked: stats.level >= 5,
    },
  ];
  return badges;
}

// ===== CHART DATA =====

export function buildChartData(sessions) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const last7 = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = localDateStr(d);
    const dayMinutes = sessions
      .filter((s) => s.date === dateStr)
      .reduce((sum, s) => sum + (s.active_minutes || 0), 0);
    last7.push({ day: days[d.getDay()], date: dateStr, minutes: Math.round(dayMinutes * 10) / 10 });
  }

  return last7;
}

// ===== STREAK CALENDAR (last 28 days) =====

export function buildStreakCalendar(completedDates) {
  const done = new Set(completedDates);
  const cells = [];
  for (let i = 27; i >= 0; i--) {
    const dateStr = daysAgoStr(i);
    cells.push({ date: dateStr, completed: done.has(dateStr) });
  }
  return cells;
}

// ===== CUSTOM ROUTINES =====

export async function saveCustomWorkout(userId, routineId, routineName, workout, settings) {
  const id = routineId || routineName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now().toString().slice(-4);
  const newRoutine = {
    id,
    name: routineName || 'My Routine',
    exercises: workout,
    settings: settings || { sets: 3, restBetweenSet: 60, restBetweenEx: 35, prepTime: 10 },
    updatedAt: new Date().toISOString()
  };

  const localRoutines = readLocal('routines', userId, []);
  const index = localRoutines.findIndex(r => r.id === id);
  if (index >= 0) localRoutines[index] = newRoutine;
  else localRoutines.unshift(newRoutine);
  const stored = writeLocal('routines', userId, localRoutines);

  // As with sessions: if it did not fit locally, the push is the only copy, so
  // it has to be awaited rather than fired into the background.
  if (stored) backgroundPush({ routines: [newRoutine] });
  else await pushChanges({ routines: [newRoutine] }).catch(() => {});
  return id;
}

export async function getCustomWorkouts(userId) {
  const local = readLocal('routines', userId, []);
  const remote = await pullState().catch(() => null);
  if (!remote?.routines) return local.filter((r) => !r.deleted);

  // /state includes tombstones, so a routine deleted on another device wins
  // here on its newer updatedAt and then gets dropped from local storage.
  const byId = new Map();
  for (const r of [...remote.routines, ...local]) {
    const existing = byId.get(r.id);
    if (!existing || (r.updatedAt || '') > (existing.updatedAt || '')) byId.set(r.id, r);
  }
  const visible = [...byId.values()].filter((r) => !r.deleted);
  writeLocal('routines', userId, visible);

  // Only routines the server has never heard of get uploaded. Comparing against
  // every remote id, tombstones included, is what stops a stale local copy from
  // resurrecting something that was deleted.
  const remoteIds = new Set(remote.routines.map((r) => r.id));
  const missing = visible.filter((r) => !remoteIds.has(r.id));
  if (missing.length) backgroundPush({ routines: missing });
  return visible;
}

export async function deleteCustomWorkout(userId, routineId) {
  const localRoutines = readLocal('routines', userId, []);
  writeLocal('routines', userId, localRoutines.filter(r => r.id !== routineId));
  // Tombstoned server-side, not deleted, so another device that is offline right
  // now does not push it back on its next sync.
  await deleteRoutineRemote(routineId).catch(() => {});
}

// ===== ADAPTIVE PROGRESSION STORAGE =====
//
// Keys are canonical (see exerciseKey.js), so "Push-ups" from the plan and
// "Pushups" from the builder share one row. Normalizing on read migrates data
// written before that was true, at no cost.

export async function getUserProgression(userId) {
  const localRaw = readLocal('progression', userId, {});
  const local = normalizeProgressionMap(localRaw);

  // Rewrite storage if normalizing actually changed something, so the migration
  // happens once rather than on every read.
  if (Object.keys(local).length !== Object.keys(localRaw).length ||
      Object.keys(localRaw).some((k) => !(k in local))) {
    writeLocal('progression', userId, local);
  }

  const remote = await pullState().catch(() => null);
  if (!remote?.progression) return local;

  const remoteNorm = normalizeProgressionMap(remote.progression);
  // Server rows win on conflict; local-only exercises are kept and pushed.
  const merged = { ...local, ...remoteNorm };
  writeLocal('progression', userId, merged);

  // Push anything the server lacks — including rows it holds only under an old
  // un-normalized key, which is how the canonical key propagates to the server.
  const missing = Object.fromEntries(
    Object.entries(local).filter(([name]) => !(name in remoteNorm)),
  );
  if (Object.keys(missing).length) backgroundPush({ progression: missing });
  return merged;
}

export async function saveUserProgression(userId, progressionData) {
  const normalized = normalizeProgressionMap(progressionData);
  const stored = writeLocal('progression', userId, normalized);
  if (stored) backgroundPush({ progression: normalized });
  else await pushChanges({ progression: normalized }).catch(() => {});
}

// ===== ADAPTIVE PROGRESSION LOGIC =====

// How far one "too easy" or "too hard" moves the dial.
const REP_STEP = 2;
const HOLD_STEP = 5;
const MIN_REPS = 1;
const MIN_HOLD = 5;

export async function updateUserProgression(userId, routine, feedback) {
  if (!routine || !feedback || feedback === 'right') return;
  try {
    const modifiers = await getUserProgression(userId);

    // One adjustment per exercise, however many sets of it the routine holds.
    const seen = new Set();
    for (const ex of routine) {
      const key = normalizeExerciseKey(ex.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const mod = modifiers[key] || { reps: 0, tension: 0 };
      const repOffset = mod.reps || 0;
      const holdOffset = mod.tension || 0;

      // Static holds are reps === 1 with a real duration; everything else is
      // counted in reps.
      const isStaticHold = ex.reps === 1 && ex.tension > 2;

      if (feedback === 'easy') {
        modifiers[key] = isStaticHold
          ? { ...mod, tension: holdOffset + HOLD_STEP }
          : { ...mod, reps: repOffset + REP_STEP };
        continue;
      }

      // feedback === 'hard': ease off, but not below the floor.
      //
      // `ex` is the routine the engine just ran, which Dashboard already passed
      // through applyProgression — so ex.reps/ex.tension INCLUDE the offset.
      // Adding the offset again here (as this once did) tested base + 2×offset
      // against the floor, letting the offset run past it.
      if (isStaticHold) {
        if (ex.tension - HOLD_STEP >= MIN_HOLD) {
          modifiers[key] = { ...mod, tension: holdOffset - HOLD_STEP };
        }
      } else if (ex.reps - REP_STEP >= MIN_REPS) {
        modifiers[key] = { ...mod, reps: repOffset - REP_STEP };
      }
    }

    await saveUserProgression(userId, modifiers);
  } catch (e) {
    console.error('Error updating user progression:', e);
  }
}

// Legacy no-op: feedback is folded into the session log by logWorkoutSession()
// and into progression offsets by updateUserProgression(). Kept as an export so
// any stale import does not break the build.
export async function saveFeedback() {
  return;
}

// ===== DISPLAY NAME =====

// The name lives under a bare `userName` key rather than a namespaced one
// because it predates everything else here, and rewriting it would make the
// name vanish for anyone upgrading. The server keeps a copy in its profile
// table so a new phone greets you properly instead of calling you "Athlete".

export async function getDisplayName() {
  const local = (() => {
    try {
      return localStorage.getItem('userName') || '';
    } catch {
      return '';
    }
  })();

  // Flush first: a rename made offline must reach the server before we read
  // back from it, or the pull would hand us the stale name and overwrite the
  // new one.
  await flushOutbox().catch(() => {});
  const remote = await pullState();
  const name = remote?.profile?.userName || '';

  if (name && name !== local) {
    try {
      localStorage.setItem('userName', name);
    } catch { /* private mode; the name is cosmetic, so carry on */ }
    return name;
  }
  // Server has never seen a name but this browser has one — send it up.
  if (local && !name) backgroundPush({ profile: { userName: local } });
  return local;
}

export function setDisplayName(name) {
  const trimmed = (name || '').trim();
  try {
    if (trimmed) localStorage.setItem('userName', trimmed);
    else localStorage.removeItem('userName');
  } catch { /* ignore: nothing else depends on this write */ }
  // An empty string clears it on the server too — setProfileValues skips only
  // null and undefined.
  backgroundPush({ profile: { userName: trimmed } });
  return trimmed;
}

// ===== SYNC STATUS =====

/**
 * For the little "Synced / Offline" line in the UI. Never throws, so it is safe
 * to call from render effects.
 *
 *   { online, reachable, pending, unauthorized, storageFailed }
 *
 * `unauthorized` and `storageFailed` exist because both failures otherwise look
 * exactly like being offline, and neither is fixed by waiting: one needs the
 * password re-entered, the other means this browser cannot store anything and
 * the server is the only copy.
 */
export async function getSyncStatus() {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  if (!online) {
    return { online, reachable: false, pending: pendingCount(), unauthorized: false, storageFailed };
  }
  const reachable = await isServerReachable().catch(() => false);
  return { online, reachable, pending: pendingCount(), unauthorized: isUnauthorized(), storageFailed };
}
