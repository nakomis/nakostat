import { render, screen } from '@testing-library/react';
import { useAuth } from 'react-oidc-context';
import { describe, expect, it, vi } from 'vitest';
import Schedule from './Schedule';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));
vi.mock('@/components/ScheduleEditor', () => ({ default: () => <h1>Schedule editor</h1> }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const auth = (o: object) =>
  ({ isLoading: false, isAuthenticated: false, ...o }) as ReturnType<typeof useAuth>;

describe('Schedule route', () => {
  it('asks unauthenticated users to sign in', () => {
    vi.mocked(useAuth).mockReturnValue(auth({}));
    render(<Schedule />);
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeInTheDocument();
  });

  it('shows the editor with navigation when signed in', () => {
    vi.mocked(useAuth).mockReturnValue(auth({ isAuthenticated: true }));
    render(<Schedule />);
    expect(screen.getByText('Schedule editor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/schedule');
  });
});
