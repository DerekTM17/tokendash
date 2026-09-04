/**
 * The five factors of the cost identity, over a day window.
 *
 *   Cost = ActiveDays x Turns/ActiveDay x Requests/Turn x Tokens/Request x Price/Token
 *
 * Everything is day-sliced. Assigning whole sessions to their start date would
 * be much simpler and much wronger: only 85 of 2,729 sessions are multi-day, but
 * they carry 76.9% of all cost, so start-date assignment puts three quarters of
 * spend on whichever day a long session happened to begin.
 *
 * `Tokens/Request` counts ALL FOUR buckets — input, output, cacheRead,
 * cacheWrite — because the identity requires Tokens x Price/Token to equal cost,
 * and cost is priced from all four. This deliberately differs from
 * PerCallTrend's context measure, which excludes output. Both panels must name
 * which measure they show.
 *
 * `null` vs `degenerate` are different signals and must stay different:
 *   - `null` means nothing happened in this window at all (activeDays === 0).
 *   - a non-null result with `degenerate` set means activity DID happen —
 *     real calls, real cost — but one of the ratio's denominators is zero, so
 *     that ratio can't be computed. Collapsing this into `null` produced a real
 *     false negative: in the corpus snapshot, 2026-06-16 has 40 Claude calls and
 *     $19.43 of cost but 0 turns (a subagent session carries calls and never
 *     carries turns), so a window scoped to just that day used to come back
 *     null — telling a caller "nothing happened" on a day with real spend. A
 *     degenerate window is reported, not decomposable: callers must check
 *     `degenerate` before trusting `turnsPerActiveDay`/`requestsPerTurn`/
 *     `tokensPerRequest`/`pricePerToken`.
 */

/** Mirrors ingest's TURN_CAPABLE_TOOLS. The dashboard reads tokens.json and
 *  does not import from the ingest package, so the list is restated here.
 *
 *  Exported because it is a contract, not an implementation detail: anything
 *  computed alongside `factorsFor` — the confound shares in `intervention.js`,
 *  the half-split in `DriverDecomposition` — has to scope itself to the same
 *  population, or it describes a cost base the decomposition never touched. */
export const TURN_CAPABLE = new Set(['claude']);

/** Multiplication order matters for sequential attribution, so it is fixed. */
export const FACTOR_KEYS = [
  'activeDays',
  'turnsPerActiveDay',
  'requestsPerTurn',
  'tokensPerRequest',
  'pricePerToken',
];

export function factorsFor(sessions, from, to) {
  const days = new Set();
  let turns = 0, requests = 0, tokens = 0, cost = 0, excludedCost = 0;

  for (const s of sessions) {
    if (!s.daily?.length) continue;
    const capable = TURN_CAPABLE.has(s.tool);
    for (const [day, calls, input, output, cacheRead, cacheWrite,
      cI, cO, cR, cW, dayTurns] of s.daily) {
      if (day < from || day > to) continue;
      const dayCost = cI + cO + cR + cW;
      if (!capable) {
        excludedCost += dayCost;
        continue;
      }
      if (calls > 0) days.add(day);
      requests += calls;
      turns += dayTurns || 0;
      tokens += input + output + cacheRead + cacheWrite;
      cost += dayCost;
    }
  }

  const activeDays = days.size;
  // Only "nothing happened" earns null. Every other zero-denominator case below
  // is reported as `degenerate` on a real object instead — see the docblock.
  if (!activeDays) return null;

  // requests === 0 can't happen once activeDays > 0 (every day added to the
  // Set had calls > 0, and requests accumulates calls unconditionally), so this
  // guard is defensive dead code, not a live path — it exists only to return
  // null instead of NaN/Infinity if that invariant is ever broken upstream.
  const degenerate = turns === 0 ? 'no-turns' : tokens === 0 ? 'no-tokens' : null;

  return {
    activeDays,
    turnsPerActiveDay: turns === 0 ? 0 : turns / activeDays,
    requestsPerTurn: turns === 0 ? null : requests / turns,
    tokensPerRequest: requests === 0 ? null : tokens / requests,
    pricePerToken: tokens === 0 ? null : cost / tokens,
    degenerate,
    cost, turns, requests, tokens, excludedCost,
  };
}
