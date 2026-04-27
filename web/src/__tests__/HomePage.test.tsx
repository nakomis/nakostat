import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../config/config', () => ({
  __esModule: true,
  default: {
    env: 'sandbox',
    aws: { region: 'eu-west-2' },
    cognito: {},
    api: { apiUrl: 'http://localhost:3001' },
  },
}));

beforeEach(() => {
  global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
});

import HomePage from '../components/pages/HomePage';

test('renders dashboard heading', () => {
  render(<HomePage />);
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
});
