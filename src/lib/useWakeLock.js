// useWakeLock.js — keep the phone screen awake for the length of a workout.
//
// The problem it solves is the one that makes the app unusable on a phone: you
// prop it against a wall, do a 45-second plank, and the display sleeps at 30
// seconds. You then have to touch a sweaty screen to see the next cue, and on
// iOS the auto-lock also suspends the timer's rendering, so the countdown you
// come back to is wrong.
//
// The Screen Wake Lock API is the whole mechanism. Three things about it decide
// the shape of this hook:
//
//   1. It requires a secure context. https:// in production (which DEPLOY.md
//      sets up) and http://localhost in development both qualify; a bare LAN
//      IP over http does not, and there `request()` rejects.
//   2. The browser releases the lock automatically whenever the document is
//      hidden — switching apps, locking manually, another tab. Coming back does
//      NOT restore it, so it has to be re-requested on visibilitychange or the
//      screen sleeps for the rest of the session.
//   3. `request()` rejects outright if the document is already hidden, so the
//      re-acquire has to be gated on visibility rather than fired blindly.
//
// There is no reliable fallback for a browser without the API. The video-loop
// trick needs a real media file and stopped working in several browsers, so
// rather than pretend, `supported: false` comes back and the UI says so — the
// honest instruction is to raise the phone's own auto-lock timer.

import { useCallback, useEffect, useRef, useState } from 'react';

export const WAKE_LOCK_SUPPORTED =
  typeof navigator !== 'undefined' &&
  'wakeLock' in navigator &&
  typeof navigator.wakeLock?.request === 'function';

/**
 * Holds a screen wake lock while `enabled` is true.
 *
 * @param {boolean} enabled Whether the screen should be held awake.
 * @returns {{ supported: boolean, active: boolean, error: string|null }}
 */
export function useWakeLock(enabled) {
  const sentinelRef = useRef(null);
  // Bumped by every release. An in-flight request whose generation is stale
  // resolves into a lock nobody wants, so it releases itself immediately. This
  // is what stops StrictMode's mount → unmount → mount from leaving an orphan.
  const genRef = useRef(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);

  const release = useCallback(() => {
    genRef.current += 1;
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (sentinel && !sentinel.released) {
      // Rejects if it was already released underneath us, which is not a fault.
      sentinel.release().catch(() => {});
    }
  }, []);

  // Promise callbacks rather than async/await, deliberately. Every setState here
  // happens in a `.then`/`.catch` callback — the "subscribe to an external
  // system" shape React's set-state-in-effect rule is looking for. Written with
  // `await`, the same statements sit in the async function's own body, and the
  // linter cannot see that the await already moved them off this render.
  const acquire = useCallback(() => {
    if (!WAKE_LOCK_SUPPORTED) return;
    if (sentinelRef.current && !sentinelRef.current.released) return;
    // Requesting while hidden always rejects; visibilitychange will call again.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    const gen = genRef.current;
    navigator.wakeLock.request('screen').then(
      (sentinel) => {
        if (gen !== genRef.current) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        setActive(true);
        setError(null);
        // Fires both when the browser drops it (page hidden) and when we release
        // it ourselves, so it only clears the flag — re-acquiring is the
        // visibilitychange handler's job.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
          setActive(false);
        });
      },
      (err) => {
        // NotAllowedError covers an insecure origin, a blocking permissions
        // policy, and low battery on some Android builds. None are recoverable
        // by retrying, so record it and stop.
        setError(err?.name === 'NotAllowedError' ? 'blocked' : (err?.name || 'failed'));
      },
    );
  }, []);

  useEffect(() => {
    // No `release()` here for the `!enabled` case. React runs the previous
    // effect's cleanup before the new body, so flipping enabled true → false has
    // already released the lock and bumped the generation by the time this runs.
    // Calling it again would only be a synchronous setState in an effect body,
    // which is a cascading render for no benefit.
    if (!enabled) return undefined;
    acquire();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [enabled, acquire, release]);

  return { supported: WAKE_LOCK_SUPPORTED, active, error };
}
