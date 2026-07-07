import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProjectBreakdown from '../src/components/ProjectBreakdown';

const sessions = [
  { project: 'superpowers', cost: 10, inputTokens: 100000, outputTokens: 5000, cacheReadTokens: 20000, cacheWriteTokens: 5000 },
  { project: 'ledger', cost: 5, inputTokens: 50000, outputTokens: 2000, cacheReadTokens: 10000, cacheWriteTokens: 3000 },
  { project: 'superpowers', cost: 3, inputTokens: 30000, outputTokens: 1000, cacheReadTokens: 5000, cacheWriteTokens: 2000 },
];

describe('ProjectBreakdown', () => {
  it('shows project names', () => {
    render(<ProjectBreakdown sessions={sessions} />);
    expect(screen.getByText('superpowers')).toBeDefined();
    expect(screen.getByText('ledger')).toBeDefined();
  });

  it('shows aggregated cost for superpowers', () => {
    render(<ProjectBreakdown sessions={sessions} />);
    expect(screen.getByText('$13.00')).toBeDefined();
  });
});
