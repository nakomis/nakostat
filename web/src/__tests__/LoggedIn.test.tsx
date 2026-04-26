import React from 'react';
import { render } from '@testing-library/react';

jest.mock('react-oidc-context', () => ({
  useAuth: jest.fn(),
}));

import { useAuth } from 'react-oidc-context';
import LoggedIn from '../components/LoggedIn';

const mockUseAuth = useAuth as jest.Mock;

const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '/' },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

test('redirects to / when authenticated', () => {
  mockUseAuth.mockReturnValue({ isAuthenticated: true });
  render(<LoggedIn />);
  expect(window.location.href).toBe('/');
});

test('renders without redirect when not authenticated', () => {
  mockUseAuth.mockReturnValue({ isAuthenticated: false });
  render(<LoggedIn />);
  expect(window.location.href).toBe('/');
});
