import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CurrentStatePanel from '../components/CurrentStatePanel';
import { NakostatApi, ThermostatState } from '../services/api';

function fakeApi(getState: () => Promise<ThermostatState>): NakostatApi {
  return { getState };
}

describe('CurrentStatePanel', () => {
  test('shows loading spinner initially', () => {
    render(<CurrentStatePanel api={fakeApi(() => new Promise(() => {}))} />);
    expect(document.querySelector('svg')).toBeInTheDocument(); // CircularProgress renders an SVG
  });

  test('shows boiler status after a successful fetch', async () => {
    const api = fakeApi(() =>
      Promise.resolve({ deviceId: 'esp32', boilerActive: true, setpoint: 21, mode: 'auto', updatedAt: '2024-01-01T10:00:00.000Z' })
    );
    render(<CurrentStatePanel api={api} />);
    await waitFor(() => expect(screen.getByText('Boiler On')).toBeInTheDocument());
  });

  test('shows the setpoint after a successful fetch', async () => {
    const api = fakeApi(() => Promise.resolve({ deviceId: 'esp32', boilerActive: false, setpoint: 20 }));
    render(<CurrentStatePanel api={api} />);
    await waitFor(() => expect(screen.getByText(/20°C/)).toBeInTheDocument());
  });

  test('shows an error message when the request fails', async () => {
    const api = fakeApi(() => Promise.reject(new Error('Network error')));
    render(<CurrentStatePanel api={api} />);
    await waitFor(() => expect(screen.getByText(/Network error/)).toBeInTheDocument());
  });
});
