import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SummaryCards from '../src/components/SummaryCards';

const sampleTotals = { cost: 42.18, tokens: 1200000, sessions: 47 };

describe('SummaryCards', () => {
  it('renders three cards', () => {
    render(<SummaryCards totals={sampleTotals} />);
    expect(screen.getByText('total cost')).toBeDefined();
    expect(screen.getByText('tokens')).toBeDefined();
    expect(screen.getByText('sessions')).toBeDefined();
  });

  it('displays formatted values', () => {
    render(<SummaryCards totals={sampleTotals} />);
    expect(screen.getByText('$42.18')).toBeDefined();
    expect(screen.getByText('1.2M')).toBeDefined();
    expect(screen.getByText('47')).toBeDefined();
  });

  it('renders empty state', () => {
    render(<SummaryCards totals={null} />);
    expect(screen.queryByText('$')).toBe(null);
  });
});
