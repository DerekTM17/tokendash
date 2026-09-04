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
    // A shape reality can produce: the after-window runs 07-16..07-29, five of
    // its days have elapsed, and the corpus stops the day before `today`. The
    // old fixture passed this assertion only because it carried data for days
    // AFTER today — a corpus that cannot exist — which meant the realistic
    // mid-flight shape (thin so far, still running) was never exercised.
    const midFlight = [claude('a', [
      ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
      ...days('2026-07-16', 5, d => row(d, 10, 10000, 4, 2)),
    ])];
    const r = evaluate(midFlight, iv, { today: '2026-07-21' });
    expect(r.verdict).toBe('provisional');
    expect(r.after.activeDays).toBe(5);
    expect(r.reasons.join(' ')).toMatch(/9 day\(s\) left/);
    expect(r.reasons.join(' ')).toMatch(/not a final result/i);
  });

  it('says a mid-flight window is unfinished AND thin, not merely thin', () => {
    // Four of the fourteen after-days elapsed. The reader must be told the
    // window is not FINISHED — "underpowered / watch it accumulate" says only
    // that it is thin, which reads as a settled answer about a settled window.
    const midFlight = [claude('a', [
      ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
      ...days('2026-07-16', 4, d => row(d, 10, 10000, 4, 2)),
    ])];
    const r = evaluate(midFlight, iv, { today: '2026-07-20' });
    expect(r.verdict).toBe('provisional');
    expect(r.reasons.join(' ')).toMatch(/10 day\(s\) left/);
    expect(r.reasons.join(' ')).toMatch(/below the 5-day minimum/);
  });

  it('refuses to call a verdict final on the day the after-window ends', () => {
    // The spec's reproducibility rule: the after-window ends STRICTLY before
    // today, so the last day is not still accumulating while being measured. On
    // 07-29 that day holds 1 call of the ~10 every other day carries, and the
    // figure it produces (995.42, not the 1000 the finished window will show)
    // is one the old `>` was willing to call final — and a final verdict is
    // freezable into the permanent sidecar.
    const partialLastDay = [claude('a', [
      ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
      ...days('2026-07-16', 13, d => row(d, 10, 10000, 4, 2)),
      row('2026-07-29', 1, 400, 0.16, 1),
    ])];

    const onTheDay = evaluate(partialLastDay, iv, { today: '2026-07-29' });
    expect(onTheDay.verdict).toBe('provisional');
    expect(onTheDay.after.tokensPerRequest).toBeCloseTo(995.42, 2);
    // One day later the window has closed and the verdict is final.
    expect(evaluate(partialLastDay, iv, { today: '2026-07-30' }).verdict).toBe('supported');
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
    // Pre-registration names CATEGORIES: "opus share will fall, sonnet share
    // will rise". Both sides of the swap have to be declared, because both are
    // shifts the reader will see listed.
    const sessions = [
      claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)), { model: 'claude-opus-5' }),
      claude('b', days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)), { model: 'claude-sonnet-5' }),
    ];
    const declared = { ...iv, expectedShift: ['model/claude-opus-5', 'model/claude-sonnet-5'] };
    const r = evaluate(sessions, declared, { today });
    expect(r.verdict).toBe('supported');
    expect(r.confounds.some(c => c.dimension === 'model' && c.expected)).toBe(true);
    expect(r.confounds.every(c => c.expected)).toBe(true);
  });

  it('does not exempt a third model the declaration never named', () => {
    // The whole point of naming the shift in advance. Declaring the opus ->
    // sonnet swap must not launder an unannounced switch to a third model; a
    // dimension-wide `['model']` exemption was exactly the post-hoc excuse
    // pre-registration exists to rule out.
    const sessions = [
      claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)), { model: 'claude-opus-5' }),
      claude('b', days('2026-07-16', 14, d => row(d, 10, 6000, 2, 2)), { model: 'claude-sonnet-5' }),
      claude('c', days('2026-07-16', 14, d => row(d, 10, 4000, 2, 2)), { model: 'claude-haiku-5' }),
    ];
    const declared = { ...iv, expectedShift: ['model/claude-opus-5', 'model/claude-sonnet-5'] };
    const r = evaluate(sessions, declared, { today });
    expect(r.verdict).toBe('confounded');
    const haiku = r.confounds.find(c => c.dimension === 'model' && c.category === 'claude-haiku-5');
    expect(haiku).toBeTruthy();
    expect(haiku.expected).toBe(false);
    // ...while the two categories that WERE declared stay exempt.
    expect(r.confounds.filter(c => c.category.startsWith('claude-opus') || c.category.startsWith('claude-sonnet'))
      .every(c => c.expected)).toBe(true);
  });

  it('accepts a bare category name, which is why "subagent" still works', () => {
    // `subagent` is the one dimension whose name and category coincide, so a
    // declaration written as `['subagent']` keeps working — by naming the
    // category, not by exempting the dimension.
    const sessions = [
      claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2))),
      claude('b', days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)), { isSubagent: true }),
    ];
    const r = evaluate(sessions, { ...iv, expectedShift: ['subagent', 'main'] }, { today });
    expect(r.confounds.filter(c => c.dimension === 'subagent').every(c => c.expected)).toBe(true);
  });

  it('ignores a mix shift that no turn-capable tool participated in', () => {
    // Confound shares must run over the same population `factorsFor` does.
    // Codex cost is excluded from the decomposition entirely, so a project mix
    // swing driven only by Codex describes a cost base this comparison never
    // touched — and used to flag it `confounded`.
    const sessions = [
      claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)), { project: 'alpha' }),
      claude('b', days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)), { project: 'alpha' }),
      { id: 'x', tool: 'codex', project: 'beta',
        daily: days('2026-07-16', 14, d => row(d, 10, 50000, 200, 0)) },
    ];
    const r = evaluate(sessions, iv, { today });
    expect(r.confounds.filter(c => c.dimension === 'project')).toEqual([]);
    expect(r.verdict).toBe('supported');
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

  it('counts a second intervention on the SAME DAY as a confound', () => {
    // Self is skipped by identity, not by date. Two changes made on one day is
    // the strongest confound there is, and it was the single case dropped —
    // the comparison came back a clean `supported`.
    const r = evaluate(corpus(), iv, {
      today,
      others: [iv, { date: iv.date, label: 'a totally different change' }],
    });
    const clash = r.confounds.find(c => c.dimension === 'intervention');
    expect(clash).toBeTruthy();
    expect(clash.category).toBe('a totally different change');
    expect(r.confounds.filter(c => c.category === iv.label)).toEqual([]);
    expect(r.verdict).toBe('confounded');
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
