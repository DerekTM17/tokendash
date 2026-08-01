/**
 * Buckets sessions by day or week and works out where the cost went in each.
 *
 * Share is cost-weighted: component dollars are summed across the bucket and
 * divided by the bucket total. Averaging per-session percentages instead would
 * let a $0.08 subagent session count as much as a $700 one, and spend is
 * concentrated enough here (ten sessions are ~57% of it) that the chart would
 * be meaningless.
 */

const COMPONENTS = ['input', 'output', 'cacheRead', 'cacheWrite'];

/** Sunday that starts the week containing `day`. Parsed as UTC so the key
 *  never shifts with the viewer's timezone. */
function weekStart(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function bucketKey(day, granularity) {
  return granularity === 'week' ? weekStart(day) : day;
}

function advance(key, granularity) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (granularity === 'week' ? 7 : 1));
  return d.toISOString().slice(0, 10);
}

/** A bucket nothing landed in. Nulls rather than zeros: recharts breaks a
 *  stacked Area on null, so the band shows a gap instead of diving to zero. */
function emptyBucket(key) {
  return {
    key,
    input: null, output: null, cacheRead: null, cacheWrite: null,
    total: null,
    inputPct: null, outputPct: null, cacheReadPct: null, cacheWritePct: null,
    cachePct: null,
    sessionCount: 0,
    partial: false,
    isolated: false,
  };
}

function finalize(bucket) {
  const total = COMPONENTS.reduce((sum, c) => sum + bucket[c], 0);
  const pct = value => (total ? (value / total) * 100 : 0);
  return {
    ...bucket,
    total,
    inputPct: pct(bucket.input),
    outputPct: pct(bucket.output),
    cacheReadPct: pct(bucket.cacheRead),
    cacheWritePct: pct(bucket.cacheWrite),
    cachePct: pct(bucket.cacheRead + bucket.cacheWrite),
    partial: false,
    isolated: false,
  };
}

export function bucketCostMix(
  sessions,
  granularity = 'week',
  today = new Date().toISOString().slice(0, 10),
) {
  const byKey = new Map();

  for (const s of sessions) {
    if (!s.startedAt || !s.costParts) continue;
    // Same naive-UTC day convention UsageChart uses, so the two panels agree.
    const key = bucketKey(s.startedAt.slice(0, 10), granularity);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sessionCount: 0 };
      byKey.set(key, bucket);
    }
    for (const c of COMPONENTS) bucket[c] += s.costParts[c] || 0;
    bucket.sessionCount += 1;
  }

  const keys = [...byKey.keys()].sort();
  if (keys.length === 0) return [];

  // Walk the whole span so the x-axis stays linear in time. Interior gaps get
  // an empty bucket; the ends are never padded.
  const buckets = [];
  const last = keys[keys.length - 1];
  for (let key = keys[0]; key <= last; key = advance(key, granularity)) {
    const bucket = byKey.get(key);
    buckets.push(bucket ? finalize(bucket) : emptyBucket(key));
  }

  // A bucket with no live neighbour has nothing to draw a line segment to, so
  // its area path encloses nothing and renders invisible. Flag it here — in the
  // tested module — so the renderer can draw a dot for it.
  buckets.forEach((bucket, i) => {
    if (bucket.total === null) return;
    const prev = buckets[i - 1];
    const next = buckets[i + 1];
    bucket.isolated = (!prev || prev.total === null) && (!next || next.total === null);
  });

  const todayKey = bucketKey(today, granularity);
  const current = buckets.find(b => b.key === todayKey);
  if (current) current.partial = true;

  return buckets;
}
