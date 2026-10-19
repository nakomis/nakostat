import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard, { PENDING_TIMEOUT_MS, REFETCH_AFTER_WRITE_MS } from './Dashboard';

const fns = vi.hoisted(() => ({
  getState: vi.fn(),
  getReadings: vi.fn(),
  getBoilerUsage: vi.fn(),
  setpoint: vi.fn(),
  setMode: vi.fn(),
}));

vi.mock('@/api/client', () => {
  const q = (name: 'getState' | 'getReadings' | 'getBoilerUsage') => ({
    queryOptions: (o?: { input?: unknown }) => ({
      queryKey: [name, o?.input],
      queryFn: () => fns[name](o?.input),
    }),
  });
  const m = (name: 'setpoint' | 'setMode') => ({
    mutationOptions: (o: object) => ({ mutationFn: fns[name], ...o }),
  });
  return {
    orpc: {
      getState: q('getState'),
      getReadings: q('getReadings'),
      getBoilerUsage: q('getBoilerUsage'),
      setpoint: m('setpoint'),
      setMode: m('setMode'),
    },
  };
});

const now = new Date().toISOString();
const stateBody = (over: object = {}) => ({
  pi: {
    timestamp: now,
    temperature: 19.5,
    humidity: 44,
    mode: 'heat',
    setpoint: 20,
    scheduled_setpoint: 20,
    override: null,
    demand: true,
    ...over,
  },
  heatlink: { mode: 'auto', relay: true, switch: 'auto', seen: now },
  schedule: null,
});

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fns.getReadings.mockResolvedValue({ readings: [] });
    fns.getBoilerUsage.mockResolvedValue([]);
    fns.setpoint.mockResolvedValue({});
    fns.setMode.mockResolvedValue({});
  });

  it('renders every panel from /state', async () => {
    fns.getState.mockResolvedValue(stateBody());
    renderDashboard();
    expect(await screen.findByText('19.5')).toBeInTheDocument();
    expect(screen.getByText('Heatlink')).toBeInTheDocument();
    expect(screen.getByLabelText('Target temperature')).toHaveTextContent('20.0°');
    expect(screen.getByRole('img', { name: 'Temperature' })).toBeInTheDocument();
    expect(screen.getByText('Boiler, last 24 hours')).toBeInTheDocument();
  });

  it('asks for readings by time range, covering the last 24 hours', async () => {
    fns.getState.mockResolvedValue(stateBody());
    renderDashboard();
    await waitFor(() => expect(fns.getReadings).toHaveBeenCalled());
    const input = fns.getReadings.mock.calls[0][0] as { from?: string; limit?: number };
    expect(input.limit).toBeUndefined();
    const from = Date.parse(input.from ?? '');
    expect(Date.now() - from).toBeGreaterThanOrEqual(24 * 3600_000);
    expect(Date.now() - from).toBeLessThanOrEqual(26 * 3600_000);
  });

  it('shows an error when /state fails', async () => {
    fns.getState.mockRejectedValue(new Error('HTTP 500'));
    renderDashboard();
    expect(await screen.findByText(/Error: HTTP 500/)).toBeInTheDocument();
  });

  it('shows placeholders with no device data', async () => {
    fns.getState.mockResolvedValue({ pi: null, heatlink: null, schedule: null });
    renderDashboard();
    expect(await screen.findByText(/No data from the thermostat/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Target temperature')).not.toBeInTheDocument();
  });

  it('posts a mode change, shows it optimistically, then refetches', async () => {
    fns.getState.mockResolvedValueOnce(stateBody());
    fns.getState.mockResolvedValue(stateBody({ mode: 'off', setpoint: 7 }));
    renderDashboard();
    await screen.findByText('19.5');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.click(screen.getByRole('button', { name: /Off/ }));
      await waitFor(() =>
        expect(fns.setMode).toHaveBeenCalledWith({ mode: 'off' }, expect.anything()),
      );
      expect(screen.getByRole('button', { name: /Off/ })).toHaveAttribute('aria-pressed', 'true');
      const callsBefore = fns.getState.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFETCH_AFTER_WRITE_MS + 100);
      });
      expect(fns.getState.mock.calls.length).toBeGreaterThan(callsBefore);
      await waitFor(() => expect(screen.getByText(/frost protection/)).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts a debounced setpoint', async () => {
    fns.getState.mockResolvedValue(stateBody());
    renderDashboard();
    await screen.findByText('19.5');
    await userEvent.click(screen.getByRole('button', { name: 'Increase setpoint' }));
    await waitFor(
      () => expect(fns.setpoint).toHaveBeenCalledWith({ temperature: 20.5 }, expect.anything()),
      { timeout: 2500 },
    );
    expect(screen.getByLabelText('Target temperature')).toHaveTextContent('20.5°');
  });

  it('reports a failed write and reverts', async () => {
    fns.getState.mockResolvedValue(stateBody());
    fns.setMode.mockRejectedValue(new Error('HTTP 403'));
    renderDashboard();
    await screen.findByText('19.5');
    await userEvent.click(screen.getByRole('button', { name: /Off/ }));
    expect(await screen.findByText(/Could not send that change: HTTP 403/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Heat/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Dashboard pending values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fns.getReadings.mockResolvedValue({ readings: [] });
    fns.getBoilerUsage.mockResolvedValue([]);
    fns.setpoint.mockResolvedValue({});
  });

  it('keeps the pending setpoint until /state agrees, refetching every 3 s', async () => {
    fns.getState.mockResolvedValueOnce(stateBody());
    // The daemon is slow: two stale answers, then agreement.
    fns.getState.mockResolvedValueOnce(stateBody());
    fns.getState.mockResolvedValueOnce(stateBody());
    fns.getState.mockResolvedValue(stateBody({ setpoint: 20.5 }));
    renderDashboard();
    await screen.findByText('19.5');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Increase setpoint' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000 + 50); // debounce
      });
      expect(fns.setpoint).toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFETCH_AFTER_WRITE_MS + 50);
      });
      // First refetch still shows the old value: the pending 20.5 must not flash back to 20.0.
      expect(screen.getByLabelText('Target temperature')).toHaveTextContent('20.5°');
      expect(screen.getByText('Waiting for the thermostat…')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * REFETCH_AFTER_WRITE_MS + 50);
      });
      expect(screen.getByLabelText('Target temperature')).toHaveTextContent('20.5°');
      expect(screen.queryByText('Waiting for the thermostat…')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a pending setpoint after the timeout', async () => {
    fns.getState.mockResolvedValue(stateBody());
    renderDashboard();
    await screen.findByText('19.5');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Increase setpoint' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000 + PENDING_TIMEOUT_MS + 3 * REFETCH_AFTER_WRITE_MS);
      });
      expect(screen.getByLabelText('Target temperature')).toHaveTextContent('20.0°');
    } finally {
      vi.useRealTimers();
    }
  });
});
