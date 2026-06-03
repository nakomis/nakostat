import { useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CurrentStatePanel from './CurrentStatePanel';

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: vi.fn(),
}));
const mockUseQuery = vi.mocked(useQuery);

function queryResult(overrides: Record<string, unknown>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useQuery>;
}

describe('CurrentStatePanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a spinner whilst loading', () => {
    mockUseQuery.mockReturnValue(queryResult({ isLoading: true }));
    render(<CurrentStatePanel />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an error message on failure', () => {
    mockUseQuery.mockReturnValue(queryResult({ isError: true, error: new Error('HTTP 500') }));
    render(<CurrentStatePanel />);
    expect(screen.getByText(/Error: HTTP 500/)).toBeInTheDocument();
  });

  it('renders boiler on, setpoint and mode', () => {
    mockUseQuery.mockReturnValue(
      queryResult({
        data: {
          deviceId: 'esp32',
          boilerActive: true,
          setpoint: 20,
          mode: 'auto',
          updatedAt: '2026-06-03T20:00:00Z',
        },
      }),
    );
    render(<CurrentStatePanel />);
    expect(screen.getByText('Boiler On')).toBeInTheDocument();
    expect(screen.getByText('Setpoint: 20°C')).toBeInTheDocument();
    expect(screen.getByText('Mode: auto')).toBeInTheDocument();
    expect(screen.getByText(/Updated:/)).toBeInTheDocument();
  });

  it('renders boiler off when inactive', () => {
    mockUseQuery.mockReturnValue(queryResult({ data: { deviceId: 'esp32', boilerActive: false } }));
    render(<CurrentStatePanel />);
    expect(screen.getByText('Boiler Off')).toBeInTheDocument();
  });

  it('shows "No data" when the query resolves empty', () => {
    mockUseQuery.mockReturnValue(queryResult({ data: undefined }));
    render(<CurrentStatePanel />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });
});
