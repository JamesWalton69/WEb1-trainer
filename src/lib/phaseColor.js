// phaseColor.js — the colour of the whole workout screen, not just the word.
//
// Lives apart from the component for one reason: it is pure, and the bug it
// carried was invisible by inspection. `'WARM-UP'.includes('UP')` is true, so an
// ordering that tested substrings before exact names painted the warm-up screen
// alarm-red and left the blue in the table as code that never once ran.
// scripts/test-lib.mjs pins every phase string the engine can produce, and
// asserts that no colour in the table is unreachable.
//
// These values are now chosen to work as a full-viewport wash rather than as a
// hairline border, which is what they were used for before and why the screen
// read as "dark card with a red outline" instead of "red". Every one is a
// mid-dark saturated tone: light enough to be unmistakable across a room,
// dark enough that white display type clears 3:1 on it once
// `.phase-field`'s vignette has been laid over the top.

export const PHASE_COLORS = {
  'GET READY': '#1D4ED8',
  'WARM-UP': '#2563EB',
  'NEXT': '#4F46E5',
  // Mid-set, and the fallback for anything unrecognised. Used to be REST's
  // near-black slate, which as a full screen looked identical to no colour
  // at all — the exact complaint that started this.
  'WORK': '#4338CA',
  'DOWN': '#059669',
  'UP': '#DC2626',
  'REST': '#0F766E',
  'TRANSITION': '#155E75',
  'COMPLETE': '#D97706',
  'PAUSED': '#B45309',
};

/**
 * Colour for a phase label.
 *
 * Exact names win. The substring rules below exist only for the phases the
 * engine composes at runtime and so cannot list literally: `REP 3 — DOWN` and
 * `NEXT: Push-ups`. An exercise name that happens to contain one of those words
 * is why `UP` is anchored to the end of the string rather than matched anywhere
 * in it.
 *
 * There was a tenth entry, `SET`, with a `label.includes('SET')` branch. It also
 * never ran: the set counter goes into `subInfo` ("Set 2 of 3"), never into
 * `phase`, and the branch matched uppercase only. Removed rather than wired up,
 * because a set boundary is already shown by REST and TRANSITION.
 */
export function getPhaseColor(phase) {
  const label = String(phase ?? '');
  if (PHASE_COLORS[label]) return PHASE_COLORS[label];
  if (label.includes('DOWN')) return PHASE_COLORS.DOWN;
  if (label.includes('NEXT')) return PHASE_COLORS.NEXT;
  if (/\bUP$/.test(label)) return PHASE_COLORS.UP;
  // Anything else is an exercise name mid-set.
  return PHASE_COLORS.WORK;
}

/**
 * `#RRGGBB` → `[r, g, b]`.
 *
 * Anything unparseable falls back to WORK rather than throwing or returning
 * NaNs: this feeds a CSS custom property, and `rgba(NaN, NaN, NaN, .3)` is an
 * invalid declaration that the browser drops silently, which would take the
 * whole colour field with it.
 */
export function phaseRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  const int = parseInt(match ? match[1] : PHASE_COLORS.WORK.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** `#RRGGBB` + alpha → a CSS `rgba()` string, for glows and tinted borders. */
export function phaseAlpha(hex, alpha = 1) {
  const [r, g, b] = phaseRgb(hex);
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * The two custom properties `.workout-shell` needs. Returning them together
 * keeps the pair in step — `--phase` and `--phase-rgb` describing different
 * colours is the kind of drift that shows up as a mismatched glow.
 */
export function phaseVars(hex) {
  const colour = PHASE_COLORS[hex] ? PHASE_COLORS[hex] : hex;
  return {
    '--phase': String(colour),
    '--phase-rgb': phaseRgb(colour).join(', '),
  };
}

/**
 * Phases where the colour field should breathe. Reps are the moment the screen
 * is doing real work; REST and the setup screens stay still so the pulse means
 * something when it appears.
 *
 * Exact names are settled first, exactly as in `getPhaseColor` and for exactly
 * the same reason: a hyphen is a word boundary, so `/\bUP$/` matches `WARM-UP`
 * and the warm-up screen pulsed like a rep. Of the table's own names only `UP`
 * is a rep.
 */
export function isPhaseActive(phase) {
  const label = String(phase ?? '');
  if (PHASE_COLORS[label]) return label === 'UP';
  return label.includes('DOWN') || /\bUP$/.test(label);
}
