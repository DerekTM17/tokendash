import { describe, it, expect } from 'vitest';
import { bucketCostMix } from '../src/lib/costMix';

/** Build a session with a cost split, defaulting the parts we don't care about. */
function session(startedAt, parts) {
  return {
    startedAt,
    costParts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...parts },
  };
}

describe('bucketCostMix', () => {
  it('returns an empty array for no sessions', () => {
    expect(bucketCostMix([], 'week', '2026-07-31')).toEqual([]);
  });

  it('skips sessions missing startedAt or costParts', () => {
    const sessions = [
      { startedAt: null, costParts: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { startedAt: '2026-07-26T10:00:00Z', costParts: null },
    ];
    expect(bucketCostMix(sessions, 'week', '2026-07-31')).toEqual([]);
  });

  it('weights share by dollars, not by session count', () => {
    // One $700 session at ~94% cache read, plus 100 tiny sessions at 20%.
    // Averaging per-session percentages would yield ~21%; cost-weighting gives ~93%.
    const sessions = [session('2026-07-26T10:00:00Z', { cacheRead: 660, output: 40 })];
    for (let i = 0; i < 100; i++) {
      sessions.push(session('2026-07-27T10:00:00Z', { cacheRead: 0.02, output: 0.08 }));
    }

    const [week] = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(week.total).toBeCloseTo(710, 5);
    expect(week.cacheRead).toBeCloseTo(662, 5);
    expect(week.cacheReadPct).toBeGreaterThan(90);
    expect(week.sessionCount).toBe(101);
  });

  it('buckets weeks on Sunday boundaries', () => {
    // 2026-07-25 is a Saturday (week of the 19th); 2026-07-26 is a Sunday.
    const sessions = [
      session('2026-07-25T23:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T01:00:00Z', { cacheRead: 20 }),
    ];

    const weeks = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(weeks.map(w => w.key)).toEqual(['2026-07-19', '2026-07-26']);
    expect(weeks[0].cacheRead).toBe(10);
    expect(weeks[1].cacheRead).toBe(20);
  });

  it('buckets by day when asked', () => {
    const sessions = [
      session('2026-07-25T23:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T01:00:00Z', { cacheRead: 20 }),
    ];

    const days = bucketCostMix(sessions, 'day', '2026-07-31');

    expect(days.map(d => d.key)).toEqual(['2026-07-25', '2026-07-26']);
  });

  it('fills interior gaps with nulls and does not pad the ends', () => {
    // Weeks of 07-05 and 07-26, with 07-12 and 07-19 empty between them.
    const sessions = [
      session('2026-07-05T10:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T10:00:00Z', { cacheRead: 20 }),
    ];

    const weeks = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(weeks.map(w => w.key)).toEqual(['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26']);
    expect(weeks[1].total).toBeNull();
    expect(weeks[1].cacheReadPct).toBeNull();
    expect(weeks[1].sessionCount).toBe(0);
    expect(weeks[0].total).toBe(10);
    expect(weeks[3].total).toBe(20);
  });

  it('percentages within a bucket sum to 100', () => {
    const sessions = [
      session('2026-07-26T10:00:00Z', { input: 1, output: 2, cacheRead: 6, cacheWrite: 1 }),
    ];

    const [week] = bucketCostMix(sessions, 'week', '2026-07-31');

    const sum = week.inputPct + week.outputPct + week.cacheReadPct + week.cacheWritePct;
    expect(sum).toBeCloseTo(100, 6);
    expect(week.cachePct).toBeCloseTo(70, 6);
  });

  it('flags isolated buckets so the renderer can dot them', () => {
    // 07-05 stands alone (07-12 empty); 07-19 and 07-26 are adjacent.
    const sessions = [
      session('2026-07-05T10:00:00Z', { cacheRead: 10 }),
      session('2026-07-19T10:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T10:00:00Z', { cacheRead: 10 }),
    ];

    const weeks = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(weeks.map(w => w.key)).toEqual(['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26']);
    expect(weeks[0].isolated).toBe(true);   // empty on the right, nothing on the left
    expect(weeks[2].isolated).toBe(false);  // 07-26 is a live neighbour
    expect(weeks[3].isolated).toBe(false);
  });

  it('treats a lone bucket as isolated', () => {
    const sessions = [session('2026-07-26T10:00:00Z', { cacheRead: 10 })];
    expect(bucketCostMix(sessions, 'week', '2026-07-31')[0].isolated).toBe(true);
  });

  it('breaks the band instead of diving to zero when a bucket has sessions but $0 total', () => {
    // A free or local model: sessions happened, but every cost part is 0.
    // total must come back null (not 0) so the Area breaks the band rather
    // than rendering a hard dive to 0% — which would read as "0% cache",
    // the most flattering value on the chart.
    const sessions = [
      session('2026-07-26T10:00:00Z', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
      session('2026-07-26T11:00:00Z', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    ];

    const [week] = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(week.total).toBeNull();
    expect(week.inputPct).toBeNull();
    expect(week.outputPct).toBeNull();
    expect(week.cacheReadPct).toBeNull();
    expect(week.cacheWritePct).toBeNull();
    expect(week.cachePct).toBeNull();
    expect(week.sessionCount).toBe(2);
  });

  it('marks only the bucket containing today as partial', () => {
    const sessions = [
      session('2026-07-19T10:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T10:00:00Z', { cacheRead: 10 }),
    ];

    const weeks = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(weeks[0].partial).toBe(false);
    expect(weeks[1].partial).toBe(true);
  });
});
