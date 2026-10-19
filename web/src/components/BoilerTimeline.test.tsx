import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BoilerTimeline from './BoilerTimeline';

const now = Date.parse('2026-10-19T12:00:00Z');

describe('BoilerTimeline', () => {
  it('says so when nothing is known', () => {
    render(<BoilerTimeline events={[]} now={now} />);
    expect(screen.getByText('No boiler changes recorded')).toBeInTheDocument();
  });

  it('draws on-segments and the total', () => {
    render(
      <BoilerTimeline
        now={now}
        events={[
          { timestamp: '2026-10-19T06:00:00Z', state: 'on' },
          { timestamp: '2026-10-19T08:00:00Z', state: 'off' },
          { timestamp: '2026-10-19T10:00:00Z', state: 'on' },
        ]}
      />,
    );
    expect(screen.getAllByTestId('on-segment')).toHaveLength(2);
    expect(screen.getByText('4h 00m')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/4h 00m/);
  });

  it('falls back to the current relay state', () => {
    render(<BoilerTimeline events={[]} currentOn now={now} />);
    expect(screen.getByText('24h 00m')).toBeInTheDocument();
  });
});
