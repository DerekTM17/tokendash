import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InfoTip from '../src/components/InfoTip';

describe('InfoTip', () => {
  it('labels its trigger with the term, so a screen reader says what it explains', () => {
    render(<InfoTip term="cache read" />);
    expect(screen.getByRole('button', { name: /cache read/i })).toBeDefined();
  });

  it('keeps the definition out of the way until asked', () => {
    render(<InfoTip term="cache read" />);
    expect(screen.queryByRole('tooltip')).toBe(null);
  });

  it('reveals the definition on hover', () => {
    render(<InfoTip term="cache read" />);
    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').textContent).toMatch(/already seen/i);
  });

  it('reveals the definition on keyboard focus, not just hover', () => {
    render(<InfoTip term="burn rate" />);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').textContent).toMatch(/per calendar day/i);
  });

  it('hides again when the pointer leaves', () => {
    render(<InfoTip term="cache read" />);
    const btn = screen.getByRole('button');
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole('tooltip')).toBe(null);
  });

  it('closes on Escape while focused', () => {
    render(<InfoTip term="cache read" />);
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBe(null);
  });

  it('shows the term title above the definition', () => {
    render(<InfoTip term="cache write" />);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').textContent).toMatch(/^Cache write/);
  });

  it('escapes an ancestor that clips its overflow', () => {
    // SummaryCards draws each card with overflow:hidden for its glow effect, so
    // a tooltip rendered inside the card is cut off at the card's edge. The
    // tooltip must live outside that subtree entirely.
    const { container } = render(
      <div data-testid="clipper" style={{ overflow: 'hidden' }}>
        <InfoTip term="cache read" />
      </div>
    );
    fireEvent.focus(screen.getByRole('button'));
    const clipper = container.querySelector('[data-testid="clipper"]');
    expect(clipper.contains(screen.getByRole('tooltip'))).toBe(false);
  });

  it('renders nothing for a term with no definition', () => {
    const { container } = render(<InfoTip term="flux capacitor" />);
    expect(container.firstChild).toBe(null);
  });
});
