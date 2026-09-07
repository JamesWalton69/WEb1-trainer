// exerciseKey.js — one canonical key per exercise, for progression lookups.
//
// Progression offsets ("this person can now do 2 more push-ups") are stored per
// exercise name. The names come from two places that never agreed:
//
//   the plan, src/lib/workout-routine.json  ->  "Push-ups", "Glute bridges"
//   the builder presets, WorkoutBuilder.jsx ->  "Pushups",  "Glute Bridges"
//
// Keyed literally, those are four different exercises, so getting stronger at
// push-ups on a plan day had no effect on push-ups in a custom routine. Every
// read and write of a progression modifier goes through normalizeExerciseKey so
// the two vocabularies land on the same row.
//
// Deliberately kept in its own module with no imports: localStore.js needs it,
// and localStore.js is loaded by scripts/test-sync.mjs under plain Node, where
// weeklyPlan.js cannot be imported (it uses a bare JSON import).

/**
 * Fold an exercise name to its storage key.
 *
 * Case, spaces, hyphens and a trailing plural are all noise:
 *   "Push-ups" · "Pushups" · "push ups" · "Push-Up"  ->  "pushup"
 *
 * Not a display name — never render this. Sessions and routines keep the
 * original spelling; only progression keys are normalized.
 */
export function normalizeExerciseKey(name) {
  const flat = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')            // "é" -> "e" + combining accent
    .replace(/[^a-z0-9]/g, '');   // drops the accent, spaces, hyphens, "/"
  // Singularise, but never to nothing: "dips" -> "dip", "press" -> "press".
  return flat.endsWith('s') && !flat.endsWith('ss') && flat.length > 3
    ? flat.slice(0, -1)
    : flat;
}

/**
 * Rewrite a `{ [exerciseName]: modifier }` map so every key is canonical.
 *
 * Used both to migrate stored data written before normalization existed and to
 * merge the local and server copies. Two raw names can collapse onto one key —
 * someone who trained "Push-ups" on a plan day and "Pushups" in a custom
 * routine has both. The already-canonical spelling wins, since that is the one
 * every future write will target; otherwise the first seen wins. Offsets are
 * never summed, which would silently double someone's progression.
 */
export function normalizeProgressionMap(modifiers) {
  if (!modifiers || typeof modifiers !== 'object') return {};
  const out = {};
  for (const [name, mod] of Object.entries(modifiers)) {
    if (!mod || typeof mod !== 'object') continue;
    const key = normalizeExerciseKey(name);
    if (!key) continue;
    if (!(key in out) || name === key) out[key] = mod;
  }
  return out;
}
