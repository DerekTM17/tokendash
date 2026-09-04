/**
 * Did a declared change to working practice actually pay off?
 *
 * The purpose is not to detect an improvement. It is to make a claim that
 * survives a skeptic, so this module is mostly guards: a comparison that cannot
 * be trusted is refused rather than qualified.
 */
import { factorsFor, TURN_CAPABLE } from './factors.js';
import { decompose } from './decompose.js';
import { firstCoveredDay } from './coverage.js';

const DAY = 86400000;
const shift = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY)
  .toISOString().slice(0, 10);

const DEFAULTS = { windowDays: 14, minActiveDays: 5, confoundThreshold: 0.10 };

/** The category a session falls into, per confound dimension. A lookup rather
 *  than a ternary chain so there is no unreachable fallback arm: exactly these
 *  three dimensions are ever passed, and a fourth would now throw at its call
 *  site rather than quietly bucket everything under one made-up category. */
const CATEGORY_OF = {
  model: s => s.model || 'unknown',
  project: s => s.project || 'other',
  subagent: s => (s.isSubagent ? 'subagent' : 'main'),
};

/**
 * Cost share by category, over a day window, for one dimension.
 *
 * Scoped to turn-capable tools, matching `factorsFor`. Spanning every tool made
 * this a producer/consumer contract drift inside one module: confound detection
 * ran over a cost base the decomposition never touched, so a project- or
 * token-type-mix swing driven entirely by Codex could flag `confounded` on a
 * comparison in which no Codex cost participated.
 */
function shares(sessions, from, to, dimension) {
  const categoryOf = CATEGORY_OF[dimension];
  if (!categoryOf) throw new Error(`unknown confound dimension: ${dimension}`);
  const out = {};
  let total = 0;
  for (const s of sessions) {
    if (!s.daily?.length || !TURN_CAPABLE.has(s.tool)) continue;
    const key = categoryOf(s);
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
 *  change to model selection. Scoped to turn-capable tools for the same reason
 *  `shares` is. */
function tokenTypeShares(sessions, from, to) {
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let total = 0;
  for (const s of sessions) {
    if (!s.daily?.length || !TURN_CAPABLE.has(s.tool)) continue;
    for (const [day, , , , , , cI, cO, cR, cW] of s.daily) {
      if (day < from || day > to) continue;
      out.input += cI; out.output += cO; out.cacheRead += cR; out.cacheWrite += cW;
      total += cI + cO + cR + cW;
    }
  }
  if (total) for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

/**
 * Was this specific shift pre-registered?
 *
 * The spec exempts CATEGORIES, not dimensions: `expectedShift: ['model']` used
 * to exempt every model shift, including an unexpected switch to a third model
 * the user never predicted — which is exactly the post-hoc excuse
 * pre-registration exists to rule out. A declaration names the category, either
 * qualified (`"model/claude-sonnet-5"`) or bare (`"claude-sonnet-5"`). A bare
 * `"subagent"` still works because there the dimension and the category happen
 * to be the same word; that is a coincidence, not a dimension-wide exemption.
 */
function isPreRegistered(expectedShift, dimension, category) {
  return expectedShift.includes(`${dimension}/${category}`)
    || expectedShift.includes(category);
}

function compareShares(before, after, dimension, threshold, expectedShift) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const found = [];
  for (const k of keys) {
    const delta = (after[k] || 0) - (before[k] || 0);
    if (Math.abs(delta) > threshold) {
      found.push({
        dimension, category: k, delta,
        expected: isPreRegistered(expectedShift, dimension, k),
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
  if (typeof opts.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) {
    // No default here, deliberately. `date > opts.today` and `windows.afterTo >
    // opts.today` both compare against `undefined` as false, so a missing
    // `today` would silently disable the pending AND provisional guards
    // together rather than fail loudly. Defaulting to the real current date
    // would hide the same bug and make any test that omits `today` implicitly
    // time-dependent - passing now, failing in three weeks, for a reason
    // nobody would connect to this line. A caller bug belongs at the call
    // site, not papered over here.
    throw new Error(`options.today must be an explicit 'YYYY-MM-DD' date (got ${JSON.stringify(opts.today)})`);
  }

  const n = opts.windowDays;
  const date = intervention.date;
  const windows = {
    beforeFrom: shift(date, -n), beforeTo: shift(date, -1),
    afterFrom: shift(date, 1), afterTo: shift(date, n),
  };
  const reasons = [];
  // `expect` names a factor AND a direction. Two of the five factors are levers
  // you want to go UP — the spec's own table calls ActiveDays adoption and
  // Turns/ActiveDay engagement — so hardcoding "lower is better" reports an
  // adoption rate that doubled as `not-supported`. `direction` is optional and
  // defaults to 'down' (see readInterventions), so a declaration written before
  // the field existed keeps exactly the meaning it had.
  const up = intervention.direction === 'up';
  const base = {
    windows, declared: intervention.expect, direction: up ? 'up' : 'down',
    reasons, confounds: [],
  };

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
    // Skip THIS intervention, by identity — not by date. Skipping every entry
    // sharing the date dropped the strongest confound there is: a second,
    // unrelated change made on the same day, which used to yield a clean
    // `supported`. `date + label` is the same key the frozen-results sidecar
    // uses to identify an intervention.
    if (other.date === date && other.label === intervention.label) continue;
    if (other.date >= windows.beforeFrom && other.date <= windows.afterTo) {
      confounds.push({
        dimension: 'intervention', category: other.label,
        delta: 0, expected: false,
      });
    }
  }

  const { contributions, total, orderSensitive, oracleSkipped } = decompose(before, after);
  const result = { ...base, before, after, contributions, total, confounds, orderSensitive, oracleSkipped };

  const thin = before.activeDays < opts.minActiveDays || after.activeDays < opts.minActiveDays;
  const thinReason =
    `Only ${before.activeDays} active days before and ${after.activeDays} after, ` +
    `below the ${opts.minActiveDays}-day minimum.`;
  const unexpected = confounds.filter(c => !c.expected);
  const confoundReason = () => `Something other than the intervention moved: ` +
    unexpected.map(c => `${c.dimension}/${c.category}`).join(', ') + '.';

  // Guard 2 (Maturity) is settled BEFORE power and confounds, because "this is
  // not finished" outranks every qualifier that could be applied to a finished
  // comparison. A mid-flight window used to fall into the power guard first and
  // come back `underpowered` — "watch it accumulate", which tells a reader the
  // window is THIN and never that it is still RUNNING — while `remaining` was
  // computed on a branch that could not be reached from that shape at all.
  //
  // `>=`, not `>`, per the spec's reproducibility rule: the after-window ends
  // strictly before today, so the final day is not still accumulating while
  // being measured. A partial last day flatters the result — probed at
  // afterTo === today with 1 call of an expected 10 on it, the old `>` returned
  // a final `supported` and that verdict is freezable into the permanent
  // sidecar.
  if (windows.afterTo >= opts.today) {
    const remaining = Math.round((Date.parse(windows.afterTo) - Date.parse(opts.today)) / DAY) + 1;
    reasons.push(
      `The after-window runs to ${windows.afterTo} and has ${remaining} day(s) left, ` +
      `counting today. This is not a final result.`
    );
    if (thin) reasons.push(`${thinReason} Watch it accumulate.`);
    if (unexpected.length) reasons.push(confoundReason());
    return { ...result, verdict: 'provisional' };
  }

  if (thin) {
    reasons.push(`${thinReason} Watch it accumulate.`);
    return { ...result, verdict: 'underpowered' };
  }

  if (unexpected.length) {
    reasons.push(confoundReason());
    return { ...result, verdict: 'confounded' };
  }

  const b = before[intervention.expect];
  const a = after[intervention.expect];
  const moved = up ? a > b : a < b;
  reasons.push(moved
    ? `${intervention.expect} ${up ? 'rose' : 'fell'} from ${b} to ${a}.`
    : `${intervention.expect} did not ${up ? 'rise' : 'fall'}.`);
  return { ...result, verdict: moved ? 'supported' : 'not-supported' };
}
