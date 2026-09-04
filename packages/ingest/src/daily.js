/**
 * Per-day decomposition of a session.
 *
 * A session row carries totals stamped at `startedAt`, which is fine for a
 * sessions table and wrong for a time series: 95.2% of Claude main-thread API
 * calls live in transcripts spanning more than one calendar day (max span 19.2
 * days), so bucketing totals by start date turns a trend into a step function of
 * which long session happened to *begin* that week.
 *
 * Parsers therefore emit `dailyTokens` — one token slice per active day — and
 * the normalizer prices each slice into the `daily` array that reaches the
 * dashboard. Emitted for every session, including single-day ones where it is
 * redundant: a field present for some rows and absent for others reads as zero
 * downstream, which is how the opencode attribution bug survived months. The
 * uniform field measured at +9% on tokens.json.
 */

/** Fixed column order for the emitted `daily` array. Exported so producers and
 *  consumers cannot drift apart; the dashboard imports the same list. */
export const DAILY_COLUMNS = [
  'day',
  'calls',
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'costInput',
  'costOutput',
  'costCacheRead',
  'costCacheWrite',
  'turns',
];

const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'];

/** Accumulate one API call's usage into a Map keyed by `YYYY-MM-DD`. */
export function addDay(byDay, day, tok) {
  let slice = byDay.get(day);
  if (!slice) {
    slice = { day, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
    byDay.set(day, slice);
  }
  slice.calls += 1;
  for (const f of TOKEN_FIELDS) slice[f] += tok[f] || 0;
  return slice;
}

/** Record a user turn on `day`. Turns are counted in the transcript's line loop
 *  while calls are counted per assistant entry, so a day can legitimately hold
 *  turns with no calls (a prompt at 23:59 answered after midnight) or calls with
 *  no turns (a long tool loop). Both must produce a valid slice. */
export function addTurn(byDay, day) {
  let slice = byDay.get(day);
  if (!slice) {
    slice = { day, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
    byDay.set(day, slice);
  }
  slice.turns = (slice.turns || 0) + 1;
  return slice;
}

/** Map -> ascending array. Days are unique by construction; sorting makes the
 *  emitted order deterministic regardless of the order calls were seen. */
export function toDailyTokens(byDay) {
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
