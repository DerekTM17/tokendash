import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsageChart from '../src/components/UsageChart';

const sessions = [
  { startedAt: '2026-07-01T10:00:00Z', inputTokens: 100000, outputTokens: 5000, cost: 2.5 },
  { startedAt: '2026-07-02T10:00:00Z', inputTokens: 80000, outputTokens: 4000, cost: 2.0 },
  { startedAt: '2026-07-03T10:00:00Z', inputTokens: 120000, outputTokens: 6000, cost: 3.0 },
];

describe('UsageChart', () => {
  it('renders with data', () => {
    const { container } = render(<UsageChart sessions={sessions} />);
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
  });

  it('renders empty state', () => {
    const { container } = render(<UsageChart sessions={[]} />);
    expect(container.textContent).toContain('No data');
  });
});
