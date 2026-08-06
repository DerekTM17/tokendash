import { describe, it, expect } from 'vitest';
import { bucketPerCall, toChartRows, SERIES } from '../src/lib/perCall';

/** One `daily` row: [day, calls, input, output, cacheRead, cacheWrite,
 *  costInput, costOutput, costCacheRead, costCacheWrite]. */
function dayRow(day, calls, context, cost = 0) {
  // Put all context in cacheRead; the module sums input + cacheRead + cacheWrite
  // and must ignore output, which is asserted separately below.
  return [day, calls, 0, 999, context, 0, 0, 0, cost, 0];
}

function session(tool, isSubagent, daily) {
  return { tool, isSubagent, daily };
}

describe('bucketPerCall', () => {
  it('returns an empty array for no sessions', () => {
    expect(bucketPerCall([], 'week', '2026-07-31')).toEqual([]);
  });

  it('skips sessions with no daily rows and tools it does not plot', () => {
    const sessions = [
      session('claude', false, []),
      session('claude', false, undefined),
      // opencode is deliberately absent from SERIES rather than folded into a
      // tool it is not.
      session('opencode', false, [dayRow('2026-07-26', 10, 1000)]),
    ];
    expect(bucketPerCall(sessions, 'week', '2026-07-31')).toEqual([]);
  });

  it('weights the mean by calls, not by session', () => {
    // One big session at 500k context and one tiny one at 10k. A mean of
    // per-session averages gives 255k; call-weighting gives ~495k, which is what
    // the bill actually reflects.
    const sessions = [
      session('claude', false, [dayRow('2026-07-26', 100, 100 * 500_000)]),
      session('claude', false, [dayRow('2026-07-27', 1, 10_000)]),
    ];

    const [week] = bucketPerCall(sessions, 'week', '2026-07-31');

    expect(week.series.claudeMain.calls).toBe(101);
    expect(week.series.claudeMain.contextPerCall).toBeCloseTo(50_010_000 / 101, 3);
    expect(week.series.claudeMain.contextPerCall).toBeGreaterThan(490_000);
  });

  it('is invariant to a session being split across model rows', () => {
    // The parsers emit one row per model, so a two-model session becomes two
    // rows. Both numerator and denominator partition exactly, so a call-weighted
    // mean is unchanged — the reason this form is structurally required.
    const whole = [session('claude', false, [dayRow('2026-07-26', 10, 1_000_000)])];
    const split = [
      session('claude', false, [dayRow('2026-07-26', 4, 400_000)]),
      session('claude', false, [dayRow('2026-07-26', 6, 600_000)]),
    ];

    const a = bucketPerCall(whole, 'week', '2026-07-31')[0].series.claudeMain;
    const b = bucketPerCall(split, 'week', '2026-07-31')[0].series.claudeMain;

    expect(b.contextPerCall).toBeCloseTo(a.contextPerCall, 6);
    expect(b.calls).toBe(a.calls);
  });

  it('keeps main and subagent apart', () => {
    const sessions = [
      session('claude', false, [dayRow('2026-07-26', 10, 10 * 400_000)]),
      session('claude', true, [dayRow('2026-07-26', 90, 90 * 60_000)]),
    ];

    const [week] = bucketPerCall(sessions, 'week', '2026-07-31');

    expect(week.series.claudeMain.contextPerCall).toBeCloseTo(400_000, 3);
    expect(week.series.claudeSub.contextPerCall).toBeCloseTo(60_000, 3);
    // Blended they would be ~94k, which is the confound the split removes.
  });

  it('splits a multi-day session across the buckets it spans', () => {
    // Without this, 95.2% of real main-thread calls land in whichever bucket
    // their transcript began in.
    const sessions = [
      session('claude', false, [
        dayRow('2026-07-24', 10, 10 * 500_000),
        dayRow('2026-07-27', 10, 10 * 100_000),
      ]),
    ];

    const weeks = bucketPerCall(sessions, 'week', '2026-07-31');

    expect(weeks).toHaveLength(2);
    expect(weeks[0].key).toBe('2026-07-19');
    expect(weeks[0].series.claudeMain.contextPerCall).toBeCloseTo(500_000, 3);
    expect(weeks[1].key).toBe('2026-07-26');
    expect(weeks[1].series.claudeMain.contextPerCall).toBeCloseTo(100_000, 3);
  });

  it('excludes output tokens from context', () => {
    // dayRow puts 999 output on every row; context must not see it.
    const sessions = [session('claude', false, [dayRow('2026-07-26', 1, 1000)])];
    const [week] = bucketPerCall(sessions, 'week', '2026-07-31');
    expect(week.series.claudeMain.contextPerCall).toBe(1000);
  });

  it('carries null for a series with no calls, and never divides by zero', () => {
    const sessions = [
      session('claude', false, [dayRow('2026-07-26', 5, 5 * 200_000)]),
      // A day row that exists but recorded no calls must not produce 0/0.
      session('codex', false, [dayRow('2026-07-26', 0, 0)]),
    ];

    const [week] = bucketPerCall(sessions, 'week', '2026-07-31');

    expect(week.series.claudeMain).not.toBeNull();
    expect(week.series.codexMain).toBeNull();
    expect(week.series.claudeSub).toBeNull();
    for (const { key } of SERIES) {
      const point = week.series[key];
      if (point) expect(Number.isFinite(point.contextPerCall)).toBe(true);
    }
  });

  it('leaves interior gaps as null buckets rather than closing them', () => {
    const sessions = [
      session('claude', false, [dayRow('2026-07-12', 5, 5 * 300_000)]),
      session('claude', false, [dayRow('2026-07-26', 5, 5 * 100_000)]),
    ];

    const weeks = bucketPerCall(sessions, 'week', '2026-07-31');

    expect(weeks.map(w => w.key)).toEqual(['2026-07-12', '2026-07-19', '2026-07-26']);
    expect(weeks[1].series.claudeMain).toBeNull();
  });

  it('flags a point with no live neighbour in its own series as isolated', () => {
    // Both Codex series are mostly this: Codex main sessions exist on six
    // distinct days in all of history.
    const sessions = [
      session('claude', false, [
        dayRow('2026-07-12', 5, 5 * 300_000),
        dayRow('2026-07-19', 5, 5 * 300_000),
        dayRow('2026-07-26', 5, 5 * 300_000),
      ]),
      session('codex', false, [dayRow('2026-07-19', 3, 3 * 120_000)]),
    ];

    const weeks = bucketPerCall(sessions, 'week', '2026-07-31');

    expect(weeks[1].series.codexMain.isolated).toBe(true);
    // The claude series runs across all three, so none of its points are lone.
    expect(weeks.every(w => w.series.claudeMain.isolated === false)).toBe(true);
  });

  it('marks only the bucket containing today as partial', () => {
    const sessions = [
      session('claude', false, [
        dayRow('2026-07-19', 5, 5 * 300_000),
        dayRow('2026-07-27', 5, 5 * 100_000),
      ]),
    ];

    const weeks = bucketPerCall(sessions, 'week', '2026-07-31');

    expect(weeks[0].partial).toBe(false);
    expect(weeks[1].partial).toBe(true);
  });

  it('computes cost per call from the four cost columns', () => {
    const sessions = [session('claude', false, [dayRow('2026-07-26', 4, 4 * 100_000, 2)])];
    const [week] = bucketPerCall(sessions, 'week', '2026-07-31');
    expect(week.series.claudeMain.costPerCall).toBeCloseTo(0.5, 6);
  });

  it('buckets days as days when granularity is day', () => {
    const sessions = [
      session('claude', false, [
        dayRow('2026-07-26', 2, 2 * 100_000),
        dayRow('2026-07-27', 2, 2 * 200_000),
      ]),
    ];

    const days = bucketPerCall(sessions, 'day', '2026-07-31');

    expect(days.map(d => d.key)).toEqual(['2026-07-26', '2026-07-27']);
    expect(days[1].series.claudeMain.contextPerCall).toBeCloseTo(200_000, 3);
  });
});

describe('toChartRows', () => {
  const sessions = [
    session('claude', false, [dayRow('2026-07-26', 4, 4 * 250_000, 1)]),
    session('codex', true, [dayRow('2026-07-26', 2, 2 * 90_000, 0.5)]),
  ];

  it('flattens to one numeric field per series for the chosen metric', () => {
    const buckets = bucketPerCall(sessions, 'week', '2026-07-31');
    const [row] = toChartRows(buckets, 'context');

    expect(row.claudeMain).toBeCloseTo(250_000, 3);
    expect(row.codexSub).toBeCloseTo(90_000, 3);
    expect(row.claudeSub).toBeNull();
    expect(row.codexMain).toBeNull();
    expect(row.claudeMain__calls).toBe(4);
  });

  it('switches the plotted field with the metric', () => {
    const buckets = bucketPerCall(sessions, 'week', '2026-07-31');
    const [row] = toChartRows(buckets, 'cost');

    expect(row.claudeMain).toBeCloseTo(0.25, 6);
    expect(row.codexSub).toBeCloseTo(0.25, 6);
  });
});
