import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupDetail from '../src/components/GroupDetail';

const sessions = [
  { id: 'a', model: 'claude-opus-4-8', inputTokens: 600_000, outputTokens: 100_000, cacheReadTokens: 300_000, cacheWriteTokens: 0, cost: 12 },
  { id: 'b', model: 'claude-opus-4-8', inputTokens: 400_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 8 },
  { id: 'c', model: 'gpt-5.6-sol', inputTokens: 100_000, outputTokens: 50_000, cacheReadTokens: 50_000, cacheWriteTokens: 0, cost: 30 },
];

describe('GroupDetail', () => {
  it('groups sessions by model with summed tokens', () => {
    render(<GroupDetail sessions={sessions} />);
    expect(screen.getByText('claude-opus-4-8')).toBeDefined();
    expect(screen.getByText('gpt-5.6-sol')).toBeDefined();
    // opus: (600k+100k+300k) + (400k+100k) = 1.5M summed across both sessions
    expect(screen.getByText('1.5M')).toBeDefined();
    expect(screen.getByText('200.0K')).toBeDefined();
  });

  it('defaults to the tokens metric and sorts descending by it', () => {
    render(<GroupDetail sessions={sessions} />);
    const names = screen.getAllByTestId('group-model-name').map(el => el.textContent);
    expect(names).toEqual(['claude-opus-4-8', 'gpt-5.6-sol']);
  });

  it('re-sorts when toggled to cost', () => {
    render(<GroupDetail sessions={sessions} />);
    fireEvent.click(screen.getByText('$'));
    const names = screen.getAllByTestId('group-model-name').map(el => el.textContent);
    // sol ($30) outranks opus ($20) by cost despite fewer tokens
    expect(names).toEqual(['gpt-5.6-sol', 'claude-opus-4-8']);
  });

  it('renders nothing model-related for an empty group', () => {
    const { container } = render(<GroupDetail sessions={[]} />);
    expect(container.querySelectorAll('[data-testid="group-model-name"]').length).toBe(0);
  });
});
