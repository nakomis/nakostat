import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetpointControl, { SETPOINT_DEBOUNCE_MS } from './SetpointControl';

describe('SetpointControl', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('shows the setpoint and the override end', () => {
    render(
      <SetpointControl
        setpoint={21}
        mode="heat"
        scheduled={19}
        override={{ setpoint: 21, until: '2026-10-19T12:00:00Z' }}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Target temperature')).toHaveTextContent('21.0°');
    expect(screen.getByText(/Override until \d\d:\d\d/)).toBeInTheDocument();
    expect(screen.getByText(/schedule: 19.0°/)).toBeInTheDocument();
  });

  it('says it is following the schedule', () => {
    render(<SetpointControl setpoint={19} mode="heat" scheduled={19} onCommit={vi.fn()} />);
    expect(screen.getByText('Following the schedule')).toBeInTheDocument();
  });

  it('debounces multiple presses into one commit', async () => {
    const onCommit = vi.fn();
    render(<SetpointControl setpoint={20} mode="heat" onCommit={onCommit} />);
    const up = screen.getByRole('button', { name: 'Increase setpoint' });
    await userEvent.click(up);
    await userEvent.click(up);
    await userEvent.click(up);
    expect(screen.getByLabelText('Target temperature')).toHaveTextContent('21.5°');
    expect(screen.getByText('Updating…')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SETPOINT_DEBOUNCE_MS);
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(21.5);
  });

  it('decreases', async () => {
    const onCommit = vi.fn();
    render(<SetpointControl setpoint={20} mode="heat" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Decrease setpoint' }));
    act(() => {
      vi.advanceTimersByTime(SETPOINT_DEBOUNCE_MS);
    });
    expect(onCommit).toHaveBeenCalledWith(19.5);
  });

  it('clamps at the limits', () => {
    const { rerender } = render(<SetpointControl setpoint={30} mode="heat" onCommit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Increase setpoint' })).toBeDisabled();
    rerender(<SetpointControl setpoint={5} mode="heat" onCommit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Decrease setpoint' })).toBeDisabled();
  });

  it('disables the buttons when heating is off', () => {
    render(<SetpointControl setpoint={7} mode="off" onCommit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Increase setpoint' })).toBeDisabled();
    expect(screen.getByText(/frost protection/)).toBeInTheDocument();
  });

  it('shows a pending message', () => {
    render(<SetpointControl setpoint={21} mode="heat" pending onCommit={vi.fn()} />);
    expect(screen.getByText('Waiting for the thermostat…')).toBeInTheDocument();
  });
});
