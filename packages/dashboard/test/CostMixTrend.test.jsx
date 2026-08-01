import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CostMixTrend from '../src/components/CostMixTrend';

// jsdom reports zero size for every element, so recharts' ResponsiveContainer
// renders nothing and any assertion about chart internals passes vacuously.
// Swap it for a fixed-size wrapper so the Bar/Area elements actually mount —
// otherwise the Dollars-mode assertion below proves nothing.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div className="recharts-responsive-container">
        {React.cloneElement(children, { width: 800, height: 300 })}
      </div>
    ),
  };
});

const sessions = [
  {
    startedAt: '2026-07-19T10:00:00Z',
    costParts: { input: 1, output: 5, cacheRead: 80, cacheWrite: 14 },
  },
  {
    startedAt: '2026-07-26T10:00:00Z',
    costParts: { input: 1, output: 10, cacheRead: 70, cacheWrite: 19 },
  },
];

describe('CostMixTrend', () => {
  it('renders a chart when there is data', () => {
    const { container } = render(<CostMixTrend sessions={sessions} />);
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
  });

  it('renders the empty state', () => {
    const { container } = render(<CostMixTrend sessions={[]} />);
    expect(container.textContent).toContain('No data');
  });

  it('offers both granularity and mode toggles', () => {
    render(<CostMixTrend sessions={sessions} />);
    expect(screen.getByText('Week')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
    expect(screen.getByText('Share')).toBeTruthy();
    expect(screen.getByText('Dollars')).toBeTruthy();
  });

  it('switches granularity without crashing', () => {
    const { container } = render(<CostMixTrend sessions={sessions} />);
    fireEvent.click(screen.getByText('Day'));
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
  });

  it('shows the total-cost bar row in Share mode and drops it in Dollars mode', () => {
    const { container } = render(<CostMixTrend sessions={sessions} />);
    expect(container.querySelector('.recharts-bar')).toBeTruthy();

    fireEvent.click(screen.getByText('Dollars'));
    expect(container.querySelector('.recharts-bar')).toBeNull();
    // The stacked areas must survive the mode switch.
    expect(container.querySelector('.recharts-area')).toBeTruthy();
  });

  it('dots an isolated bucket and leaves connected ones undotted', () => {
    // 2026-06-07 stands alone; 2026-07-19 and 2026-07-26 are adjacent. Only the
    // lone week has no neighbour to form a line segment with, so only it would
    // otherwise render as an invisible zero-area path.
    const gapped = [
      { startedAt: '2026-06-07T10:00:00Z', costParts: { input: 1, output: 5, cacheRead: 80, cacheWrite: 14 } },
      { startedAt: '2026-07-19T10:00:00Z', costParts: { input: 1, output: 5, cacheRead: 80, cacheWrite: 14 } },
      { startedAt: '2026-07-26T10:00:00Z', costParts: { input: 1, output: 10, cacheRead: 70, cacheWrite: 19 } },
    ];
    const { container } = render(<CostMixTrend sessions={gapped} />);
    // One dot per stacked Area, for the isolated bucket only.
    expect(container.querySelectorAll('.recharts-area-dots circle')).toHaveLength(4);
  });

  it('draws no dots when every bucket has a live neighbour', () => {
    // This is what fails if someone "fixes" the isolated case with dot={true}.
    const { container } = render(<CostMixTrend sessions={sessions} />);
    expect(container.querySelectorAll('.recharts-area-dots circle')).toHaveLength(0);
  });
});
