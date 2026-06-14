// weeklyPlan.js — Dynamic routine loader and parser for workout-routine.json

import workoutRoutine from '../../../workout-routine.json';

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
  const isRest = day.name.toLowerCase() === 'rest';
  
  // Custom warmup text based on warmUpMinutes
  const warmup = day.warmUpMinutes > 0 ? [
    `Light mobility movements (shoulder & hip rolls) × 2 min`,
    `Gentle cardio (jumping jacks or jogging in place) × 2 min`,
    `Dynamic stretches (leg swings, arm swings) × 1 min`
  ] : [];
  
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
  if (day.exercises) {
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
  emoji: '🗓️',
  equipment: (workoutRoutine.overview?.equipment || []).join(', '),
  goal: workoutRoutine.overview?.goal || '',
  workoutTime: workoutRoutine.overview?.goal ? '~40-45 min' : '',
  restGuidelines: workoutRoutine.overview?.notes || [],
  days: parsedDays,
  progressionRules: [
    {
      exercise: 'Push-ups',
      when: 'When you can do 4 × 15 comfortably',
      moveTo: 'Move to decline push-ups (feet elevated).',
    },
    {
      exercise: 'Pike push-ups',
      when: 'When you hit 3 × 12',
      moveTo: 'Elevate your feet on a chair.',
    },
    {
      exercise: 'Squats',
      when: 'When 4 × 20 is easy',
      moveTo: 'Move to Bulgarian split squats or jump squats.',
    }
  ]
};

export function resolveWeeklyPlanDay(dayId) {
  const byId = Object.fromEntries(weeklyCalisthenicsPlan.days.map((entry) => [entry.id, entry]));
  return byId[dayId] || byId.monday;
}
