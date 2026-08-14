/**
 * Where the data actually starts, and what sits before it.
 *
 * The trend panels walk every bucket from the earliest session to the latest, so
 * a handful of tiny early sessions stretch the axis across weeks that are almost
 * entirely empty — six weeks of near-nothing to show $4.08, about 40% of the
 * chart width for 0.05% of spend.
 *
 * Trimming that is presentation. The reason it must be LABELLED rather than
 * silently cut is not: Claude Code's transcript retention defaulted to 30 days
 * until `cleanupPeriodDays` was raised on 2026-07-27, so every transcript older
 * than roughly late June was deleted before then. `~/.claude/history.jsonl`
 * still records 1,336 prompts across March–May — more than June and July
 * combined — whose token and cost data is permanently gone. The dashboard has
 * no way to recover it and must not present the hole as a period of no spend.
 *
 * This module answers only "where does coverage begin, and what is being cut."
 * The panels decide how to say it.
 */

/** The tool carrying the most cost. Coverage is anchored to it because it sets
 *  the scale of the chart — a $4 opencode session in April should not stretch
 *  the axis for a panel whose subject is a $7,869 Claude history. Derived rather
 *  than hardcoded so it follows the data if the mix changes. */
function dominantTool(sessions) {
  const cost = {};
  for (const s of sessions) {
    if (!s.daily?.length) continue;
    cost[s.tool] = (cost[s.tool] || 0) + s.cost;
  }
  let best = null;
  let bestCost = -Infinity;
  for (const [tool, c] of Object.entries(cost)) {
    if (c > bestCost) {
      bestCost = c;
      best = tool;
    }
  }
  return best;
}

/**
 * Returns `{ start, excluded }`, or null when there is nothing to trim.
 *
 * `start` is the first day the dominant tool has data for. `excluded` describes
 * everything strictly before it, so a caption can account for it rather than let
 * it vanish.
 */
export function dataCoverage(sessions) {
  const tool = dominantTool(sessions);
  if (!tool) return null;

  let start = null;
  for (const s of sessions) {
    if (s.tool !== tool || !s.daily?.length) continue;
    for (const [day] of s.daily) {
      if (start === null || day < start) start = day;
    }
  }
  if (start === null) return null;

  const excluded = { sessions: 0, cost: 0, tools: [], firstDay: null };
  const seenSessions = new Set();
  const seenTools = new Set();
  for (const s of sessions) {
    if (!s.daily?.length) continue;
    for (const [day, , , , , , costInput, costOutput, costCacheRead, costCacheWrite] of s.daily) {
      if (day >= start) continue;
      seenSessions.add(s.id);
      seenTools.add(s.tool);
      excluded.cost += costInput + costOutput + costCacheRead + costCacheWrite;
      if (excluded.firstDay === null || day < excluded.firstDay) excluded.firstDay = day;
    }
  }
  if (seenSessions.size === 0) return null;

  excluded.sessions = seenSessions.size;
  excluded.tools = [...seenTools].sort();
  return { start, tool, excluded };
}

/**
 * The span the record actually covers, and the cost inside it.
 *
 * Rates — burn per day, the 30-day projection — are a quotient, and both halves
 * were wrong. The denominator ran from the earliest session of any tool, so six
 * near-empty weeks of April opencode activity padded it; the numerator counted
 * that pre-boundary spend as if it belonged to the Claude window. Neither error
 * is large in dollars (the excluded spend is ~0.05% of the total) but together
 * they understate $/day by the ratio of the padded span to the real one.
 *
 * Returns `{ start, end, days, cost, excludedCost }`, or null when no session
 * carries daily data. `days` is inclusive, so a single recorded day is 1 — never
 * 0, which would divide to Infinity. `excludedCost` is kept rather than dropped
 * so a caller can account for it instead of letting it disappear.
 *
 * Note this window is only as honest as the transcripts behind it: everything
 * before `start` was deleted by Claude Code's 30-day retention default, so a
 * lifetime figure is unavailable at any price. See the module header.
 */
export function coverageWindow(sessions, coverage) {
  const start = coverage?.start ?? null;
  let first = null;
  let end = null;
  let cost = 0;
  let excludedCost = 0;

  for (const s of sessions) {
    if (!s.daily?.length) continue;
    for (const [day, , , , , , costInput, costOutput, costCacheRead, costCacheWrite] of s.daily) {
      const dayCost = costInput + costOutput + costCacheRead + costCacheWrite;
      if (first === null || day < first) first = day;
      if (end === null || day > end) end = day;
      if (start !== null && day < start) excludedCost += dayCost;
      else cost += dayCost;
    }
  }
  if (end === null) return null;

  const from = start ?? first;
  const days = Math.max(1, Math.round(
    (Date.parse(end + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000
  ) + 1);

  return { start: from, end, days, cost, excludedCost };
}

/** Drop buckets that end before coverage begins. A bucket is kept when its span
 *  reaches `start`, so the bucket containing the coverage boundary survives with
 *  whatever partial data it holds rather than being cut for starting early. */
export function trimToCoverage(buckets, coverage, granularity = 'week') {
  if (!coverage) return buckets;
  const span = granularity === 'week' ? 6 : 0;
  return buckets.filter(b => {
    const end = new Date(b.key + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + span);
    return end.toISOString().slice(0, 10) >= coverage.start;
  });
}
