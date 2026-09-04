/**
 * Did a declared change to working practice actually pay off?
 *
 * The purpose is not to detect an improvement. It is to make a claim that
 * survives a skeptic, so this module is mostly guards: a comparison that cannot
 * be trusted is refused rather than qualified.
 */
import { factorsFor } from './factors.js';
import { decompose } from './decompose.js';
import { firstCoveredDay } from './coverage.js';

const DAY = 86400000;
const shift = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY)
  .toISOString().slice(0, 10);

const DEFAULTS = { windowDays: 14, minActiveDays: 5, confoundThreshold: 0.10 };

/** Cost share by category, over a day window, for one dimension. */
function shares(sessions, from, to, dimension) {
  const out = {};
  let total = 0;
  for (const s of sessions) {
    if (!s.daily?.length) continue;
    const key = dimension === 'model' ? (s.model || 'unknown')
      : dimension === 'project' ? (s.project || 'other')
      : dimension === 'subagent' ? (s.isSubagent ? 'subagent' : 'main')
      : 'other';
    for (const [day, , , , , , cI, cO, cR, cW] of s.daily) {
      if (day < from || day > to) continue;
      const c = cI + cO + cR + cW;
      out[key] = (out[key] || 0) + c;
      total += c;
    }
  }
  if (total) for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

/** Token-type cost share. The blended Price/Token moves whenever the
 *  cacheRead:input mix moves, so a cache-TTL change registers there as well as
 *  in Tokens/Request. Without this dimension the panel would credit a mix
 *  change to model selection. */
function tokenTypeShares(sessions, from, to) {
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let total = 0;
  for (const s of sessions) {
    if (!s.daily?.length) continue;
    for (const [day, , , , , , cI, cO, cR, cW] of s.daily) {
      if (day < from || day > to) continue;
      out.input += cI; out.output += cO; out.cacheRead += cR; out.cacheWrite += cW;
      total += cI + cO + cR + cW;
    }
  }
  if (total) for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

function compareShares(before, after, dimension, threshold, expectedShift) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const found = [];
  for (const k of keys) {
    const delta = (after[k] || 0) - (before[k] || 0);
    if (Math.abs(delta) > threshold) {
      found.push({
        dimension, category: k, delta,
        expected: expectedShift.includes(dimension),
      });
    }
  }
  return found;
}

export function evaluate(sessions, intervention, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (opts.windowDays % 7 !== 0) {
    // Mean cost per active day runs $130-141 Mon-Thu against $77 Sun and $85
    // Sat, a 1.8x spread. A window that is not whole weeks compares different
    // day-of-week mixes and manufactures a difference.
    throw new Error(`windowDays must be a multiple of 7 (got ${opts.windowDays})`);
  }

  const n = opts.windowDays;
  const date = intervention.date;
  const windows = {
    beforeFrom: shift(date, -n), beforeTo: shift(date, -1),
    afterFrom: shift(date, 1), afterTo: shift(date, n),
  };
  const reasons = [];
  const base = { windows, declared: intervention.expect, reasons, confounds: [] };

  if (date > opts.today) {
    return { ...base, verdict: 'pending', reasons: ['The intervention date is in the future.'] };
  }

  const floor = firstCoveredDay(sessions);
  if (!floor || windows.beforeFrom < floor) {
    reasons.push(
      `The before-window starts ${windows.beforeFrom}, but coverage begins ${floor || 'nowhere'}. ` +
      `Transcripts before that were deleted by the 30-day retention sweep, so the baseline ` +
      `would read artificially cheap and manufacture an improvement.`
    );
    return { ...base, verdict: 'refused' };
  }

  const before = factorsFor(sessions, windows.beforeFrom, windows.beforeTo);
  const after = factorsFor(sessions, windows.afterFrom, windows.afterTo);
  if (!before || !after) {
    reasons.push('One side of the comparison has no active days, so there is nothing to compare.');
    return { ...base, verdict: 'refused' };
  }
  // A window can have real calls and real cost yet no recorded user turn —
  // subagent-only activity does exactly that, and it occurs on 1 of 79 Claude
  // days in the reference corpus (2026-06-16: 40 calls, $19.43). `factorsFor`
  // reports that as `degenerate` rather than null precisely so this message can
  // be accurate; saying "no active days" about a day with 40 calls on it is the
  // same class of false statement the coverage guard exists to prevent.
  if (before.degenerate || after.degenerate) {
    reasons.push(
      `One side has activity but no usable denominator (${before.degenerate || after.degenerate}), ` +
      `so the per-turn factors cannot be computed for it.`
    );
    return { ...base, before, after, verdict: 'refused' };
  }

  const confounds = [
    ...compareShares(
      shares(sessions, windows.beforeFrom, windows.beforeTo, 'model'),
      shares(sessions, windows.afterFrom, windows.afterTo, 'model'),
      'model', opts.confoundThreshold, intervention.expectedShift || []),
    ...compareShares(
      shares(sessions, windows.beforeFrom, windows.beforeTo, 'project'),
      shares(sessions, windows.afterFrom, windows.afterTo, 'project'),
      'project', opts.confoundThreshold, intervention.expectedShift || []),
    ...compareShares(
      shares(sessions, windows.beforeFrom, windows.beforeTo, 'subagent'),
      shares(sessions, windows.afterFrom, windows.afterTo, 'subagent'),
      'subagent', opts.confoundThreshold, intervention.expectedShift || []),
    ...compareShares(
      tokenTypeShares(sessions, windows.beforeFrom, windows.beforeTo),
      tokenTypeShares(sessions, windows.afterFrom, windows.afterTo),
      'tokenType', opts.confoundThreshold, intervention.expectedShift || []),
  ];

  for (const other of opts.others || []) {
    if (other.date === date) continue;
    if (other.date >= windows.beforeFrom && other.date <= windows.afterTo) {
      confounds.push({
        dimension: 'intervention', category: other.label,
        delta: 0, expected: false,
      });
    }
  }

  const { contributions, total, orderSensitive, oracleSkipped } = decompose(before, after);
  const result = { ...base, before, after, contributions, total, confounds, orderSensitive, oracleSkipped };

  if (before.activeDays < opts.minActiveDays || after.activeDays < opts.minActiveDays) {
    reasons.push(
      `Only ${before.activeDays} active days before and ${after.activeDays} after, ` +
      `below the ${opts.minActiveDays}-day minimum. Watch it accumulate.`
    );
    return { ...result, verdict: 'underpowered' };
  }

  const unexpected = confounds.filter(c => !c.expected);
  if (unexpected.length) {
    reasons.push(
      `Something other than the intervention moved: ` +
      unexpected.map(c => `${c.dimension}/${c.category}`).join(', ') + '.'
    );
    return { ...result, verdict: 'confounded' };
  }

  if (windows.afterTo > opts.today) {
    const remaining = Math.round((Date.parse(windows.afterTo) - Date.parse(opts.today)) / DAY);
    reasons.push(`The after-window has ${remaining} day(s) left to run.`);
    return { ...result, verdict: 'provisional' };
  }

  const moved = after[intervention.expect] < before[intervention.expect];
  reasons.push(moved
    ? `${intervention.expect} fell from ${before[intervention.expect]} to ${after[intervention.expect]}.`
    : `${intervention.expect} did not fall.`);
  return { ...result, verdict: moved ? 'supported' : 'not-supported' };
}
