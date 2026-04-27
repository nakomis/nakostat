import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('react-oidc-context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../config/config', () => ({
  __esModule: true,
  default: {
    env: 'sandbox',
    aws: { region: 'eu-west-2' },
    cognito: {
      authority: 'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_test',
      userPoolId: 'eu-west-2_test',
      userPoolClientId: 'test-client-id',
      cognitoDomain: 'login.sandbox.nakomis.com',
      redirectUri: 'http://localhost:3000/loggedin',
      logoutUri: 'http://localhost:3000/logout',
    },
    api: { apiUrl: 'http://localhost:3001' },
  },
}));

import { useAuth } from 'react-oidc-context';
import App from '../components/App';

const mockUseAuth = useAuth as jest.Mock;

describe('App', () => {
  test('shows loading state', () => {
    mockUseAuth.mockReturnValue({ isLoading: true, isAuthenticated: false, error: null });
    render(<App />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  test('shows error state', () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      error: { message: 'Auth failed' },
    });
    render(<App />);
    expect(screen.getByText(/Auth failed/)).toBeInTheDocument();
  });

  test('shows sign-in prompt when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      error: null,
      signinRedirect: jest.fn(),
    });
    render(<App />);
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.getByAltText('Nakostat logo')).toBeInTheDocument();
  });

  test('shows dashboard when authenticated', () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      error: null,
      removeUser: jest.fn(),
    });
    render(<App />);
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
