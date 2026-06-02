import { createApiClient } from '../services/api';

const BASE = 'http://localhost:3001';

describe('createApiClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('getState fetches /state and returns the parsed state', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ deviceId: 'esp32', boilerActive: true, setpoint: 21, mode: 'auto', updatedAt: '2024-01-01T10:00:00.000Z' }),
      })
    ) as jest.Mock;

    const state = await createApiClient(BASE).getState();

    expect(state.deviceId).toBe('esp32');
    expect(state.boilerActive).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/state`, { headers: {} });
  });

  test('sends a Bearer Authorization header when a token is provided', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ deviceId: 'esp32' }) })
    ) as jest.Mock;

    await createApiClient(BASE, 'abc123').getState();

    expect(global.fetch).toHaveBeenCalledWith(`${BASE}/state`, {
      headers: { Authorization: 'Bearer abc123' },
    });
  });

  test('rejects on a non-OK HTTP response', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 })) as jest.Mock;
    await expect(createApiClient(BASE).getState()).rejects.toThrow('HTTP 404');
  });

  test('rejects when the response does not match the schema', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ boilerActive: 'yes please' }) })
    ) as jest.Mock;
    await expect(createApiClient(BASE).getState()).rejects.toThrow();
  });
});
