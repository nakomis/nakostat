import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LineChart from './LineChart';

const T0 = Date.parse('2026-10-19T00:00:00Z');
const props = { title: 'Temperature', unit: '°C', colour: 'red', from: T0, to: T0 + 3600_000 };

describe('LineChart', () => {
  it('says when there is no data', () => {
    render(<LineChart {...props} points={[]} />);
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Temperature' })).toBeInTheDocument();
  });

  it('draws a line and shows the latest value', () => {
    const { container } = render(
      <LineChart
        {...props}
        points={[
          { t: T0 + 1000, v: 19 },
          { t: T0 + 600_000, v: 20 },
        ]}
      />,
    );
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(screen.getByText('Latest 20.0°C')).toBeInTheDocument();
  });

  it('draws a dot for an isolated point and breaks the line on gaps', () => {
    const { container } = render(
      <LineChart
        {...props}
        points={[
          { t: T0, v: 19 },
          { t: T0 + 60_000, v: 19 },
          { t: T0 + 3000_000, v: 21 },
        ]}
      />,
    );
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  it('draws the reference line', () => {
    render(<LineChart {...props} points={[]} reference={{ value: 21, label: 'Setpoint' }} />);
    expect(screen.getByTestId('reference')).toHaveTextContent('Setpoint 21.0°C');
  });

  it('shows a crosshair readout on hover', () => {
    render(
      <LineChart
        {...props}
        points={[
          { t: T0, v: 19 },
          { t: T0 + 3600_000, v: 22 },
        ]}
      />,
    );
    const svg = screen.getByRole('img');
    svg.getBoundingClientRect = () => ({ left: 0, width: 640, top: 0, height: 200 }) as DOMRect;
    fireEvent.mouseMove(svg, { clientX: 630 });
    expect(screen.getByTestId('crosshair')).toBeInTheDocument();
    expect(screen.getByText(/22.0°C/)).toBeInTheDocument();
    fireEvent.mouseLeave(svg);
    expect(screen.queryByTestId('crosshair')).not.toBeInTheDocument();
  });

  it('ignores hover when the svg has no size', () => {
    render(<LineChart {...props} points={[{ t: T0, v: 19 }]} />);
    fireEvent.mouseMove(screen.getByRole('img'), { clientX: 10 });
    expect(screen.queryByTestId('crosshair')).not.toBeInTheDocument();
  });
});
