import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CurrentStatePanel from '../components/CurrentStatePanel';

const TEST_API_URL = 'http://localhost:3001';

describe('CurrentStatePanel', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('shows loading spinner initially', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
    render(<CurrentStatePanel apiUrl={TEST_API_URL} />);
    expect(document.querySelector('svg')).toBeInTheDocument(); // CircularProgress renders an SVG
  });

  test('shows boiler status after successful fetch', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ deviceId: 'esp32', boilerActive: true, setpoint: 21, mode: 'auto', updatedAt: '2024-01-01T10:00:00.000Z' }),
      })
    ) as jest.Mock;
    render(<CurrentStatePanel apiUrl={TEST_API_URL} />);
    await waitFor(() => expect(screen.getByText('Boiler On')).toBeInTheDocument());
  });

  test('shows setpoint after successful fetch', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ deviceId: 'esp32', boilerActive: false, setpoint: 20 }),
      })
    ) as jest.Mock;
    render(<CurrentStatePanel apiUrl={TEST_API_URL} />);
    await waitFor(() => expect(screen.getByText(/20°C/)).toBeInTheDocument());
  });

  test('shows error message when fetch fails', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network error'))) as jest.Mock;
    render(<CurrentStatePanel apiUrl={TEST_API_URL} />);
    await waitFor(() => expect(screen.getByText(/Network error/)).toBeInTheDocument());
  });

  test('shows error message on non-OK HTTP response', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 404 })
    ) as jest.Mock;
    render(<CurrentStatePanel apiUrl={TEST_API_URL} />);
    await waitFor(() => expect(screen.getByText(/HTTP 404/)).toBeInTheDocument());
  });
});
