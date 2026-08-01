import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToggleButton from '../src/components/ToggleButton';

describe('ToggleButton', () => {
  it('renders its label', () => {
    render(<ToggleButton active={false} onClick={() => {}}>Tokens</ToggleButton>);
    expect(screen.getByText('Tokens')).toBeTruthy();
  });

  it('calls onClick when pressed', () => {
    const onClick = vi.fn();
    render(<ToggleButton active={false} onClick={onClick}>Cost</ToggleButton>);
    fireEvent.click(screen.getByText('Cost'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('styles the active state differently from the inactive one', () => {
    const { container: activeC } = render(<ToggleButton active onClick={() => {}}>A</ToggleButton>);
    const { container: idleC } = render(<ToggleButton active={false} onClick={() => {}}>B</ToggleButton>);
    const activeBg = activeC.querySelector('button').style.background;
    const idleBg = idleC.querySelector('button').style.background;
    expect(activeBg).not.toBe(idleBg);
  });
});
