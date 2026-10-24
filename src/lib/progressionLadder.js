// progressionLadder.js — the adaptive progression brain.
//
// The old system had one knob: a rep offset per exercise. "Too easy" added
// 2 reps forever, so a user who could do 35 push-ups was eventually told to do
// 45 — endurance, not strength — and "too hard" could only shave reps off the
// same movement. It had no concept of *progressing to a harder variation*,
// which is the one thing that matters with bodyweight training.
//
// This module fixes that with ladders. Every exercise family (push, pull,
// squat, core, ...) is a stack of harder and harder variations, all doable
// with the equipment this app assumes: a chair, a table edge, a pull-up bar,
// and a backpack full of books.
//
//   push:   Weighted push-ups (backpack) → Decline push-ups → Archer → One-arm
//   pull:   Pull-ups → Slow negatives → Weighted → Archer
//   squat:  Deep squats → Deep pause squats → Box squats → Pistol
//   ...
//
// State per family is the same row shape the server already stores:
//
//   { reps: <rep offset within the current variation>, tension: <...>,
//     tier: <index into the ladder> }
//
// The rep offset only walks between the current variation's min and max; when
// it reaches the ceiling and the user still says "too easy", the tier
// advances to the next variation and the offset resets. That is what makes
// progression *go somewhere* instead of climbing forever.

import { normalizeExerciseKey } from './exerciseKey.js';

// A ladder is `{ step, tiers: [{ name, min, max }, ...] }`.
//   step  — how many reps one "too easy"/"too hard" answer moves the dial.
//   tiers — from the variation a beginner starts on to the hardest one.
//           min/max are the rep range for that variation.
export const FAMILY_LADDERS = {
  push: {
    step: 2,
    tiers: [
      { name: 'Weighted push-ups (backpack)', min: 8, max: 12 },
      { name: 'Decline push-ups (feet on chair)', min: 8, max: 12 },
      { name: 'Archer push-ups', min: 6, max: 10 },
      { name: 'One-arm assisted push-ups', min: 4, max: 8 },
    ],
  },
  diamond: {
    step: 2,
    tiers: [
      { name: 'Diamond push-ups', min: 8, max: 12 },
      { name: 'Slow-eccentric diamond push-ups (3s down)', min: 8, max: 10 },
      { name: 'Weighted diamond push-ups (backpack)', min: 6, max: 10 },
    ],
  },
  pike: {
    step: 2,
    tiers: [
      { name: 'Pike push-ups', min: 8, max: 12 },
      { name: 'Feet-elevated pike push-ups', min: 6, max: 10 },
      { name: 'Wall handstand push-up negatives', min: 4, max: 8 },
    ],
  },
  dip: {
    step: 2,
    tiers: [
      { name: 'Chair dips', min: 10, max: 15 },
      { name: 'Slow-eccentric chair dips (3s down)', min: 8, max: 12 },
      { name: 'Single-leg chair dips', min: 6, max: 10 },
      { name: 'Weighted chair dips (backpack)', min: 6, max: 10 },
    ],
  },
  row: {
    step: 2,
    tiers: [
      { name: 'Inverted rows (feet on floor)', min: 8, max: 12 },
      { name: 'Inverted rows (feet elevated on chair)', min: 6, max: 10 },
      { name: 'Archer inverted rows', min: 5, max: 8 },
    ],
  },
  pull: {
    step: 1,
    tiers: [
      { name: 'Pull-ups', min: 4, max: 6 },
      { name: 'Pull-ups — slow negative (3s down)', min: 4, max: 6 },
      { name: 'Weighted pull-ups (backpack)', min: 4, max: 6 },
      { name: 'Archer pull-ups', min: 3, max: 6 },
    ],
  },
  squat: {
    step: 2,
    tiers: [
      { name: 'Deep squats', min: 12, max: 15 },
      { name: 'Deep pause squats (2s hold)', min: 10, max: 13 },
      { name: 'Single-leg box squats (chair)', min: 8, max: 12 },
      { name: 'Pistol squat progression', min: 5, max: 8 },
    ],
  },
  bss: {
    step: 1,
    tiers: [
      { name: 'Bulgarian split squats', min: 10, max: 12 },
      { name: 'Slow-tempo Bulgarian split squats (3s down)', min: 8, max: 10 },
      { name: 'Weighted Bulgarian split squats (backpack)', min: 8, max: 10 },
    ],
  },
  rdl: {
    step: 1,
    tiers: [
      { name: 'Single-leg RDLs', min: 10, max: 12 },
      { name: 'Slow-tempo single-leg RDLs', min: 8, max: 10 },
      { name: 'Weighted single-leg RDLs (backpack)', min: 8, max: 10 },
    ],
  },
  bridge: {
    step: 1,
    tiers: [
      { name: 'Single-leg glute bridges', min: 12, max: 15 },
      { name: 'Slow-tempo single-leg glute bridges', min: 10, max: 12 },
      { name: 'Weighted glute bridges (backpack on hips)', min: 10, max: 12 },
    ],
  },
  calf: {
    step: 1,
    tiers: [
      { name: 'Single-leg calf raises', min: 15, max: 20 },
      { name: 'Slow-tempo single-leg calf raises', min: 12, max: 15 },
      { name: 'Weighted single-leg calf raises (backpack)', min: 12, max: 15 },
    ],
  },
  curl: {
    step: 1,
    tiers: [
      { name: 'Water-bottle curls', min: 12, max: 15 },
      { name: 'Backpack curls', min: 10, max: 12 },
      { name: 'Slow-tempo backpack curls', min: 8, max: 10 },
    ],
  },
  core: {
    step: 1,
    tiers: [
      { name: 'Leg raises', min: 12, max: 15 },
      { name: 'Hanging knee raises', min: 8, max: 12 },
      { name: 'Hanging leg raises', min: 6, max: 10 },
      { name: 'Windshield wipers', min: 4, max: 8 },
    ],
  },
  crunch: {
    step: 1,
    tiers: [
      { name: 'Reverse crunches', min: 12, max: 15 },
      { name: 'Slow-tempo reverse crunches', min: 10, max: 12 },
      { name: 'Weighted reverse crunches (backpack between feet)', min: 8, max: 10 },
    ],
  },
  cobra: {
    step: 1,
    tiers: [
      { name: 'Prone cobra / reverse snow angels', min: 12, max: 15 },
      { name: 'Slow-tempo reverse snow angels', min: 10, max: 12 },
      { name: 'Weighted reverse snow angels (backpack on back)', min: 8, max: 10 },
    ],
  },
};

// Different spellings of the same movement fold onto one family. The
// builder's "Glute bridges" and the plan's "Single-leg glute bridges" are one
// family, so getting stronger at one upgrades the other. Exercises that are
// genuinely different movements ("Jump squats", "Plank", "Burpees") are not
// listed and keep the old plain-offset behavior in localStore.js.
const FAMILY_ALIASES = {
  pushup: 'push',
  diamondpushup: 'diamond',
  pikepushup: 'pike',
  chairdip: 'dip',
  invertedrow: 'row',
  backpackrow: 'row',
  pullup: 'pull',
  chinup: 'pull',
  squat: 'squat',
  deepsquat: 'squat',
  deeppausesquat: 'squat',
  bulgariansplitsquat: 'bss',
  singlelegrdl: 'rdl',
  singlelegglutebridge: 'bridge',
  glutebridge: 'bridge',
  singlelegcalfraise: 'calf',
  waterbottlecurl: 'curl',
  backpackcurl: 'curl',
  backpackbicepcurl: 'curl',
  legraise: 'core',
  hangingkneeraise: 'core',
  hanginglegraise: 'core',
  reversecrunch: 'crunch',
  pronecobra: 'cobra',
};

// Every variation name in every ladder also maps back to its family. Without
// this, an upgrade to "Decline push-ups" would leave the next feedback unable
// to find the push ladder — the session log carries the variation's name, not
// the original seed. Aliases win on conflict so a short canonical key like
// "pushup" is never shadowed by a longer generated one.
const FAMILY_OF_KEY = { ...FAMILY_ALIASES };
for (const [family, ladder] of Object.entries(FAMILY_LADDERS)) {
  for (const tier of ladder.tiers) {
    const key = normalizeExerciseKey(tier.name);
    if (!(key in FAMILY_OF_KEY)) FAMILY_OF_KEY[key] = family;
  }
}

/**
 * Which ladder family an exercise belongs to, given its display name. Falls
 * back to the same key folding the storage uses, so "Pushups" and "Push-ups"
 * land on the push ladder. Returns null for exercises with no ladder, which
 * then keep the old plain-offset progression.
 */
export function familyOf(exerciseName) {
  return FAMILY_OF_KEY[normalizeExerciseKey(exerciseName)] || null;
}

/** Same as familyOf, but for an already-normalized key. */
export function familyOfKey(key) {
  return FAMILY_OF_KEY[key] || null;
}

/**
 * The stored modifier row for a family.
 *
 * Rows used to be keyed by the exercise's canonical name ("pushup"); ladder
 * families now store under the family id ("push"). This reads either, so a
 * device with legacy rows still gets its progression, and it always prefers
 * the family id — the format new writes use.
 */
export function familyModifier(modifiers, family) {
  if (!modifiers || typeof modifiers !== 'object') return null;
  if (modifiers[family]) return modifiers[family];
  for (const [key, value] of Object.entries(modifiers)) {
    if (FAMILY_OF_KEY[key] === family) return value;
  }
  return null;
}

/** Clamp a tier index into a ladder's range. */
export function clampTier(family, tier) {
  const ladder = FAMILY_LADDERS[family];
  if (!ladder) return 0;
  return Math.min(Math.max(0, tier | 0), ladder.tiers.length - 1);
}

/** The variation a family/tier resolves to (never null for a known family). */
export function getVariation(family, tier) {
  const ladder = FAMILY_LADDERS[family];
  if (!ladder) return null;
  return ladder.tiers[clampTier(family, tier)];
}

/**
 * Reps a variation shows for a stored offset: the variation's floor plus the
 * offset, clamped into the variation's range. The cap is the whole point — a
 * 35-rep push-up is endurance, so the offset stops at the range top and the
 * *tier* has to move instead.
 */
export function repForVariation(family, tier, offset) {
  const v = getVariation(family, tier);
  if (!v) return null;
  return Math.min(v.max, Math.max(v.min, v.min + (offset || 0)));
}
