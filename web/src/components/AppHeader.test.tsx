import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppHeader from './AppHeader';

describe('AppHeader', () => {
  it('calls onSignOut when the button is clicked', async () => {
    const onSignOut = vi.fn();
    render(<AppHeader onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe('AppHeader nav', () => {
  it('renders navigation links', () => {
    render(<AppHeader onSignOut={vi.fn()} nav={<a href="/schedule">Schedule</a>} />);
    expect(screen.getByRole('navigation', { name: 'Main' })).toContainElement(
      screen.getByRole('link', { name: 'Schedule' }),
    );
  });
});
