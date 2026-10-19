import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { orpc } from '@/api/client';
import BoilerTimeline from '@/components/BoilerTimeline';
import CurrentStatePanel from '@/components/CurrentStatePanel';
import HeatlinkPanel from '@/components/HeatlinkPanel';
import HistoryCharts from '@/components/HistoryCharts';
import ModeToggle from '@/components/ModeToggle';
import SetpointControl from '@/components/SetpointControl';
import { Spinner } from '@/components/ui/spinner';
import { useNow } from '@/hooks/useNow';

/** The daemon applies changes asynchronously; refetch this long after a write. */
export const REFETCH_AFTER_WRITE_MS = 3000;
const STATE_POLL_MS = 30_000;
const HISTORY_POLL_MS = 5 * 60_000;
const HOUR_MS = 3600_000;

interface Pending {
  setpoint?: number;
  mode?: 'heat' | 'off';
}

/** Signed-in landing page: live state, controls and 24 h history. */
function Dashboard() {
  const now = useNow();

  const state = useQuery({ ...orpc.getState.queryOptions(), refetchInterval: STATE_POLL_MS });
  const readings = useQuery({
    ...orpc.getReadings.queryOptions({ input: { limit: 500 } }),
    refetchInterval: HISTORY_POLL_MS,
  });
  // Fetch from the previous whole hour so the query key is stable between renders.
  const usageFrom = useMemo(
    () => new Date(Math.floor((now - 25 * HOUR_MS) / HOUR_MS) * HOUR_MS).toISOString(),
    [now],
  );
  const usage = useQuery({
    ...orpc.getBoilerUsage.queryOptions({ input: { from: usageFrom } }),
    refetchInterval: HISTORY_POLL_MS,
  });

  const [pending, setPending] = useState<Pending>({});
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of t) clearTimeout(id);
    };
  }, []);

  const { refetch } = state;
  const settle = useCallback(
    (key: keyof Pending) => {
      const id = setTimeout(async () => {
        timers.current.delete(id);
        await refetch();
        setPending((p) => ({ ...p, [key]: undefined }));
      }, REFETCH_AFTER_WRITE_MS);
      timers.current.add(id);
    },
    [refetch],
  );

  const setpointMutation = useMutation(
    orpc.setpoint.mutationOptions({
      onSuccess: () => settle('setpoint'),
      onError: () => setPending((p) => ({ ...p, setpoint: undefined })),
    }),
  );
  const modeMutation = useMutation(
    orpc.setMode.mutationOptions({
      onSuccess: () => settle('mode'),
      onError: () => setPending((p) => ({ ...p, mode: undefined })),
    }),
  );

  const commitSetpoint = (temperature: number) => {
    setPending((p) => ({ ...p, setpoint: temperature }));
    setpointMutation.mutate({ temperature });
  };
  const changeMode = (mode: 'heat' | 'off') => {
    setPending((p) => ({ ...p, mode }));
    modeMutation.mutate({ mode });
  };

  const pi = state.data?.pi ?? null;
  const heatlink = state.data?.heatlink ?? null;
  const mode = pending.mode ?? pi?.mode ?? 'heat';
  const setpoint = pending.setpoint ?? pi?.setpoint;
  const writeError = setpointMutation.error ?? modeMutation.error;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      {state.isLoading && <Spinner className="text-muted-foreground" />}
      {state.isError && (
        <p role="alert" className="text-destructive text-sm">
          Error: {state.error.message}
        </p>
      )}
      {writeError && (
        <p role="alert" className="text-destructive text-sm">
          Could not send that change: {writeError.message}
        </p>
      )}

      {state.data && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <CurrentStatePanel pi={pi} />
            <HeatlinkPanel status={heatlink} now={now} />
            {pi && setpoint !== undefined && (
              <SetpointControl
                setpoint={setpoint}
                mode={mode}
                scheduled={pi.scheduled_setpoint}
                override={pi.override}
                pending={pending.setpoint !== undefined || pending.mode !== undefined}
                onCommit={commitSetpoint}
              />
            )}
            {pi && (
              <ModeToggle
                mode={mode}
                pending={modeMutation.isPending || pending.mode !== undefined}
                onChange={changeMode}
              />
            )}
          </div>
          <HistoryCharts
            readings={readings.data?.readings ?? []}
            setpoint={pi?.setpoint}
            now={now}
          />
          <BoilerTimeline events={usage.data ?? []} currentOn={heatlink?.relay} now={now} />
        </>
      )}
    </main>
  );
}

export default Dashboard;
