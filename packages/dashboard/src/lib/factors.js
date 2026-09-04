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
 */

/** Mirrors ingest's TURN_CAPABLE_TOOLS. The dashboard reads tokens.json and
 *  does not import from the ingest package, so the list is restated here. */
const TURN_CAPABLE = new Set(['claude']);

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
  if (!activeDays || !turns || !requests || !tokens) return null;

  return {
    activeDays,
    turnsPerActiveDay: turns / activeDays,
    requestsPerTurn: requests / turns,
    tokensPerRequest: tokens / requests,
    pricePerToken: cost / tokens,
    cost, turns, requests, tokens, excludedCost,
  };
}
