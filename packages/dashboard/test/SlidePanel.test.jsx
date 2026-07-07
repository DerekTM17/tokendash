import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SlidePanel from '../src/components/SlidePanel';

describe('SlidePanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SlidePanel open={false}><p>hidden</p></SlidePanel>);
    expect(container.firstChild).toBe(null);
  });

  it('renders children when open', () => {
    render(<SlidePanel open={true}><p>visible</p></SlidePanel>);
    expect(screen.getByText('visible')).toBeDefined();
  });
});
