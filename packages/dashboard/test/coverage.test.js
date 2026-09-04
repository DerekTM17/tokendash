import { describe, it, expect } from 'vitest';
import { strict as assert } from 'node:assert';
import { dataCoverage, trimToCoverage, coverageWindow, firstCoveredDay } from '../src/lib/coverage';

// 11 columns, matching ingest's DAILY_COLUMNS — the trailing `turns` column is
// what makes a turn-only row expressible at all, so a 10-column helper cannot
// build the case coverage now has to exclude.
function dayRow(day, cost = 1, calls = 1, turns = 1) {
  return [day, calls, 0, 0, 0, 0, cost, 0, 0, 0, turns];
}

/** A day holding user turns and no API call — the shape `addTurn` creates for a
 *  prompt typed at 23:59 whose answer lands after midnight. No calls, no
 *  tokens, no cost. */
const turnOnlyRow = (day, turns = 28) => dayRow(day, 0, 0, turns);

const session = (id, tool, cost, daily) => ({ id, tool, cost, daily });

describe('dataCoverage', () => {
  it('returns null when nothing precedes the dominant tool', () => {
    const sessions = [session('a', 'claude', 100, [dayRow('2026-06-11', 100)])];
    expect(dataCoverage(sessions)).toBeNull();
  });

  it('returns null for no sessions', () => {
    expect(dataCoverage([])).toBeNull();
  });

  it('anchors to the tool carrying the most cost, not the earliest one', () => {
    // The real shape: a $4 opencode session in April stretches the axis across
    // six near-empty weeks for a panel whose subject is a $7,869 Claude history.
    const sessions = [
      session('old', 'opencode', 2.65, [dayRow('2026-04-27', 2.65)]),
      session('big', 'claude', 7869, [dayRow('2026-06-11', 7869)]),
    ];

    const coverage = dataCoverage(sessions);

    expect(coverage.tool).toBe('claude');
    expect(coverage.start).toBe('2026-06-11');
    expect(coverage.excluded.sessions).toBe(1);
    expect(coverage.excluded.cost).toBeCloseTo(2.65, 5);
    expect(coverage.excluded.tools).toEqual(['opencode']);
  });

  it('follows the data if the dominant tool changes', () => {
    const sessions = [
      session('a', 'claude', 5, [dayRow('2026-06-11', 5)]),
      session('b', 'codex', 900, [dayRow('2026-07-01', 900)]),
    ];

    const coverage = dataCoverage(sessions);

    expect(coverage.tool).toBe('codex');
    expect(coverage.start).toBe('2026-07-01');
    expect(coverage.excluded.tools).toEqual(['claude']);
  });

  it('counts a session once even when it spans several excluded days', () => {
    const sessions = [
      session('multi', 'opencode', 3, [dayRow('2026-04-27', 1), dayRow('2026-04-28', 2)]),
      session('big', 'claude', 500, [dayRow('2026-06-11', 500)]),
    ];

    const coverage = dataCoverage(sessions);

    expect(coverage.excluded.sessions).toBe(1);
    expect(coverage.excluded.cost).toBeCloseTo(3, 5);
    expect(coverage.excluded.firstDay).toBe('2026-04-27');
  });

  it('does not anchor coverage to a turn-only day', () => {
    // The dominant tool's earliest ROW is 2026-06-10, but that row has no calls
    // — a prompt whose answer landed after midnight. Anchoring to it would pull
    // `start` a day early and hand every downstream guard a floor the data
    // does not support.
    const sessions = [
      session('old', 'opencode', 2.65, [dayRow('2026-04-27', 2.65)]),
      session('big', 'claude', 7869, [turnOnlyRow('2026-06-10'), dayRow('2026-06-11', 7869)]),
    ];

    const coverage = dataCoverage(sessions);

    expect(coverage.start).toBe('2026-06-11');
  });

  it('ignores the part of a straddling session that falls after the start', () => {
    const sessions = [
      session('straddle', 'codex', 10, [dayRow('2026-06-10', 4), dayRow('2026-06-12', 6)]),
      session('big', 'claude', 500, [dayRow('2026-06-11', 500)]),
    ];

    const coverage = dataCoverage(sessions);

    // Only the 06-10 day is before coverage; the 06-12 day is on the chart.
    expect(coverage.excluded.cost).toBeCloseTo(4, 5);
  });
});

describe('trimToCoverage', () => {
  const buckets = ['2026-04-26', '2026-05-03', '2026-05-31', '2026-06-07', '2026-06-14']
    .map(key => ({ key }));

  it('is a no-op without coverage', () => {
    expect(trimToCoverage(buckets, null, 'week')).toHaveLength(5);
  });

  it('keeps the week containing the coverage start, and drops earlier ones', () => {
    // Coverage starts 2026-06-11, inside the week beginning 2026-06-07. That
    // bucket must survive with its partial data rather than be cut for starting
    // before the boundary.
    const kept = trimToCoverage(buckets, { start: '2026-06-11' }, 'week');
    expect(kept.map(b => b.key)).toEqual(['2026-06-07', '2026-06-14']);
  });

  it('trims day buckets on the exact day', () => {
    const days = ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'].map(key => ({ key }));
    const kept = trimToCoverage(days, { start: '2026-06-11' }, 'day');
    expect(kept.map(b => b.key)).toEqual(['2026-06-11', '2026-06-12']);
  });
});

describe('coverageWindow', () => {
  it('returns null when no session carries daily data', () => {
    expect(coverageWindow([], null)).toBeNull();
    expect(coverageWindow([session('a', 'claude', 5, [])], null)).toBeNull();
  });

  it('spans the coverage boundary to the last recorded day, inclusive', () => {
    const sessions = [
      session('old', 'opencode', 4, [dayRow('2026-04-27', 4)]),
      session('big', 'claude', 100, [dayRow('2026-06-11', 60), dayRow('2026-06-12', 40)]),
    ];

    const w = coverageWindow(sessions, dataCoverage(sessions));

    expect(w.start).toBe('2026-06-11');
    expect(w.end).toBe('2026-06-12');
    expect(w.days).toBe(2);
  });

  it('excludes cost recorded before the boundary from the windowed cost', () => {
    // The whole point: $4 of April opencode spend must not be divided across a
    // June-onward window, and must not silently inflate it either.
    const sessions = [
      session('old', 'opencode', 4, [dayRow('2026-04-27', 4)]),
      session('big', 'claude', 100, [dayRow('2026-06-11', 100)]),
    ];

    const w = coverageWindow(sessions, dataCoverage(sessions));

    expect(w.cost).toBeCloseTo(100, 5);
    expect(w.excludedCost).toBeCloseTo(4, 5);
  });

  it('falls back to the earliest recorded day when there is no boundary', () => {
    const sessions = [session('a', 'claude', 10, [dayRow('2026-06-11', 10)])];

    const w = coverageWindow(sessions, dataCoverage(sessions));

    expect(w.start).toBe('2026-06-11');
    expect(w.days).toBe(1);
    expect(w.excludedCost).toBe(0);
  });

  it('counts a single day as one day, never zero', () => {
    const sessions = [session('a', 'claude', 10, [dayRow('2026-08-14', 10)])];
    expect(coverageWindow(sessions, null).days).toBe(1);
  });

  it('does not let a turn-only day extend the window at either end', () => {
    // A turn-only row on the day before and the day after the real span. It
    // carries no calls, no tokens and no cost, so it is not coverage — but it
    // would silently widen `days`, the denominator of the burn rate, by 2.
    const sessions = [session('a', 'claude', 100, [
      turnOnlyRow('2026-06-10'),
      dayRow('2026-06-11', 60),
      dayRow('2026-06-12', 40),
      turnOnlyRow('2026-06-13'),
    ])];

    const w = coverageWindow(sessions, null);

    expect(w.start).toBe('2026-06-11');
    expect(w.end).toBe('2026-06-12');
    expect(w.days).toBe(2);
    expect(w.cost).toBeCloseTo(100, 5);
  });

  it('returns null when every row is turn-only', () => {
    const sessions = [session('a', 'claude', 0, [turnOnlyRow('2026-06-10')])];
    expect(coverageWindow(sessions, null)).toBeNull();
  });
});

const day = (d, cost) => [d, 1, 100, 10, 0, 0, cost, 0, 0, 0, 1];

describe('firstCoveredDay', () => {
  it('returns a floor on a single-tool corpus, where dataCoverage returns null', () => {
    const sessions = [
      { id: 'a', tool: 'claude', cost: 1, daily: [day('2026-06-11', 1)] },
      { id: 'b', tool: 'claude', cost: 2, daily: [day('2026-07-01', 2)] },
    ];
    // The trap: nothing predates the dominant tool's first day, so dataCoverage
    // has nothing to report and returns null. A guard keyed off it would have
    // no floor at all — on the one deployment it was written to protect.
    assert.equal(dataCoverage(sessions), null);
    assert.equal(firstCoveredDay(sessions), '2026-06-11');
  });

  it('returns the trimmed start when an earlier tool exists', () => {
    const sessions = [
      { id: 'a', tool: 'opencode', cost: 0.5, daily: [day('2026-04-01', 0.5)] },
      { id: 'b', tool: 'claude', cost: 100, daily: [day('2026-06-11', 100)] },
    ];
    assert.equal(firstCoveredDay(sessions), '2026-06-11');
  });

  it('returns null when there is no data at all', () => {
    assert.equal(firstCoveredDay([]), null);
  });
});
