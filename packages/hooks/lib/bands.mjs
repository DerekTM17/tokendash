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
//
// ARM and CEILING must stay well separated. At ARM >= CEILING the arm band
// collapses (bandOf only ever returns the ceiling band), so the soft "judge
// whether the topic changed" branch in nextState/directive.mjs never runs and
// every nudge becomes the unconditional ceiling directive — the entire point
// of having two bands is lost.
//
// 2026-08: retuned from 275k/300k to 325k/450k for gate headroom, not because
// the break-even arithmetic changed. The backtest gate reads a live, growing
// corpus (~/.claude/projects/), so a firing rate measured against today's
// session mix drifts as more sessions accumulate. 275k/300k passed at 33.8%
// when chosen and had drifted to 36.0% (target <=35%) within hours, and
// values just below the old 300k ceiling passed with only ~0.3pp of margin.
// 325k/450k measured 28.0% firing with ~7pp of headroom, and widens the arm
// band from 25k to 125k so the soft-judgment branch has room to matter.

import { numEnv } from './env.mjs';

export const ARM_TOKENS = numEnv('CTX_ARM_TOKENS', 325_000);
export const CEILING_TOKENS = numEnv('CTX_CEILING_TOKENS', 450_000);
export const MIN_PROMPT_GAP = numEnv('CTX_MIN_PROMPT_GAP', 10);
export const DROP_RATIO = numEnv('CTX_DROP_RATIO', 0.6);

export const EMPTY_STATE = Object.freeze({
  highWater: 0,
  // Frozen too: readState returns this exact singleton on every miss, and a
  // caller pushing directly into one of these arrays (rather than spreading
  // first, as every consumer does today) would silently poison it for every
  // subsequent miss across the process's lifetime.
  firedBands: Object.freeze([]),
  lastFiredPrompt: -Infinity,
  verdicts: Object.freeze([]),
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

  // A large drop means compaction or tool-result eviction. Reset the high-water
  // mark so it tracks the live context again, but KEEP firedBands: a band fires
  // at most once for the lifetime of a session, never once per compaction epoch.
  //
  // Clearing firedBands here was the original design, on the reasoning that
  // post-compaction context is new context and deserves a fresh warning. The
  // backtest over 74 real sessions falsified it: each epoch granted a fresh
  // arm+ceiling pair, so repeatedly-compacting sessions earned up to 7 nudges
  // and the corpus averaged 2.88 per firing session against a budget of 2.0.
  // Keeping the bands yields 1.88, max 2. The budget makes this forced, not a
  // preference — the 17 non-compacting firing sessions already consume 31 of
  // the 50 nudges the budget allows, leaving 19 for the 8 that compact, so
  // nudging any of them a third time is arithmetically impossible.
  //
  // KNOWN COST: the mechanism goes quiet on repeatedly-compacting sessions,
  // which are the longest and most expensive ones. Accepted because those 8
  // sessions went on to compact 2-4 more times AFTER their first nudge, so
  // further nudges would have been noise rather than help. Phase 2's PostCompact
  // hook is the principled fix — it can re-arm on a real compaction event rather
  // than inferring one from a token drop.
  if (s.highWater > 0 && ctx < s.highWater * DROP_RATIO) {
    s.highWater = 0;
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
