import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MetricsStrip from '../src/components/MetricsStrip';

function dayRow(day, cost) {
  return [day, 1, 0, 0, 0, 0, cost, 0, 0, 0];
}

const session = (id, tool, cost, startedAt, daily) => ({
  id, tool, cost, startedAt, daily,
  inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  costParts: { cacheRead: 0, cacheWrite: 0 },
  project: 'p',
});

/** The shape that produced the bug: a few dollars of old opencode activity in
 *  April, then the Claude record that actually starts in June. Dividing $104 by
 *  the 46-day Apr→Jun span reports $2.26/day for a period whose real rate is
 *  $100/day. */
const skewed = [
  session('old', 'opencode', 4, '2026-04-27T10:00:00Z', [dayRow('2026-04-27', 4)]),
  session('big', 'claude', 100, '2026-06-11T10:00:00Z', [dayRow('2026-06-11', 100)]),
];

describe('MetricsStrip', () => {
  it('divides by the covered span, not by the whole session history', () => {
    render(<MetricsStrip sessions={skewed} />);
    expect(screen.getByText('$100.00')).toBeDefined();
  });

  it('projects from the covered burn rate', () => {
    render(<MetricsStrip sessions={skewed} />);
    expect(screen.getByText('$3000.00')).toBeDefined();
  });

  it('says which day the record starts on when earlier data is missing', () => {
    render(<MetricsStrip sessions={skewed} />);
    expect(screen.getByText(/since Jun 11/)).toBeDefined();
  });

  it('claims no start date when nothing precedes the record', () => {
    const clean = [session('a', 'claude', 50, '2026-06-11T10:00:00Z', [dayRow('2026-06-11', 50)])];
    render(<MetricsStrip sessions={clean} />);
    expect(screen.queryByText(/since /)).toBe(null);
  });

  it('explains every metric label, including the ones passed dynamically', () => {
    render(<MetricsStrip sessions={skewed} />);
    for (const label of ['burn rate', 'projected', 'cache % of cost', 'tokens / $', 'coverage']) {
      expect(screen.getByRole('button', { name: `What is ${label}?` }), label).toBeDefined();
    }
  });

  it('renders nothing without sessions', () => {
    const { container } = render(<MetricsStrip sessions={[]} />);
    expect(container.firstChild).toBe(null);
  });
});
