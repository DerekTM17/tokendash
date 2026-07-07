import { describe, it, expect } from 'vitest';
import { formatCost, formatTokens, formatDuration, formatDate } from '../src/lib/format';

describe('formatCost', () => {
  it('formats dollars', () => { expect(formatCost(3.42)).toBe('$3.42'); });
  it('formats zero', () => { expect(formatCost(0)).toBe('$0.00'); });
});

describe('formatTokens', () => {
  it('formats millions', () => { expect(formatTokens(1200000)).toBe('1.2M'); });
  it('formats thousands', () => { expect(formatTokens(8200)).toBe('8.2K'); });
  it('formats small numbers', () => { expect(formatTokens(42)).toBe('42'); });
});

describe('formatDuration', () => {
  it('formats hours', () => { expect(formatDuration(3660)).toBe('1h 1m'); });
  it('formats minutes only', () => { expect(formatDuration(90)).toBe('1m'); });
  it('handles null', () => { expect(formatDuration(null)).toBe('—'); });
});

describe('formatDate', () => {
  it('formats ISO date', () => {
    expect(formatDate('2026-07-06T14:00:00Z')).toContain('Jul 6');
  });
  it('handles null', () => { expect(formatDate(null)).toBe('—'); });
});
