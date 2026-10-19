import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySchedule } from '@/lib/schedule';
import ScheduleEditor from './ScheduleEditor';

const fns = vi.hoisted(() => ({ getState: vi.fn(), putSchedule: vi.fn() }));

vi.mock('@/api/client', () => ({
  orpc: {
    getState: { queryOptions: () => ({ queryKey: ['state'], queryFn: fns.getState }) },
    putSchedule: { mutationOptions: (o: object) => ({ mutationFn: fns.putSchedule, ...o }) },
  },
}));

const serverSchedule = () => {
  const s = emptySchedule();
  s.Mon = [
    { at: '06:30', targetC: 20 },
    { at: '22:00', targetC: 16 },
  ];
  return s;
};

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScheduleEditor />
    </QueryClientProvider>,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Save schedule' });

describe('ScheduleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fns.putSchedule.mockResolvedValue({});
    fns.getState.mockResolvedValue({
      pi: null,
      heatlink: null,
      schedule: { schedule: serverSchedule(), timestamp: 't' },
    });
  });

  it('shows an error when /state fails', async () => {
    fns.getState.mockRejectedValue(new Error('HTTP 500'));
    renderEditor();
    expect(await screen.findByText(/Error: HTTP 500/)).toBeInTheDocument();
  });

  it('loads the week and starts clean', async () => {
    renderEditor();
    expect(await screen.findByLabelText('Monday change 1 time')).toHaveValue('06:30');
    expect(screen.getByLabelText('Monday change 2 temperature')).toHaveValue(16);
    expect(screen.getAllByText('No changes')).toHaveLength(6);
    expect(saveButton()).toBeDisabled();
  });

  it('notes when no schedule has been reported', async () => {
    fns.getState.mockResolvedValue({ pi: null, heatlink: null, schedule: null });
    renderEditor();
    expect(await screen.findByText(/has not reported a schedule/)).toBeInTheDocument();
  });

  it('saves edits sorted, via PUT', async () => {
    renderEditor();
    await screen.findByLabelText('Monday change 1 time');
    await userEvent.click(screen.getByRole('button', { name: 'Add change on Tuesday' }));
    fireEvent.change(screen.getByLabelText('Tuesday change 1 time'), {
      target: { value: '05:00' },
    });
    fireEvent.change(screen.getByLabelText('Monday change 1 temperature'), {
      target: { value: '21.5' },
    });
    expect(saveButton()).toBeEnabled();
    await userEvent.click(saveButton());
    expect(fns.putSchedule).toHaveBeenCalledOnce();
    const sent = fns.putSchedule.mock.calls[0][0].schedule;
    expect(sent.Mon[0]).toEqual({ at: '06:30', targetC: 21.5 });
    expect(sent.Tue).toEqual([{ at: '05:00', targetC: 20 }]);
    expect(await screen.findByRole('status')).toHaveTextContent(/Saved/);
    expect(saveButton()).toBeDisabled();
  });

  it('removes a change', async () => {
    renderEditor();
    await screen.findByLabelText('Monday change 1 time');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Monday change 1' }));
    expect(screen.queryByLabelText('Monday change 2 time')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Monday change 1 time')).toHaveValue('22:00');
  });

  it('blocks saving invalid input and explains why', async () => {
    renderEditor();
    await screen.findByLabelText('Monday change 1 time');
    fireEvent.change(screen.getByLabelText('Monday change 1 temperature'), {
      target: { value: '99' },
    });
    expect(screen.getByText(/5–30/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Monday change 1 temperature'), {
      target: { value: '' },
    });
    expect(saveButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Monday change 1 temperature'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByLabelText('Monday change 2 time'), { target: { value: '06:30' } });
    expect(screen.getByText(/same time/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('caps a day at 8 changes', async () => {
    renderEditor();
    await screen.findByLabelText('Monday change 1 time');
    const add = screen.getByRole('button', { name: 'Add change on Monday' });
    for (let i = 0; i < 6; i++) await userEvent.click(add);
    expect(add).toBeDisabled();
    const monday = screen.getByText('Monday').closest('[data-slot="card"]') as HTMLElement;
    expect(within(monday).getAllByLabelText(/temperature$/)).toHaveLength(8);
  });

  it('discards edits', async () => {
    renderEditor();
    await screen.findByLabelText('Monday change 1 time');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Monday change 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Monday change 1 time')).toHaveValue('06:30');
  });

  it('shows a save failure', async () => {
    fns.putSchedule.mockRejectedValue(new Error('HTTP 502'));
    renderEditor();
    await screen.findByLabelText('Monday change 1 time');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Monday change 1' }));
    await userEvent.click(saveButton());
    expect(await screen.findByText(/Could not save: HTTP 502/)).toBeInTheDocument();
  });
});
