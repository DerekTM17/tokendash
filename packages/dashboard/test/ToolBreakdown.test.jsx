import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ToolBreakdown from '../src/components/ToolBreakdown';

const sessions = [
  { tool: 'claude', cost: 10, inputTokens: 100000, outputTokens: 5000, cacheReadTokens: 20000, cacheWriteTokens: 5000 },
  { tool: 'claude', cost: 5, inputTokens: 50000, outputTokens: 2000, cacheReadTokens: 10000, cacheWriteTokens: 3000 },
  { tool: 'opencode', cost: 8, inputTokens: 80000, outputTokens: 4000, cacheReadTokens: 15000, cacheWriteTokens: 4000 },
  { tool: 'codex', cost: 2, inputTokens: 20000, outputTokens: 1000, cacheReadTokens: 5000, cacheWriteTokens: 1000 },
];

describe('ToolBreakdown', () => {
  it('shows tool names', () => {
    render(<ToolBreakdown sessions={sessions} />);
    expect(screen.getByText('claude')).toBeDefined();
    expect(screen.getByText('opencode')).toBeDefined();
    expect(screen.getByText('codex')).toBeDefined();
  });

  it('shows aggregated cost for claude', () => {
    render(<ToolBreakdown sessions={sessions} />);
    expect(screen.getByText('$15.00')).toBeDefined();
  });
});
