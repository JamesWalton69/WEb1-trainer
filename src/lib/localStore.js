// localStore.js — All workout persistence, backed by browser LocalStorage.
//
// This app is fully local and account-free: there is no sign-in, no remote
// database, and no network calls for persistence. Every read and write below
// targets `localStorage` only, so the app works offline and owns no user data
// beyond the visitor's own browser.
//
// The `userId` argument on these functions is kept for call-site compatibility
// and is used purely as a storage-key namespace. It defaults to LOCAL_USER_ID.

export const LOCAL_USER_ID = 'guest';

function keyFor(prefix, userId) {
  return `fittrainer_${prefix}_${userId || LOCAL_USER_ID}`;
}

// ===== WORKOUT SESSION LOGGING =====

export async function logWorkoutSession(userId, summary) {
  const sessionData = {
    ...summary,
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-CA'),
  };

  try {
    const localKey = keyFor('sessions', userId);
    const localSessions = JSON.parse(localStorage.getItem(localKey) || '[]');
    // Avoid duplicate logging of the same session in local storage
    const exists = localSessions.some(
      s => s.date === sessionData.date && s.last_exercise === sessionData.last_exercise && s.active_minutes === sessionData.active_minutes
    );
    if (!exists) {
      localSessions.unshift(sessionData);
      localStorage.setItem(localKey, JSON.stringify(localSessions.slice(0, 100))); // Cap at 100 local logs
    }
  } catch (e) {
    console.error('Error saving session to localStorage:', e);
  }
}

// ===== GET WORKOUT HISTORY =====

export async function getWorkoutHistory(userId) {
  let localData = [];
  try {
    localData = JSON.parse(localStorage.getItem(keyFor('sessions', userId)) || '[]');
  } catch (e) {
    console.error('Error loading sessions from localStorage:', e);
  }

  // Newest first, tolerating both ISO strings and legacy {seconds} shapes.
  return localData.sort((a, b) => {
    const timeA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp).getTime();
    const timeB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });
}

// ===== COMPUTE USER STATS =====

export function computeStats(sessions) {
  const totalSessions = sessions.filter(s => s.status === 'Completed').length;
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.active_minutes || 0), 0);
  const totalPauses = sessions.reduce((sum, s) => sum + (s.pauses || 0), 0);

  // Calculate streak
  const completedDates = [...new Set(
    sessions
      .filter(s => s.status === 'Completed')
      .map(s => s.date)
  )].sort().reverse();

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < completedDates.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toLocaleDateString('en-CA');
    
    // Check if expectedStr or yesterday is in completedDates to allow for today's flex
    if (completedDates.includes(expectedStr)) {
      streak++;
    } else if (i === 0) {
      // Check if streak was maintained yesterday
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA');
      if (completedDates.includes(yesterdayStr)) {
        continue;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  // Calculate level (1 level per 5 completed sessions)
  const level = Math.max(1, Math.floor(totalSessions / 5) + 1);

  // Weekly minutes
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const weeklyMinutes = sessions
    .filter(s => s.date && new Date(s.date) >= oneWeekAgo)
    .reduce((sum, s) => sum + (s.active_minutes || 0), 0);

  return {
    totalSessions,
    totalMinutes: Math.round(totalMinutes * 100) / 100,
    totalPauses,
    streak,
    level,
    weeklyMinutes: Math.round(weeklyMinutes * 100) / 100,
    completedDates,
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
    const dateStr = d.toLocaleDateString('en-CA');
    const dayName = days[d.getDay()];
    const dayMinutes = sessions
      .filter(s => s.date === dateStr)
      .reduce((sum, s) => sum + (s.active_minutes || 0), 0);
    last7.push({ day: dayName, date: dateStr, minutes: Math.round(dayMinutes * 10) / 10 });
  }

  return last7;
}

// ===== STREAK CALENDAR (last 28 days) =====

export function buildStreakCalendar(completedDates) {
  const cells = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA');
    const completed = completedDates.includes(dateStr);
    cells.push({ date: dateStr, completed });
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

  try {
    const localKey = keyFor('routines', userId);
    const localRoutines = JSON.parse(localStorage.getItem(localKey) || '[]');
    const index = localRoutines.findIndex(r => r.id === id);
    if (index >= 0) {
      localRoutines[index] = newRoutine;
    } else {
      localRoutines.unshift(newRoutine);
    }
    localStorage.setItem(localKey, JSON.stringify(localRoutines));
  } catch (e) {
    console.error('Error saving custom routine to localStorage:', e);
  }

  return id;
}

export async function getCustomWorkouts(userId) {
  try {
    return JSON.parse(localStorage.getItem(keyFor('routines', userId)) || '[]');
  } catch (e) {
    console.error('Error loading custom routines from localStorage:', e);
    return [];
  }
}

export async function deleteCustomWorkout(userId, routineId) {
  try {
    const localKey = keyFor('routines', userId);
    const localRoutines = JSON.parse(localStorage.getItem(localKey) || '[]');
    const updated = localRoutines.filter(r => r.id !== routineId);
    localStorage.setItem(localKey, JSON.stringify(updated));
  } catch (e) {
    console.error('Error deleting custom routine from localStorage:', e);
  }
}

// ===== ADAPTIVE PROGRESSION STORAGE =====

export async function getUserProgression(userId) {
  try {
    return JSON.parse(localStorage.getItem(keyFor('progression', userId)) || '{}');
  } catch (e) {
    console.error('Error loading progression from localStorage:', e);
    return {};
  }
}

export async function saveUserProgression(userId, progressionData) {
  try {
    localStorage.setItem(keyFor('progression', userId), JSON.stringify(progressionData));
  } catch (e) {
    console.error('Error saving progression to localStorage:', e);
  }
}

// ===== ADAPTIVE PROGRESSION LOGIC =====

export async function updateUserProgression(userId, routine, feedback) {
  if (!routine || !feedback || feedback === 'right') return;
  try {
    const modifiers = await getUserProgression(userId);
    const uniqueExercises = [...new Set(routine.map(ex => ex.name))];
    
    uniqueExercises.forEach(name => {
      const ex = routine.find(e => e.name === name);
      if (!ex) return;
      
      if (!modifiers[name]) {
        modifiers[name] = { reps: 0, tension: 0 };
      }
      
      // Calculate how much to adjust based on whether it is static or dynamic
      // Hold tension exercises have reps = 1 and higher tension hold values
      const isStaticHold = ex.reps === 1 && ex.tension > 2;

      if (feedback === 'easy') {
        if (isStaticHold) {
          modifiers[name].tension = (modifiers[name].tension || 0) + 5; // Add 5 seconds to hold time
        } else {
          modifiers[name].reps = (modifiers[name].reps || 0) + 2; // Add 2 reps to dynamic
        }
      } else if (feedback === 'hard') {
        if (isStaticHold) {
          // Prevent hold times from falling below 5s
          const currentHold = ex.tension + (modifiers[name].tension || 0);
          if (currentHold > 5) {
            modifiers[name].tension = (modifiers[name].tension || 0) - 5;
          }
        } else {
          // Prevent reps from falling below 1
          const currentReps = ex.reps + (modifiers[name].reps || 0);
          if (currentReps > 1) {
            modifiers[name].reps = (modifiers[name].reps || 0) - 2;
          }
        }
      }
    });
    
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
