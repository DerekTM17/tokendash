import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DriverDecomposition from '../src/components/DriverDecomposition.jsx';

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
});
