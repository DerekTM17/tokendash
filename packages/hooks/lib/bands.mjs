// Pure threshold logic for the session boundary detector. No I/O, no clock.
//
// Bands key off a monotonic HIGH-WATER MARK, not instantaneous context.
// Measured on real sessions, context is not monotonic — one ran
// 999k -> 356k -> 948k -> 71k -> 999k, so banding on instantaneous context
// re-fires on every swing.
//
// There are exactly TWO bands: arm and ceiling. An earlier design added a mid
// band and then one band per 100k above the ceiling, which meant a session
// peaking near 1M crossed nine bands and earned nine nudges. High-water marking
// capped that at one nudge per band, but with ~10 bands the cap bought little:
// the backtest over 74 real sessions measured 7.52 nudges per firing session
// against a budget of 2.0, and no ARM_TOKENS value fixed it because ARM only
// governs the first two bands of the ladder.
//
// Two terminal bands make the budget structural rather than dependent on
// MIN_PROMPT_GAP suppression: a session can be nudged at most once for arming
// and once for hitting the ceiling, no matter how large it grows.

const num = (name, fallback) => Number(process.env[name] || fallback);

export const ARM_TOKENS = num('CTX_ARM_TOKENS', 275_000);
export const CEILING_TOKENS = num('CTX_CEILING_TOKENS', 300_000);
export const MIN_PROMPT_GAP = num('CTX_MIN_PROMPT_GAP', 10);
export const DROP_RATIO = num('CTX_DROP_RATIO', 0.6);

export const EMPTY_STATE = Object.freeze({
  highWater: 0,
  firedBands: [],
  lastFiredPrompt: -Infinity,
  verdicts: [],
  promptCount: 0,
});

/**
 * Band id for a context size, or null below ARM.
 *
 * Two bands only, and the ceiling band is terminal — there is nothing above it,
 * so growth past CEILING_TOKENS can never earn a third nudge. Ids are the
 * thresholds in thousands, so they stay plain numbers for state.mjs to persist.
 */
export function bandOf(tokens) {
  if (!Number.isFinite(tokens) || tokens < ARM_TOKENS) return null;
  if (tokens < CEILING_TOKENS) return Math.floor(ARM_TOKENS / 1000);
  return Math.floor(CEILING_TOKENS / 1000);
}

/**
 * Advance detector state by one prompt.
 * Returns { state, fire } where fire is false | 'arm' | 'ceiling'.
 *
 * A band is recorded in firedBands ONLY when it actually fires. A suppressed
 * band stays unrecorded so it can fire later once the gap has elapsed.
 */
export function nextState(prev, ctx, promptIndex) {
  const s = {
    highWater: prev.highWater ?? 0,
    firedBands: [...(prev.firedBands ?? [])],
    lastFiredPrompt: prev.lastFiredPrompt ?? -Infinity,
    verdicts: [...(prev.verdicts ?? [])],
    promptCount: prev.promptCount ?? 0, // owned by the caller; preserved, not advanced here
  };

  // A large drop means compaction or tool-result eviction: the old bands no
  // longer describe the live context, so let them fire again.
  if (s.highWater > 0 && ctx < s.highWater * DROP_RATIO) {
    s.highWater = 0;
    s.firedBands = [];
  }

  s.highWater = Math.max(s.highWater, ctx);

  const band = bandOf(s.highWater);
  if (band === null) return { state: s, fire: false };
  if (s.firedBands.includes(band)) return { state: s, fire: false };
  if (promptIndex - s.lastFiredPrompt < MIN_PROMPT_GAP) return { state: s, fire: false };

  s.firedBands.push(band);
  s.lastFiredPrompt = promptIndex;
  return { state: s, fire: s.highWater >= CEILING_TOKENS ? 'ceiling' : 'arm' };
}
