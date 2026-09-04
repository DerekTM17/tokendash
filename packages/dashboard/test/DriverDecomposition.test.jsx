import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DriverDecomposition, { TERMS } from '../src/components/DriverDecomposition.jsx';
import { define } from '../src/lib/glossary.js';

const row = (d, calls, tokens, cost, turns) => [d, calls, tokens, 0, 0, 0, cost, 0, 0, 0, turns];
const days = (from, n, fn) => {
  const out = [];
  const t = Date.parse(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(fn(new Date(t + i * 86400000).toISOString().slice(0, 10)));
  return out;
};

const sessions = [{ id: 'a', tool: 'claude', daily: [
  ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
  ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)),
] }];

describe('DriverDecomposition', () => {
  it('names every factor', () => {
    render(<DriverDecomposition sessions={sessions} delay={0} />);
    for (const label of ['Active days', 'Turns per active day', 'Requests per turn',
      'Tokens per request', 'Price per token']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders an explanatory message rather than a chart when a period is empty', () => {
    render(<DriverDecomposition sessions={[]} delay={0} />);
    expect(screen.getByText(/not enough data/i)).toBeTruthy();
  });

  it('warns when the attribution is order-sensitive', () => {
    const violent = [{ id: 'a', tool: 'claude', daily: [
      ...days('2026-07-01', 14, d => row(d, 1, 1000, 0.01, 1)),
      ...days('2026-07-16', 14, d => row(d, 90, 900000, 90, 60)),
    ] }];
    render(<DriverDecomposition sessions={violent} delay={0} />);
    expect(screen.getByText(/order/i)).toBeTruthy();
  });

  it('renders an explanatory message naming the condition when a half is degenerate (no turns)', () => {
    // Every day here has calls and cost but dayTurns is always 0, so
    // factorsFor returns a non-null result with degenerate: 'no-turns'
    // (real activity, zero-turn denominator) rather than null. decompose()
    // would otherwise divide by that zero and produce NaN contributions.
    const noTurns = [{ id: 'a', tool: 'claude', daily: [
      ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 0)),
      ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 0)),
    ] }];
    render(<DriverDecomposition sessions={noTurns} delay={0} />);
    expect(screen.getByText(/no turns/i)).toBeTruthy();
    expect(screen.queryByText(/nan/i)).toBe(null);
    expect(screen.queryByRole('table')).toBe(null);
  });

  it('formats every factor for a reader, never using exponential notation', () => {
    // Deliberately realistic-scale values: pricePerToken lands around 9e-7 and
    // tokensPerRequest around 1.8e5, the exact ranges that made toPrecision(4)
    // render `9.097e-7` / `1.819e+5` against the real corpus (see the task
    // report's real-data check). Both halves carry identical daily figures so
    // the comparison itself stays uninteresting — this test is only about
    // how the Before/After cells render.
    const realistic = [{ id: 'a', tool: 'claude', daily: [
      ...days('2026-07-01', 14, d => row(d, 600, 108_000_000, 97.2, 20)),
      ...days('2026-07-16', 14, d => row(d, 600, 108_000_000, 97.2, 20)),
    ] }];
    const { container } = render(<DriverDecomposition sessions={realistic} delay={0} />);
    expect(container.textContent).not.toMatch(/\de[+-]\d/i);
    // And the scaled price-per-token figure should read as a dollar amount
    // per million tokens, not a bare per-token fraction.
    expect(screen.getAllByText(/\/ 1M/).length).toBeGreaterThan(0);
  });

  it('names every factor term the panel actually asks the glossary for', () => {
    // The repo-wide glossary.test.js only scans components/ for literal
    // `term="..."` strings; `TERMS[k]` is a dynamic expression it cannot see.
    // This colocated assertion is the real typo guard for these five terms.
    for (const [key, term] of Object.entries(TERMS)) {
      expect(define(term), `TERMS.${key} = "${term}" has no glossary entry`).not.toBeNull();
    }
  });
});
