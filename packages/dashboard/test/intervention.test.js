import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/lib/intervention.js';

const row = (d, calls, tokens, cost, turns) => [d, calls, tokens, 0, 0, 0, cost, 0, 0, 0, turns];
// Like row(), but places cost in a chosen token-type bucket instead of always
// costInput. Needed to exercise the tokenType confound dimension: row() alone
// puts 100% of cost in costInput on both sides of every test, so
// tokenTypeShares never moves and that dimension can never fire in the suite.
const rowBucket = (d, calls, tokens, cost, turns, bucket) => {
  const costs = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, [bucket]: cost };
  return [d, calls, tokens, 0, 0, 0, costs.input, costs.output, costs.cacheRead, costs.cacheWrite, turns];
};
const days = (from, n, fn) => {
  const out = [];
  const t = Date.parse(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(fn(new Date(t + i * 86400000).toISOString().slice(0, 10), i));
  return out;
};
const claude = (id, rows, extra = {}) => ({ id, tool: 'claude', daily: rows, ...extra });

// 14 days before and 14 after, with tokens/request halving at the boundary.
const corpus = () => [claude('a', [
  ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
  ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)),
])];

const iv = { date: '2026-07-15', label: 'test', expect: 'tokensPerRequest', expectedShift: [] };
const today = '2026-08-20';

describe('evaluate', () => {
  it('supports a real improvement in the declared factor', () => {
    const r = evaluate(corpus(), iv, { today });
    expect(r.verdict).toBe('supported');
    expect(r.before.tokensPerRequest).toBe(2000);
    expect(r.after.tokensPerRequest).toBe(1000);
  });

  it('refuses when the before-window predates coverage', () => {
    const sessions = [claude('a', days('2026-07-10', 24, d => row(d, 10, 20000, 8, 2)))];
    const r = evaluate(sessions, iv, { today });
    expect(r.verdict).toBe('refused');
    expect(r.reasons.join(' ')).toMatch(/coverage/i);
  });

  it('refuses with an accurate reason when a side has calls but no turns', () => {
    // Subagent-only activity: real calls, real cost, zero user turns.
    const sessions = [claude('a', [
      ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
      ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 0)),
    ])];
    const r = evaluate(sessions, iv, { today });
    expect(r.verdict).toBe('refused');
    expect(r.reasons.join(' ')).toMatch(/no usable denominator/i);
    expect(r.reasons.join(' ')).not.toMatch(/no active days/i);
  });

  it('refuses when either side has zero active days', () => {
    const sessions = [claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)))];
    const r = evaluate(sessions, iv, { today });
    expect(r.verdict).toBe('refused');
    expect(r.reasons.join(' ')).toMatch(/no active days/i);
  });

  it('reports pending for a future intervention date', () => {
    const r = evaluate(corpus(), { ...iv, date: '2026-12-01' }, { today });
    expect(r.verdict).toBe('pending');
  });

  it('reports provisional while the after-window is still elapsing', () => {
    const r = evaluate(corpus(), iv, { today: '2026-07-20' });
    expect(r.verdict).toBe('provisional');
  });

  it('labels underpowered when active days fall below the minimum', () => {
    const sessions = [claude('a', [
      ...days('2026-07-01', 14, (d, i) => row(d, i < 2 ? 10 : 0, i < 2 ? 20000 : 0, i < 2 ? 8 : 0, i < 2 ? 2 : 0)),
      ...days('2026-07-16', 14, (d, i) => row(d, i < 2 ? 10 : 0, i < 2 ? 10000 : 0, i < 2 ? 4 : 0, i < 2 ? 2 : 0)),
    ])];
    expect(evaluate(sessions, iv, { today }).verdict).toBe('underpowered');
  });

  it('flags a model-mix shift as a confound', () => {
    const sessions = [
      claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)), { model: 'claude-opus-5' }),
      claude('b', days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)), { model: 'claude-sonnet-5' }),
    ];
    const r = evaluate(sessions, iv, { today });
    expect(r.verdict).toBe('confounded');
    expect(r.confounds.some(c => c.dimension === 'model')).toBe(true);
  });

  it('does not flag a pre-registered expected shift', () => {
    const sessions = [
      claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)), { model: 'claude-opus-5' }),
      claude('b', days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)), { model: 'claude-sonnet-5' }),
    ];
    const r = evaluate(sessions, { ...iv, expectedShift: ['model'] }, { today });
    expect(r.verdict).toBe('supported');
    expect(r.confounds.some(c => c.dimension === 'model' && c.expected)).toBe(true);
  });

  it('flags a token-type mix shift as a confound', () => {
    // Same session both sides (no model/project/subagent shift), but cost
    // moves entirely from cacheWrite to cacheRead across the boundary.
    const sessions = [claude('a', [
      ...days('2026-07-01', 14, d => rowBucket(d, 10, 20000, 8, 2, 'cacheWrite')),
      ...days('2026-07-16', 14, d => rowBucket(d, 10, 10000, 4, 2, 'cacheRead')),
    ])];
    const r = evaluate(sessions, iv, { today });
    const confound = r.confounds.find(c => c.dimension === 'tokenType' && c.category === 'cacheWrite');
    expect(confound).toBeTruthy();
    expect(Math.abs(confound.delta)).toBeGreaterThan(0.10);
  });

  it('throws when options.today is not provided', () => {
    expect(() => evaluate(corpus(), iv, {})).toThrow(/today/i);
  });

  it('lists an overlapping intervention as a confound', () => {
    const r = evaluate(corpus(), iv, {
      today,
      others: [{ date: '2026-07-20', label: 'another change' }],
    });
    expect(r.confounds.some(c => c.dimension === 'intervention')).toBe(true);
  });

  // An adoption/engagement intervention aims a factor UPWARD. The comparison
  // holds every other factor still, so only `activeDays` moves: 7 active days
  // before against 14 after is exactly the shape "we got the team using it"
  // produces.
  const adoption = () => [claude('a', [
    ...days('2026-07-01', 7, d => row(d, 10, 20000, 8, 2)),
    ...days('2026-07-16', 14, d => row(d, 10, 20000, 8, 2)),
  ])];

  it('supports a rise when the declared direction is up', () => {
    const r = evaluate(adoption(), { ...iv, expect: 'activeDays', direction: 'up' }, { today });
    expect(r.before.activeDays).toBe(7);
    expect(r.after.activeDays).toBe(14);
    expect(r.verdict).toBe('supported');
    expect(r.reasons.join(' ')).toMatch(/activeDays rose from 7 to 14/);
  });

  it('does not support a rise when no direction is declared', () => {
    // The default is `down`, so an omitted direction keeps the meaning every
    // interventions.json written before the field existed already had.
    const r = evaluate(adoption(), { ...iv, expect: 'activeDays' }, { today });
    expect(r.verdict).toBe('not-supported');
    expect(r.reasons.join(' ')).toMatch(/activeDays did not fall/);
  });

  it('does not support a fall when the declared direction is up', () => {
    const r = evaluate(corpus(), { ...iv, direction: 'up' }, { today });
    expect(r.verdict).toBe('not-supported');
    expect(r.reasons.join(' ')).toMatch(/tokensPerRequest did not rise/);
  });

  it('rejects a window length that is not a multiple of 7', () => {
    expect(() => evaluate(corpus(), iv, { today, windowDays: 10 })).toThrow(/multiple of 7/);
  });
});
