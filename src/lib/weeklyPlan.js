// weeklyPlan.js — Dynamic routine loader and parser for workout-routine.json

import workoutRoutine from './workout-routine.json';
import { normalizeExerciseKey } from './exerciseKey.js';
import {
  FAMILY_LADDERS,
  familyOf,
  familyModifier,
  getVariation,
  repForVariation,
} from './progressionLadder.js';

// Mapping day numbers to IDs and labels
const dayIdMap = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday'
};

const dayLabelMap = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday'
};

// Helper to parse rep counts
function parseReps(repsStr) {
  if (typeof repsStr === 'number') return repsStr;
  if (!repsStr) return 1;
  const clean = repsStr.toLowerCase();
  if (clean.includes('sec') || clean.includes('second')) {
    return 1; // Holds have 1 rep, tension handles duration
  }
  const match = clean.match(/^(\d+)/);
  return match ? parseInt(match[1]) : 10;
}

// Helper to parse hold tension time (seconds)
function parseTension(repsStr, exerciseName) {
  if (typeof repsStr === 'string') {
    const clean = repsStr.toLowerCase();
    if (clean.includes('sec') || clean.includes('second')) {
      const match = clean.match(/^(\d+)/);
      if (match) return parseInt(match[1]);
      // If it contains e.g., "40-60 sec", we can parse the range
      const rangeMatch = clean.match(/(\d+)-(\d+)\s*sec/);
      if (rangeMatch) return parseInt(rangeMatch[1]); // Lower bound for consistency
      return 45;
    }
  }
  const nameClean = exerciseName.toLowerCase();
  if (nameClean.includes('plank') || nameClean.includes('wall sit') || nameClean.includes('hang') || nameClean.includes('hold')) {
    return 45; // Default hold time
  }
  return 2; // Default dynamic rep concentric/eccentric duration
}

// Helper to parse rest between reps
function parseReset(repsStr, exerciseName) {
  if (typeof repsStr === 'string') {
    const clean = repsStr.toLowerCase();
    if (clean.includes('sec') || clean.includes('second')) {
      return 10; // Extra rest after static hold
    }
  }
  const nameClean = exerciseName.toLowerCase();
  if (nameClean.includes('plank') || nameClean.includes('wall sit') || nameClean.includes('hang') || nameClean.includes('hold')) {
    return 10;
  }
  return 0.5; // Default reset between reps
}

// Dynamic days construction
const parsedDays = workoutRoutine.days.map(day => {
  // A rest day is one with no prescribed exercises whose name says "rest".
  // The old test was `day.name.toLowerCase() === 'rest'`, an exact match that
  // nothing in the plan satisfies — day 7 is "Sunday — FULL REST" — so Sunday
  // was treated as a training day and the dashboard offered a walk-and-stretch
  // session built from its optional activities. `restDay: true` in the JSON
  // overrides the name check.
  const isRest = typeof day.restDay === 'boolean'
    ? day.restDay
    : !day.exercises?.length && /\brest\b/i.test(day.name);

  // Custom warmup text based on warmUpMinutes, or custom warmup array in JSON
  const warmup = day.warmup || (day.warmUpMinutes > 0 ? [
    `Light mobility movements (shoulder & hip rolls) × 2 min`,
    `Gentle cardio (jumping jacks or jogging in place) × 2 min`,
    `Dynamic stretches (leg swings, arm swings) × 1 min`
  ] : []);
  
  // Custom workout description text
  let workout = [];
  if (day.exercises) {
    workout = day.exercises.map(ex => `${ex.name} — ${ex.sets} sets × ${ex.reps} reps`);
  } else if (day.activities) {
    workout = day.activities.map(act => {
      if (act.sets && act.reps) return `${act.name} — ${act.sets} sets × ${act.reps}`;
      if (act.durationMinutes) return `${act.name} — ${act.durationMinutes} min`;
      return act.name;
    });
  }

  // Flat-map exercises into executable routine sets
  let executableRoutine = [];
  if (isRest) {
    // Nothing to run. Leaving this empty is what makes the dashboard's Start
    // button stay disabled instead of launching a session on a rest day.
    executableRoutine = [];
  } else if (day.exercises) {
    day.exercises.forEach(ex => {
      const setsCount = ex.sets || 1;
      const repsCount = parseReps(ex.reps);
      const tensionVal = parseTension(ex.reps, ex.name);
      const resetVal = parseReset(ex.reps, ex.name);
      for (let s = 0; s < setsCount; s++) {
        executableRoutine.push({
          name: ex.name,
          reps: repsCount,
          tension: tensionVal,
          reset: resetVal,
          restSeconds: ex.restSeconds || null,
          gif: ''
        });
      }
    });
  } else if (day.activities) {
    // Treat active recovery activities as executable
    day.activities.forEach(act => {
      if (act.name.toLowerCase().includes('rest')) return;
      const setsCount = act.sets || 1;
      const repsCount = parseReps(act.reps || (act.durationMinutes ? "1" : ""));
      const tensionVal = act.durationMinutes ? act.durationMinutes * 60 : parseTension(act.reps || "", act.name);
      const resetVal = parseReset(act.reps || "", act.name);
      for (let s = 0; s < setsCount; s++) {
        executableRoutine.push({
          name: act.name,
          reps: repsCount,
          tension: tensionVal,
          reset: resetVal,
          restSeconds: act.restSeconds || null,
          gif: ''
        });
      }
    });
  }

  // Parse rest between sets (e.g., "45-75" -> 45)
  const restBetweenSets = parseInt(day.restBetweenSetsSeconds) || 45;
  const routineSettings = {
    sets: 1, // Already flat-mapped
    restBetweenSet: 0,
    restBetweenEx: restBetweenSets,
    prepTime: 10
  };

  return {
    id: dayIdMap[day.day],
    label: dayLabelMap[day.day],
    focus: day.name,
    warmup,
    workout,
    core: [],
    warmUpMinutes: day.warmUpMinutes || 0,
    coolDownMinutes: day.coolDownMinutes || 0,
    executableRoutine,
    routineSettings,
    isRestDay: isRest
  };
});

export const weeklyCalisthenicsPlan = {
  title: workoutRoutine.title,
  emoji: '',
  equipment: (workoutRoutine.overview?.equipment || []).join(', '),
  goal: workoutRoutine.overview?.goal || '',
  workoutTime: workoutRoutine.overview?.goal ? '~30-40 min' : '',
  restGuidelines: workoutRoutine.overview?.notes || [],
  days: parsedDays,
  // The "Progression Rules" panel in the plan modal. Generated from the same
  // ladders the brain uses, so the advice shown always matches what the app
  // actually does: hit the top of the current range, and the exercise moves
  // up to the next variation.
  progressionRules: Object.entries(FAMILY_LADDERS).map(([, ladder]) => {
    const last = ladder.tiers[ladder.tiers.length - 1];
    return {
      exercise: ladder.tiers[0].name,
      when: `When you complete ${last.max} clean reps on all sets`,
      moveTo: ladder.tiers.slice(1).map((t) => t.name).join(' → '),
    };
  }),
};

export function resolveWeeklyPlanDay(dayId) {
  const byId = Object.fromEntries(weeklyCalisthenicsPlan.days.map((entry) => [entry.id, entry]));
  return byId[dayId] || byId.monday;
}

// Applies user progression to an executable routine.
//
// Exercises that belong to a ladder family (progressionLadder.js) are resolved
// to their current variation: the tier selects the variation and the rep
// offset walks inside that variation's range. Exercises with no ladder keep
// the old behavior — a plain offset on top of the base reps — so custom
// routines with unlisted movements still respond to feedback.
export function applyProgression(workout, modifiers) {
  if (!modifiers || Object.keys(modifiers).length === 0) return workout;
  return workout.map(ex => {
    const key = normalizeExerciseKey(ex.name);
    const family = familyOf(key);

    if (family) {
      const mod = familyModifier(modifiers, family) || {};
      const variation = getVariation(family, mod.tier);
      // Dynamic reps: start at the variation's floor and let the offset walk
      // up to its ceiling. Static holds keep their own floor.
      if (ex.reps > 1) {
        return { ...ex, name: variation.name, reps: repForVariation(family, mod.tier, mod.reps) };
      }
      if (ex.reps === 1 && ex.tension > 2) {
        return { ...ex, name: variation.name, tension: Math.max(5, ex.tension + (mod.tension || 0)) };
      }
      return { ...ex, name: variation.name };
    }

    const mod = modifiers[key] || {};
    let newReps = ex.reps;
    let newTension = ex.tension;

    if (ex.reps > 1) {
      newReps = Math.max(1, ex.reps + (mod.reps || 0));
    } else if (ex.reps === 1 && ex.tension > 2) {
      newTension = Math.max(5, ex.tension + (mod.tension || 0));
    }

    return { ...ex, reps: newReps, tension: newTension };
  });
}

// Groups flat-mapped sets and maps them to display strings
export function getProgressionDisplayList(executableRoutine) {
  const grouped = [];
  executableRoutine.forEach(ex => {
    const existing = grouped.find(g => g.name === ex.name);
    if (existing) {
      existing.sets++;
    } else {
      grouped.push({ name: ex.name, sets: 1, reps: ex.reps, tension: ex.tension });
    }
  });
  return grouped.map(g => {
    if (g.reps === 1 && g.tension > 2) {
      return `${g.name} — ${g.sets} sets × ${g.tension} sec hold`;
    }
    return `${g.name} — ${g.sets} sets × ${g.reps} reps`;
  });
}
