import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('react-oidc-context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../config/config', () => ({
  __esModule: true,
  default: {
    env: 'sandbox',
    aws: { region: 'eu-west-2' },
    cognito: {},
    api: { apiUrl: 'http://localhost:3001' },
  },
}));

import { useAuth } from 'react-oidc-context';
import HomePage from '../components/pages/HomePage';

const mockUseAuth = useAuth as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
  mockUseAuth.mockReturnValue({ user: { access_token: 'test-token' } });
});

test('renders dashboard heading', () => {
  render(<HomePage />);
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
});

test('fetches state with the access token from the auth session', async () => {
  render(<HomePage />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenCalledWith(
    'http://localhost:3001/state',
    { headers: { Authorization: 'Bearer test-token' } },
  );
});
