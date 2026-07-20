import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SessionsTable from '../src/components/SessionsTable';

const sessions = [
  { id: 'a', tool: 'claude', project: 'superpowers', model: 'deepseek', startedAt: '2026-07-05T10:00:00Z', inputTokens: 100000, outputTokens: 5000, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 3.42 },
  { id: 'b', tool: 'opencode', project: 'dashboard', model: 'gpt-5', startedAt: '2026-07-04T10:00:00Z', inputTokens: 50000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 1.50 },
];

describe('SessionsTable', () => {
  it('renders session rows', () => {
    render(<SessionsTable sessions={sessions} />);
    expect(screen.getByText('claude')).toBeDefined();
    expect(screen.getByText('$3.42')).toBeDefined();
  });

  it('renders empty state', () => {
    render(<SessionsTable sessions={[]} />);
    expect(screen.getByText('No sessions yet')).toBeDefined();
  });

  it('contains rows in a vertically scrollable body instead of growing the page', () => {
    const { container } = render(<SessionsTable sessions={sessions} />);
    const scroller = container.querySelector('[data-testid="sessions-scroll"]');
    expect(scroller).not.toBeNull();
    expect(scroller.style.overflowY).toBe('auto');
    expect(scroller.style.maxHeight).not.toBe('');
  });

  it('keeps header cells sticky inside the scroll container', () => {
    const { container } = render(<SessionsTable sessions={sessions} />);
    const th = container.querySelector('th');
    expect(th.style.position).toBe('sticky');
    expect(th.style.top).toBe('0px');
  });
});
