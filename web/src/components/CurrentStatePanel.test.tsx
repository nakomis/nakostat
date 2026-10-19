import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PiState } from '@/api/contract';
import CurrentStatePanel from './CurrentStatePanel';

const pi: PiState = {
  timestamp: '2026-10-19T10:00:00Z',
  temperature: 19.84,
  humidity: 45.2,
  mode: 'heat',
  setpoint: 20,
  demand: true,
};

describe('CurrentStatePanel', () => {
  it('shows a placeholder before the Pi reports', () => {
    render(<CurrentStatePanel pi={null} />);
    expect(screen.getByText(/No data/)).toBeInTheDocument();
  });

  it('renders temperature, humidity and heating', () => {
    render(<CurrentStatePanel pi={pi} />);
    expect(screen.getByText('19.8')).toBeInTheDocument();
    expect(screen.getByText('45.2')).toBeInTheDocument();
    expect(screen.getByText('Heating')).toBeInTheDocument();
    expect(screen.getByText(/Updated \d\d:\d\d/)).toBeInTheDocument();
  });

  it('shows idle and dashes for missing readings', () => {
    render(<CurrentStatePanel pi={{ ...pi, demand: false, temperature: null, humidity: null }} />);
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getAllByText('–')).toHaveLength(2);
  });
});
