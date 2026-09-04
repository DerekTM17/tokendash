import { describe, it, expect } from 'vitest';
import { decompose } from '../src/lib/decompose.js';
import { FACTOR_KEYS } from '../src/lib/factors.js';

const f = (activeDays, turnsPerActiveDay, requestsPerTurn, tokensPerRequest, pricePerToken) => {
  const cost = activeDays * turnsPerActiveDay * requestsPerTurn * tokensPerRequest * pricePerToken;
  return { activeDays, turnsPerActiveDay, requestsPerTurn, tokensPerRequest, pricePerToken, cost };
};

describe('decompose', () => {
  it('contributions sum exactly to the change in cost', () => {
    const before = f(10, 5, 8, 20000, 0.000004);
    const after = f(12, 6, 6, 18000, 0.0000035);
    const { contributions, total } = decompose(before, after);
    const sum = FACTOR_KEYS.reduce((n, k) => n + contributions[k], 0);
    expect(sum).toBeCloseTo(after.cost - before.cost, 8);
    expect(total).toBeCloseTo(after.cost - before.cost, 8);
  });

  it('sums to the delta across 200 randomised inputs', () => {
    const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
    for (let i = 0; i < 200; i++) {
      const a = f(rnd(1, 30), rnd(1, 40), rnd(1, 60), rnd(1000, 60000), rnd(1e-6, 1e-5));
      const b = f(rnd(1, 30), rnd(1, 40), rnd(1, 60), rnd(1000, 60000), rnd(1e-6, 1e-5));
      const { contributions } = decompose(a, b);
      const sum = FACTOR_KEYS.reduce((n, k) => n + contributions[k], 0);
      const delta = b.cost - a.cost;
      expect(Math.abs(sum - delta) / Math.max(Math.abs(delta), 1e-9)).toBeLessThan(1e-9);
    }
  });

  it('agrees with LMDI on an ordinary change', () => {
    const { orderSensitive } = decompose(f(10, 5, 8, 20000, 4e-6), f(11, 5.2, 7.5, 19000, 3.9e-6));
    expect(orderSensitive).toBe(false);
  });

  it('flags order sensitivity when the change is violent', () => {
    const { orderSensitive } = decompose(f(2, 1, 1, 1000, 1e-6), f(40, 60, 90, 90000, 9e-6));
    expect(orderSensitive).toBe(true);
  });

  it('skips the oracle when a factor is zero', () => {
    const before = { ...f(10, 5, 8, 20000, 4e-6), turnsPerActiveDay: 0, cost: 0 };
    const { oracleSkipped, orderSensitive } = decompose(before, f(11, 5, 8, 20000, 4e-6));
    expect(oracleSkipped).toBe(true);
    expect(orderSensitive).toBe(false);
  });

  // The sum-to-delta tests above only catch a broken SUM, never a broken
  // MAPPING: if a future edit swapped which telescoping term lands on which
  // FACTOR_KEYS[i], every assertion above would still pass because the terms
  // still add up. Changing exactly one factor and leaving the rest identical
  // pins the mapping instead: that factor must carry the whole delta and the
  // other four must be exactly zero. Checked at both ends of FACTOR_KEYS so a
  // reordering couldn't pass by symmetry.
  it('attributes the entire delta to activeDays when only activeDays changes', () => {
    const before = f(10, 5, 8, 20000, 4e-6);
    const after = f(15, 5, 8, 20000, 4e-6);
    const { contributions } = decompose(before, after);
    expect(contributions.activeDays).toBeCloseTo(after.cost - before.cost, 8);
    expect(contributions.turnsPerActiveDay).toBe(0);
    expect(contributions.requestsPerTurn).toBe(0);
    expect(contributions.tokensPerRequest).toBe(0);
    expect(contributions.pricePerToken).toBe(0);
  });

  it('attributes the entire delta to pricePerToken when only pricePerToken changes', () => {
    const before = f(10, 5, 8, 20000, 4e-6);
    const after = f(10, 5, 8, 20000, 3e-6);
    const { contributions } = decompose(before, after);
    expect(contributions.pricePerToken).toBeCloseTo(after.cost - before.cost, 8);
    expect(contributions.activeDays).toBe(0);
    expect(contributions.turnsPerActiveDay).toBe(0);
    expect(contributions.requestsPerTurn).toBe(0);
    expect(contributions.tokensPerRequest).toBe(0);
  });
});
