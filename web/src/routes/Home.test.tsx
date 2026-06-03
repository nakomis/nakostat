import { render, screen } from '@testing-library/react';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Home from './Home';

vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);

function authState(overrides: Record<string, unknown>) {
  return {
    isLoading: false,
    isAuthenticated: false,
    error: undefined,
    signinRedirect: vi.fn(),
    removeUser: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAuth>;
}

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading state', () => {
    mockUseAuth.mockReturnValue(authState({ isLoading: true }));
    render(<Home />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it('shows an error message', () => {
    mockUseAuth.mockReturnValue(authState({ error: new Error('boom') }));
    render(<Home />);
    expect(screen.getByText(/Error: boom/)).toBeInTheDocument();
  });

  it('shows the sign-in screen when unauthenticated', () => {
    mockUseAuth.mockReturnValue(authState({ isAuthenticated: false }));
    render(<Home />);
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeInTheDocument();
  });

  it('shows the dashboard when authenticated', () => {
    mockUseAuth.mockReturnValue(authState({ isAuthenticated: true }));
    render(<Home />);
    expect(screen.getByRole('heading', { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
  });
});
