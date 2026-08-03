// Pure threshold logic for the session boundary detector. No I/O, no clock.
//
// Bands key off a monotonic HIGH-WATER MARK, not instantaneous context.
// Measured on real sessions, context is not monotonic — one ran
// 999k -> 356k -> 948k -> 71k -> 999k. Banding on instantaneous context
// produced 8.1 nudges per firing session; high-water caps it at one per band.

const num = (name, fallback) => Number(process.env[name] || fallback);

export const ARM_TOKENS = num('CTX_ARM_TOKENS', 200_000);
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

/** Band id for a context size, or null below ARM. */
export function bandOf(tokens) {
  if (!Number.isFinite(tokens) || tokens < ARM_TOKENS) return null;
  if (tokens < (ARM_TOKENS + CEILING_TOKENS) / 2) return Math.floor(ARM_TOKENS / 1000);
  if (tokens < CEILING_TOKENS) return Math.floor(((ARM_TOKENS + CEILING_TOKENS) / 2) / 1000);
  return Math.floor(tokens / 100_000) * 100;
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
