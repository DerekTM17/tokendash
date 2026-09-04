/**
 * Buckets sessions by day or week and works out the context and cost of an
 * average API call in each.
 *
 * This measures the driver rather than its shadow. Cache share (the Phase A
 * panel) moves for reasons unrelated to context discipline — delegating more is
 * a *good* habit that *raises* cache-write share, because every subagent starts
 * a fresh context and pays writes instead of riding long reads. Context per call
 * is the quantity that actually sets the bill.
 *
 * Two structural rules, both learned the hard way:
 *
 * 1. Buckets are built from `session.daily`, never from `startedAt`. 95.2% of
 *    Claude main-thread calls live in transcripts spanning more than one
 *    calendar day (max 19.2 days), so start-stamping turns a trend into a step
 *    function of which long session happened to *begin* that week.
 *
 * 2. The plotted value is a CALL-weighted mean — sum(context) / sum(calls)
 *    across the bucket — never a mean of per-session averages. Besides the
 *    cost-weighting argument from Phase A, this is the only form invariant to
 *    the `__model` row splitting the parsers do: a session using two models
 *    becomes two rows, and both numerator and denominator partition exactly
 *    across them.
 */

/** Main and subagent are kept apart on purpose. Blended, a week where you
 *  delegated more pulls the line down and reads as improvement while main-thread
 *  context sat flat — the exact confound this panel exists to remove. Claude
 *  main context per call runs ~6x its subagents'. */
export const SERIES = [
  { key: 'claudeMain', tool: 'claude', subagent: false, label: 'Claude main' },
  { key: 'claudeSub', tool: 'claude', subagent: true, label: 'Claude subagent' },
  { key: 'codexMain', tool: 'codex', subagent: false, label: 'Codex main' },
  { key: 'codexSub', tool: 'codex', subagent: true, label: 'Codex subagent' },
];

function seriesKeyFor(session) {
  const match = SERIES.find(s => s.tool === session.tool && s.subagent === !!session.isSubagent);
  return match ? match.key : null;
}

/** Sunday that starts the week containing `day`. Parsed as UTC so the key never
 *  shifts with the viewer's timezone. Matches costMix.js so the panels align. */
function weekStart(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** Exported so PerCallTrend can map an intervention's calendar date onto the
 *  same bucket key the series actually uses — recomputing it in the component
 *  would drift from this at week granularity. */
export function bucketKey(day, granularity) {
  return granularity === 'week' ? weekStart(day) : day;
}

function advance(key, granularity) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (granularity === 'week' ? 7 : 1));
  return d.toISOString().slice(0, 10);
}

function emptySeries() {
  return Object.fromEntries(SERIES.map(s => [s.key, null]));
}

export function bucketPerCall(
  sessions,
  granularity = 'week',
  today = new Date().toISOString().slice(0, 10),
) {
  const byKey = new Map();

  for (const session of sessions) {
    if (!session.daily?.length) continue;
    const seriesKey = seriesKeyFor(session);
    // opencode has apiCalls but is not plotted: 0.1% of spend across four
    // scattered points. It is deliberately absent from SERIES rather than
    // silently folded into a tool it isn't.
    if (!seriesKey) continue;

    for (const [day, calls, input, , cacheRead, cacheWrite,
      costInput, costOutput, costCacheRead, costCacheWrite] of session.daily) {
      if (!calls) continue;
      const key = bucketKey(day, granularity);
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { key, totals: {} };
        byKey.set(key, bucket);
      }
      const acc = bucket.totals[seriesKey]
        || (bucket.totals[seriesKey] = { calls: 0, context: 0, cost: 0 });
      acc.calls += calls;
      // Context is the prompt the model was handed: fresh input, plus what was
      // read from cache, plus what was written to it. Output is excluded — it is
      // what came back, not what was carried.
      acc.context += input + cacheRead + cacheWrite;
      acc.cost += costInput + costOutput + costCacheRead + costCacheWrite;
    }
  }

  const keys = [...byKey.keys()].sort();
  if (keys.length === 0) return [];

  // Walk the whole span so the x-axis stays linear in time. Interior gaps get an
  // empty bucket; the ends are never padded.
  const buckets = [];
  const last = keys[keys.length - 1];
  for (let key = keys[0]; key <= last; key = advance(key, granularity)) {
    const raw = byKey.get(key);
    const series = emptySeries();
    if (raw) {
      for (const [seriesKey, acc] of Object.entries(raw.totals)) {
        // A series with no calls in this bucket carries null, not 0, and above
        // all must not divide. costMix.js:55 documents why zero is the wrong
        // answer: it renders as a hard dive to the floor, the most flattering
        // value on the chart for what is actually a data gap.
        if (!acc.calls) continue;
        series[seriesKey] = {
          calls: acc.calls,
          context: acc.context,
          cost: acc.cost,
          contextPerCall: acc.context / acc.calls,
          costPerCall: acc.cost / acc.calls,
          isolated: false,
        };
      }
    }
    buckets.push({ key, series, partial: false });
  }

  // A point with no live neighbour in its own series has nothing to draw a line
  // segment to, so it renders invisible. Flag it here — in the tested module —
  // so the renderer can draw a dot for it. Both Codex series are mostly this:
  // Codex main sessions exist on six distinct days in all of history.
  buckets.forEach((bucket, i) => {
    for (const { key } of SERIES) {
      const point = bucket.series[key];
      if (!point) continue;
      const prev = buckets[i - 1]?.series[key];
      const next = buckets[i + 1]?.series[key];
      point.isolated = !prev && !next;
    }
  });

  const todayKey = bucketKey(today, granularity);
  const current = buckets.find(b => b.key === todayKey);
  if (current) current.partial = true;

  return buckets;
}

/** Flatten to the row shape recharts wants: one numeric field per series for
 *  the chosen metric, null where the series has no data in that bucket. */
export function toChartRows(buckets, metric) {
  const field = metric === 'cost' ? 'costPerCall' : 'contextPerCall';
  return buckets.map(bucket => {
    const row = { key: bucket.key, partial: bucket.partial };
    for (const { key } of SERIES) {
      const point = bucket.series[key];
      row[key] = point ? point[field] : null;
      row[`${key}__isolated`] = !!point?.isolated;
      row[`${key}__calls`] = point ? point.calls : 0;
    }
    return row;
  });
}
