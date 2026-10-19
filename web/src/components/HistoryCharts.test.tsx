import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HistoryCharts from './HistoryCharts';

const now = Date.parse('2026-10-19T12:00:00Z');

describe('HistoryCharts', () => {
  it('renders temperature and humidity charts with the setpoint', () => {
    render(
      <HistoryCharts
        now={now}
        setpoint={20.5}
        readings={[
          { timestamp: '2026-10-19T11:00:00Z', temperature: 19, humidity: 44 },
          { timestamp: '2026-10-19T11:30:00Z', temperature: 19.5, humidity: 45 },
          { timestamp: '2026-10-17T11:30:00Z', temperature: 5, humidity: 5 },
          { timestamp: 'bad', temperature: 5, humidity: 5 },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Temperature' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Humidity' })).toBeInTheDocument();
    expect(screen.getByText('Latest 19.5°C')).toBeInTheDocument();
    expect(screen.getByText('Latest 45.0%')).toBeInTheDocument();
    expect(screen.getByTestId('reference')).toHaveTextContent('20.5');
  });

  it('handles no readings and no setpoint', () => {
    render(<HistoryCharts now={now} readings={[]} />);
    expect(screen.getAllByText('No data')).toHaveLength(2);
    expect(screen.queryByTestId('reference')).not.toBeInTheDocument();
  });
});
