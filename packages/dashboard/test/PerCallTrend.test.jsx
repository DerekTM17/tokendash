import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PerCallTrend, { PerCallTooltip } from '../src/components/PerCallTrend';

// jsdom reports zero size for every element, so recharts' ResponsiveContainer
// renders nothing and any assertion about chart internals passes vacuously.
// Swap it for a fixed-size wrapper so the Line elements actually mount — without
// this, every chart assertion below would be green no matter what the component
// did. Do not delete this thinking it is scaffolding.
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

function dayRow(day, calls, context, cost = 1) {
  return [day, calls, 0, 500, context, 0, 0, 0, cost, 0];
}

const sessions = [
  {
    tool: 'claude',
    isSubagent: false,
    daily: [dayRow('2026-07-19', 10, 10 * 400_000), dayRow('2026-07-26', 10, 10 * 120_000)],
  },
  {
    tool: 'claude',
    isSubagent: true,
    daily: [dayRow('2026-07-19', 50, 50 * 60_000), dayRow('2026-07-26', 50, 50 * 90_000)],
  },
];

describe('PerCallTrend', () => {
  it('renders one line per series that has data', () => {
    // The mock's wrapper div carries `.recharts-responsive-container` whether or
    // not the chart mounted, so that class proves nothing. Assert on the lines.
    const { container } = render(<PerCallTrend sessions={sessions} />);
    // Four series are declared; recharts renders a <Line> curve for each, and
    // the two Codex ones are empty but still declared.
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(4);
  });

  it('renders the empty state', () => {
    const { container } = render(<PerCallTrend sessions={[]} />);
    expect(container.textContent).toContain('No data');
  });

  it('offers both granularity and metric toggles', () => {
    render(<PerCallTrend sessions={sessions} />);
    expect(screen.getByText('Week')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
    expect(screen.getByText('Context')).toBeTruthy();
    expect(screen.getByText('Cost')).toBeTruthy();
  });

  it('switches to Cost mode and changes the caveat text with it', () => {
    const { container } = render(<PerCallTrend sessions={sessions} />);
    expect(container.textContent).toContain('weighted by calls');

    fireEvent.click(screen.getByText('Cost'));

    // Cost mode must say out loud that it also tracks model choice — a falling
    // line there is not evidence of context discipline on its own.
    expect(container.textContent).toContain('cheaper model');
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(4);
  });

  it('switches granularity without crashing', () => {
    const { container } = render(<PerCallTrend sessions={sessions} />);
    fireEvent.click(screen.getByText('Day'));
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(4);
  });

  it('dots an isolated point so a lone bucket is not invisible', () => {
    const gapped = [
      ...sessions,
      // Codex appears in exactly one bucket, with nothing either side.
      { tool: 'codex', isSubagent: false, daily: [dayRow('2026-07-19', 3, 3 * 120_000)] },
    ];
    const { container } = render(<PerCallTrend sessions={gapped} />);
    // One dot, for the single isolated Codex point. The claude series span both
    // buckets and must not be dotted — dotting everything would draw hundreds of
    // dots in Day mode.
    expect(container.querySelectorAll('.recharts-line-dots circle')).toHaveLength(1);
  });
});

describe('PerCallTooltip', () => {
  const row = {
    key: '2026-07-26',
    partial: false,
    claudeMain: 120_000,
    claudeMain__calls: 10,
    claudeSub: null,
    claudeSub__calls: 0,
    codexMain: null,
    codexMain__calls: 0,
    codexSub: null,
    codexSub__calls: 0,
  };

  it('lists only the series with data, with their call counts', () => {
    const { container } = render(
      <PerCallTooltip active payload={[{ payload: row }]} granularity="week" metric="context" />
    );
    expect(container.textContent).toContain('Claude main');
    expect(container.textContent).not.toContain('Claude subagent');
    // The denominator is shown: a mean over 10 calls earns less trust than one
    // over 10,000.
    expect(container.textContent).toContain('10 calls');
    expect(container.textContent).toContain('120.0K');
  });

  it('renders nothing when the bucket has no live series', () => {
    const empty = { ...row, claudeMain: null, claudeMain__calls: 0 };
    const { container } = render(
      <PerCallTooltip active payload={[{ payload: empty }]} granularity="week" metric="context" />
    );
    expect(container.innerHTML).toBe('');
  });

  it('formats cost mode in dollars', () => {
    const { container } = render(
      <PerCallTooltip active payload={[{ payload: { ...row, claudeMain: 0.3467 } }]} granularity="week" metric="cost" />
    );
    expect(container.textContent).toContain('$0.3467');
  });
});
