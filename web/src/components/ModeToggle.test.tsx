import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ModeToggle from './ModeToggle';

describe('ModeToggle', () => {
  it('marks the active mode', () => {
    render(<ModeToggle mode="heat" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Heat/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Off/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to off', async () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="heat" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Off/ }));
    expect(onChange).toHaveBeenCalledWith('off');
  });

  it('switches to heat, and ignores clicking the active mode', async () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="off" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Off/ }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Heat/ }));
    expect(onChange).toHaveBeenCalledWith('heat');
  });

  it('disables whilst pending', () => {
    render(<ModeToggle mode="heat" pending onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Off/ })).toBeDisabled();
  });
});
