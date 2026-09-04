import { describe, it, expect } from 'vitest';
import { factorsFor, FACTOR_KEYS } from '../src/lib/factors.js';

// [day, calls, input, output, cacheRead, cacheWrite, cI, cO, cR, cW, turns]
const row = (d, calls, tokens, cost, turns) =>
  [d, calls, tokens, 0, 0, 0, cost, 0, 0, 0, turns];

const claude = (id, rows) => ({ id, tool: 'claude', daily: rows });

describe('factorsFor', () => {
  it('computes the five factors and they multiply back to cost', () => {
    const sessions = [claude('a', [
      row('2026-07-01', 4, 1000, 10, 2),
      row('2026-07-02', 6, 2000, 20, 2),
    ])];
    const f = factorsFor(sessions, '2026-07-01', '2026-07-02');

    expect(f.activeDays).toBe(2);
    expect(f.turns).toBe(4);
    expect(f.requests).toBe(10);
    expect(f.turnsPerActiveDay).toBe(2);
    expect(f.requestsPerTurn).toBe(2.5);
    expect(f.tokensPerRequest).toBe(300);
    expect(f.cost).toBe(30);

    const product = FACTOR_KEYS.reduce((p, k) => p * f[k], 1);
    expect(product).toBeCloseTo(f.cost, 8);
  });

  it('excludes turn-incapable tools and reports what it excluded', () => {
    const sessions = [
      claude('a', [row('2026-07-01', 2, 1000, 10, 1)]),
      { id: 'b', tool: 'codex', daily: [row('2026-07-01', 8, 5000, 40, 0)] },
    ];
    const f = factorsFor(sessions, '2026-07-01', '2026-07-01');
    // Without the filter, requestsPerTurn would be 10 instead of 2 — a 5x
    // inflation from requests that have no matching turn.
    expect(f.requestsPerTurn).toBe(2);
    expect(f.excludedCost).toBe(40);
  });

  it('ignores days outside the window', () => {
    const sessions = [claude('a', [
      row('2026-06-30', 9, 9000, 90, 9),
      row('2026-07-01', 2, 1000, 10, 1),
    ])];
    const f = factorsFor(sessions, '2026-07-01', '2026-07-01');
    expect(f.activeDays).toBe(1);
    expect(f.cost).toBe(10);
  });

  it('returns null when the window has no active days', () => {
    expect(factorsFor([claude('a', [row('2026-07-01', 2, 1000, 10, 1)])],
      '2026-08-01', '2026-08-14')).toBeNull();
  });

  it('does not count a zero-call day as active', () => {
    const sessions = [claude('a', [
      row('2026-07-01', 0, 0, 0, 1),
      row('2026-07-02', 2, 1000, 10, 1),
    ])];
    expect(factorsFor(sessions, '2026-07-01', '2026-07-02').activeDays).toBe(1);
  });
});
