import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

describe('App', () => {
  it('renders the title', () => {
    render(<App />);
    expect(screen.getByText('TOKENDASH')).toBeDefined();
  });

  it('shows date filter buttons', () => {
    render(<App />);
    expect(screen.getByText('All')).toBeDefined();
  });
});
