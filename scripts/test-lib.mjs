#!/usr/bin/env node
// test-lib.mjs — pure-logic tests. No server, no fake browser beyond a Map.
//
//   npm run test:lib
//
// server/test.mjs covers the API and scripts/test-sync.mjs covers the sync
// rules; this covers the arithmetic and string handling that no round trip
// touches, and where every bug so far has been a silent wrong answer rather
// than a crash:
//
//   * the phase colour table, where a substring match made one entry dead code
//   * the stats split between "did you finish" and "how long did you train"
//   * the streak's day-of-grace and its local-vs-UTC date handling
//   * exercise-name folding, which decides whether progression is shared

import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// `import()` of a bare Windows path throws ERR_UNSUPPORTED_ESM_URL_SCHEME —
// Node reads the drive letter as a protocol ('e:'). Every dynamic import here
// goes through a file:// URL so the suite runs on Windows as well as Linux.
const lib = (name) => pathToFileURL(join(ROOT, 'src', 'lib', name)).href;

// localStore.js reads localStorage at module scope in places; a Map is enough.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
// Nothing here should reach the network; if something does, fail loudly rather
// than hanging for the 8s request timeout.
globalThis.fetch = () => Promise.reject(new Error('test-lib must not make requests'));

const { getPhaseColor, PHASE_COLORS, phaseRgb, phaseAlpha, phaseVars, isPhaseActive } =
  await import(lib('phaseColor.js'));
const { normalizeExerciseKey, normalizeProgressionMap } = await import(lib('exerciseKey.js'));
const { FAMILY_LADDERS, familyOf, clampTier, getVariation, repForVariation } =
  await import(lib('progressionLadder.js'));
const { computeStats, computeBadges, buildChartData, buildStreakCalendar } =
  await import(lib('localStore.js'));

let passed = 0;
function check(name, fn) {
  fn();
  console.log(`  ok  ${name}`);
  passed++;
}

// Local YYYY-MM-DD, the same shape localStore writes.
const dayStr = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA');
};

const session = (over = {}) => ({
  id: `s-${Math.random().toString(36).slice(2, 8)}`,
  date: dayStr(),
  timestamp: new Date().toISOString(),
  status: 'Completed',
  active_minutes: 10,
  pauses: 0,
  last_exercise: 'Plank',
  ...over,
});

// ===== phase colours =====

const EXERCISE_NAMES = ['Push-ups', 'Pike push-ups', 'Wall sit', 'Plank',
                        'Superman hold', 'Backpack Romanian deadlifts'];

// Every string WorkoutEngine can hand to setPhase, one per call site in
// runWorkout plus the paused branch that overrides it.
const ENGINE_PHASES = [
  'GET READY', 'WARM-UP', 'UP', 'REST', 'TRANSITION', 'COMPLETE', 'PAUSED',
  ...EXERCISE_NAMES,
  ...EXERCISE_NAMES.map((n) => `NEXT: ${n}`),
  ...Array.from({ length: 20 }, (_, i) => `REP ${i + 1} — DOWN`),
];

check('the warm-up screen is blue, not the alarm-red UP colour', () => {
  // The regression: 'WARM-UP'.includes('UP') is true, so testing substrings
  // before exact names returned #DC2626 and the blue was never reachable.
  assert.equal(getPhaseColor('WARM-UP'), PHASE_COLORS['WARM-UP']);
  assert.notEqual(getPhaseColor('WARM-UP'), PHASE_COLORS.UP);
});

check('every phase the engine can set has a sensible colour', () => {
  const expect = {
    'GET READY': 'GET READY',
    'WARM-UP': 'WARM-UP',
    'UP': 'UP',
    'REST': 'REST',
    'TRANSITION': 'TRANSITION',
    'COMPLETE': 'COMPLETE',
    'PAUSED': 'PAUSED',
    'REP 1 — DOWN': 'DOWN',
    'REP 12 — DOWN': 'DOWN',
    'NEXT: Push-ups': 'NEXT',
    'NEXT: Pike push-ups': 'NEXT',
  };
  for (const [phase, key] of Object.entries(expect)) {
    assert.equal(getPhaseColor(phase), PHASE_COLORS[key], `${phase} should use the ${key} colour`);
  }
  // A bare exercise name is the mid-set case and must not borrow UP's red.
  for (const name of EXERCISE_NAMES) {
    assert.notEqual(getPhaseColor(name), PHASE_COLORS.UP, `${name} must not read as UP`);
  }
});

check('no entry in the colour table is dead code', () => {
  // The check that catches the WARM-UP class of bug at its root: feed in every
  // string the engine can actually pass to setPhase — not the table's own keys,
  // which would trivially match themselves — and require each colour to come
  // back at least once. A tenth entry, SET, failed exactly this and was cut;
  // the set number lives in subInfo, so `phase` never contained it.
  const produced = new Set(ENGINE_PHASES.map(getPhaseColor));
  for (const [key, colour] of Object.entries(PHASE_COLORS)) {
    assert.ok(produced.has(colour), `PHASE_COLORS.${key} is never returned`);
  }
});

check('a missing or odd phase does not throw', () => {
  // WORK, not REST: the fallback is the mid-set colour now that the phase paints
  // the whole screen, because REST's dark teal at full size reads as "no colour
  // at all" — which is the bug the full-screen wash was meant to fix.
  for (const bad of [undefined, null, '', 0]) {
    assert.equal(getPhaseColor(bad), PHASE_COLORS.WORK);
  }
});

check('a phase colour survives the trip through CSS custom properties', () => {
  // phaseVars feeds --phase and --phase-rgb, which .workout-shell and its glow
  // read separately. If they ever describe different colours the glow no longer
  // matches the background, so they are built from one source here.
  const vars = phaseVars('UP');
  assert.equal(vars['--phase'], PHASE_COLORS.UP, 'a table key resolves to its colour');
  assert.equal(vars['--phase-rgb'], '220, 38, 38');
  assert.equal(phaseVars('#059669')['--phase'], '#059669', 'a literal hex passes through');

  for (const colour of Object.values(PHASE_COLORS)) {
    const rgb = phaseRgb(colour);
    assert.equal(rgb.length, 3);
    for (const channel of rgb) {
      assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, `${colour} → ${rgb}`);
    }
  }
});

check('an unparseable colour still produces a valid rgba() string', () => {
  // rgba(NaN, NaN, NaN, 0.3) is an invalid declaration the browser drops in
  // silence, and .phase-field is built entirely from these — one NaN would take
  // the whole colour field with it. So garbage falls back instead of spreading.
  const workRgb = phaseRgb(PHASE_COLORS.WORK).join(', ');
  for (const bad of [undefined, null, '', 'red', '#ab', '#GGGGGG', 42]) {
    assert.equal(phaseRgb(bad).join(', '), workRgb, `${bad} should fall back to WORK`);
  }
  assert.equal(phaseAlpha('#DC2626', 0.3), 'rgba(220, 38, 38, 0.3)');
  assert.equal(phaseAlpha('#DC2626'), 'rgba(220, 38, 38, 1)', 'alpha defaults to opaque');
  // Out-of-range and non-numeric alphas are clamped rather than emitted raw.
  assert.equal(phaseAlpha('#DC2626', 4), 'rgba(220, 38, 38, 1)');
  assert.equal(phaseAlpha('#DC2626', -1), 'rgba(220, 38, 38, 0)');
  assert.equal(phaseAlpha('#DC2626', NaN), 'rgba(220, 38, 38, 1)');
});

check('only the rep phases make the colour field breathe', () => {
  // The pulse has to mean something, so it is limited to the moment the user is
  // moving. WARM-UP is the trap again: it ends in "UP" but nothing is happening.
  for (const active of ['UP', 'REP 1 — DOWN', 'REP 12 — DOWN']) {
    assert.equal(isPhaseActive(active), true, `${active} should pulse`);
  }
  for (const still of ['WARM-UP', 'GET READY', 'REST', 'TRANSITION', 'COMPLETE',
                       'PAUSED', 'NEXT: Push-ups', 'Plank', '', null, undefined]) {
    assert.equal(isPhaseActive(still), false, `${still} should hold still`);
  }
});

// ===== exercise keys =====

check('the spellings that used to fork progression now fold together', () => {
  const groups = [
    ['Push-ups', 'Pushups', 'push ups', 'PUSH-UPS', 'Push Up', 'pushup'],
    ['Glute bridges', 'Glute Bridges', 'glute-bridge'],
    ['Backpack rows', 'backpack row', 'Backpack Rows'],
  ];
  for (const [first, ...rest] of groups) {
    for (const other of rest) {
      assert.equal(normalizeExerciseKey(other), normalizeExerciseKey(first),
        `${other} should key the same as ${first}`);
    }
  }
});

check('different exercises keep different keys', () => {
  const distinct = ['Push-ups', 'Pike push-ups', 'Diamond push-ups', 'Incline push-ups',
                    'Plank', 'Side plank', 'Wall sit', 'Jump squats', 'Backpack squats'];
  const keys = distinct.map(normalizeExerciseKey);
  assert.equal(new Set(keys).size, distinct.length, `collision among ${keys.join(', ')}`);
});

check('the -s trim does not eat a real word', () => {
  // Trimming a trailing 's' is what makes "rows" and "row" agree; it must not
  // turn a short name into something else or strip a doubled s.
  assert.equal(normalizeExerciseKey('Press'), 'press');
  assert.equal(normalizeExerciseKey('Dips'), normalizeExerciseKey('Dip'));
  assert.equal(normalizeExerciseKey(''), '');
  assert.equal(normalizeExerciseKey(null), '');
});

check('normalizing a progression map keeps one row per exercise', () => {
  const folded = normalizeProgressionMap({
    'Push-ups': { reps: 4, tension: 0 },
    Pushups: { reps: 2, tension: 0 },
    'Jump Squats': { reps: -2, tension: 0 },
    Plank: null,              // dropped
    '': { reps: 1 },          // dropped
  });
  assert.deepEqual(Object.keys(folded).sort(), ['jumpsquat', 'pushup']);
  assert.equal(folded.jumpsquat.reps, -2);
});

// ===== progression ladders =====

check('every ladder variation maps back to its own family', () => {
  // The session log carries the variation's name ("Decline push-ups"), so the
  // brain must be able to find the ladder from any tier's name — otherwise the
  // first level-up would orphan the exercise from further progression.
  for (const [family, ladder] of Object.entries(FAMILY_LADDERS)) {
    for (const tier of ladder.tiers) {
      assert.equal(familyOf(tier.name), family, `${tier.name} should belong to ${family}`);
    }
  }
});

check('ladders are well-formed', () => {
  for (const [family, ladder] of Object.entries(FAMILY_LADDERS)) {
    assert.ok(ladder.tiers.length >= 1, `${family} needs at least one variation`);
    assert.ok(Number.isInteger(ladder.step) && ladder.step >= 1, `${family} step must be a positive integer`);
    const names = ladder.tiers.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, `${family} variation names must be unique`);
    for (const t of ladder.tiers) {
      assert.ok(Number.isInteger(t.min) && Number.isInteger(t.max), `${family}/${t.name} range must be integers`);
      assert.ok(t.min >= 1, `${family}/${t.name} min must be at least 1`);
      assert.ok(t.min <= t.max, `${family}/${t.name} min must not exceed max`);
    }
  }
});

check('family aliases fold the common spellings together', () => {
  assert.equal(familyOf('Push-ups'), 'push');
  assert.equal(familyOf('Pushups'), 'push');
  assert.equal(familyOf('Diamond push-ups'), 'diamond');
  assert.equal(familyOf('Pike push-ups'), 'pike');
  assert.equal(familyOf('Chair dips'), 'dip');
  assert.equal(familyOf('Backpack rows'), 'row');
  assert.equal(familyOf('Pull-ups'), 'pull');
  assert.equal(familyOf('Chin-ups'), 'pull');
  assert.equal(familyOf('Deep squats'), 'squat');
  assert.equal(familyOf('Deep pause squats'), 'squat');
  assert.equal(familyOf('Bulgarian split squats'), 'bss');
  assert.equal(familyOf('Glute bridges'), 'bridge');
  assert.equal(familyOf('Reverse crunches'), 'crunch');
  assert.equal(familyOf('Prone cobra'), 'cobra');
});

check('exercises with no ladder resolve to null', () => {
  for (const name of ['Plank', 'Burpees', 'Jump squats', 'Mountain climbers',
                      'Reverse lunges', 'Wall sit', 'Bird dogs', 'Dead bugs']) {
    assert.equal(familyOf(name), null, `${name} should have no ladder`);
  }
});

check('rep offsets are clamped inside the current variation range', () => {
  assert.equal(repForVariation('push', 0, 0), 8);
  assert.equal(repForVariation('push', 0, 99), 12, 'cap at the ceiling');
  assert.equal(repForVariation('push', 0, -9), 8, 'floor at the variation minimum');
  assert.equal(repForVariation('pull', 0, 2), 6);
  assert.equal(repForVariation('pull', 0, 3), 6, 'pull-ups cap at 6');
  assert.equal(repForVariation('pull', 3, 0), 3);
  assert.equal(repForVariation('bogus', 0, 0), null);
});

check('tier indices are clamped into the ladder', () => {
  assert.equal(clampTier('push', -3), 0);
  assert.equal(clampTier('push', 0), 0);
  assert.equal(clampTier('push', 99), 3);
  assert.equal(clampTier('bogus', 2), 0);
  assert.equal(getVariation('push', 3).name, 'One-arm assisted push-ups');
});

// ===== stats =====

check('finished and attempted workouts are counted separately', () => {
  // The contradiction this fixes: "Sessions: 2" beside minute totals that
  // included a third, abandoned workout.
  const stats = computeStats([
    session({ active_minutes: 30 }),
    session({ active_minutes: 20 }),
    session({ status: 'Incomplete', active_minutes: 5, pauses: 3 }),
  ]);
  assert.equal(stats.totalSessions, 2, 'achievement counts only completed');
  assert.equal(stats.loggedSessions, 3);
  assert.equal(stats.incompleteSessions, 1);
  assert.equal(stats.totalMinutes, 55, 'effort counts every logged minute');
  assert.equal(stats.totalPauses, 3);
});

check('levelling up needs finished workouts, not attempted ones', () => {
  // Five completed per level. Four completed plus four abandoned is still
  // level 1 — otherwise starting and quitting would rank the same as training.
  const four = Array.from({ length: 4 }, () => session());
  const quits = Array.from({ length: 4 }, () => session({ status: 'Incomplete' }));
  assert.equal(computeStats([...four, ...quits]).level, 1);
  assert.equal(computeStats([...four, session()]).level, 2, 'the fifth finish promotes');
});

check('the streak allows today but does not require it', () => {
  // Trained yesterday and the day before, nothing yet today: still a streak.
  const yesterday = computeStats([
    session({ date: dayStr(1) }),
    session({ date: dayStr(2) }),
  ]);
  assert.equal(yesterday.streak, 2);

  // Adding today extends rather than restarts it.
  const withToday = computeStats([
    session({ date: dayStr(0) }),
    session({ date: dayStr(1) }),
    session({ date: dayStr(2) }),
  ]);
  assert.equal(withToday.streak, 3);

  // A two-day gap ends it; the older run does not count.
  const broken = computeStats([
    session({ date: dayStr(3) }),
    session({ date: dayStr(4) }),
  ]);
  assert.equal(broken.streak, 0);
});

check('an unfinished workout does not extend a streak', () => {
  const stats = computeStats([
    session({ date: dayStr(1), status: 'Incomplete' }),
    session({ date: dayStr(2) }),
  ]);
  assert.equal(stats.streak, 0, 'yesterday was abandoned, so the run is broken');
  assert.equal(stats.weeklySessions, 2, 'but both still count as effort');
});

check('several sessions in one day are one streak day', () => {
  const stats = computeStats([
    session({ date: dayStr(0) }),
    session({ date: dayStr(0) }),
    session({ date: dayStr(1) }),
  ]);
  assert.equal(stats.streak, 2);
  assert.equal(stats.completedDates.length, 2);
});

check('the weekly window is the last seven days, inclusive', () => {
  const stats = computeStats([
    session({ date: dayStr(0), active_minutes: 10 }),
    session({ date: dayStr(6), active_minutes: 10 }),   // inside
    session({ date: dayStr(7), active_minutes: 99 }),   // outside
  ]);
  assert.equal(stats.weeklySessions, 2);
  assert.equal(stats.weeklyMinutes, 20);
  assert.equal(stats.totalMinutes, 119, 'the total still counts the older one');
});

check('no sessions yields zeroes rather than NaN', () => {
  const stats = computeStats([]);
  for (const [key, value] of Object.entries(stats)) {
    if (Array.isArray(value)) continue;
    assert.ok(Number.isFinite(value), `${key} should be a number, got ${value}`);
  }
  assert.equal(stats.streak, 0);
  assert.equal(stats.level, 1, 'level 1 from the start, not 0');
});

check('missing fields on a row do not poison the totals', () => {
  const stats = computeStats([
    { id: 'a', status: 'Completed' },                    // no date, no minutes
    session({ active_minutes: undefined, pauses: undefined }),
  ]);
  assert.equal(stats.totalMinutes, 0);
  assert.equal(stats.totalPauses, 0);
  assert.equal(stats.totalSessions, 2);
});

check('badges read from the same numbers the tiles show', () => {
  const sessions = [session({ pauses: 0 }), session({ status: 'Incomplete', pauses: 4 })];
  const badges = computeBadges(computeStats(sessions), sessions);
  const by = Object.fromEntries(badges.map((b) => [b.id, b.unlocked]));
  assert.equal(by.first_workout, true);
  assert.equal(by.no_pause, true);
  assert.equal(by.sessions_10, false);
  assert.equal(by.streak_3, false);
  assert.equal(new Set(badges.map((b) => b.id)).size, badges.length, 'badge ids must be unique');
});

// ===== chart and calendar =====

check('the chart covers seven days ending today', () => {
  const data = buildChartData([
    session({ date: dayStr(0), active_minutes: 12.34 }),
    session({ date: dayStr(3), active_minutes: 5 }),
    session({ date: dayStr(20), active_minutes: 99 }),  // off-chart
  ]);
  assert.equal(data.length, 7);
  assert.equal(data.at(-1).date, dayStr(0));
  assert.equal(data[0].date, dayStr(6));
  assert.equal(data.at(-1).minutes, 12.3, 'rounded to one decimal');
  assert.equal(data[3].minutes, 5);
  assert.equal(data.reduce((n, d) => n + d.minutes, 0), 17.3, 'the old session must not appear');
});

check('the chart sums a day with two workouts', () => {
  const data = buildChartData([
    session({ date: dayStr(2), active_minutes: 10 }),
    session({ date: dayStr(2), active_minutes: 6.5 }),
  ]);
  assert.equal(data.find((d) => d.date === dayStr(2)).minutes, 16.5);
});

check('the calendar marks the right 28 cells', () => {
  const cells = buildStreakCalendar([dayStr(0), dayStr(5), dayStr(27), dayStr(28)]);
  assert.equal(cells.length, 28);
  assert.equal(cells.at(-1).date, dayStr(0));
  assert.equal(cells.at(-1).completed, true);
  assert.equal(cells[0].date, dayStr(27));
  assert.equal(cells[0].completed, true);
  assert.equal(cells.filter((c) => c.completed).length, 3, 'day 28 is outside the window');
});

check('dates are local, so a UTC-evening workout stays on today', () => {
  // The trap: new Date('2026-09-05') is UTC midnight, which east of Greenwich
  // is still the 4th locally. Everything here compares en-CA strings instead,
  // so the chart's last cell and the calendar's last cell always agree with
  // what computeStats calls today.
  const today = dayStr(0);
  const stats = computeStats([session({ date: today })]);
  assert.equal(stats.streak, 1);
  assert.equal(buildChartData([]).at(-1).date, today);
  assert.equal(buildStreakCalendar([]).at(-1).date, today);
  assert.equal(stats.completedDates[0], today);
});

console.log(`\n${passed} checks passed.`);
