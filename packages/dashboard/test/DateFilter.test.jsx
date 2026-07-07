import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DateFilter, { filterSessions } from '../src/components/DateFilter';

describe('filterSessions', () => {
  it('returns all sessions for "all" range', () => {
    const sessions = [{ startedAt: '2025-01-01T00:00:00Z' }];
    expect(filterSessions(sessions, 'all')).toHaveLength(1);
  });

  it('filters by 7 days', () => {
    const today = new Date().toISOString();
    const old = '2025-01-01T00:00:00Z';
    const sessions = [{ startedAt: today }, { startedAt: old }];
    expect(filterSessions(sessions, '7d')).toHaveLength(1);
  });
});

describe('DateFilter', () => {
  it('renders all options', () => {
    render(<DateFilter onChange={() => {}} />);
    expect(screen.getByText('All time')).toBeDefined();
    expect(screen.getByText('Last 7 days')).toBeDefined();
    expect(screen.getByText('Last 30 days')).toBeDefined();
  });
});
