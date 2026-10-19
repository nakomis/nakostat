import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { orpc } from '@/api/client';
import {
  DAYS,
  type Day,
  MAX_SETPOINT,
  MAX_TRANSITIONS_PER_DAY,
  MIN_SETPOINT,
  type Schedule,
  type ScheduleEntry,
} from '@/api/contract';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  emptySchedule,
  hasErrors,
  nextEntry,
  normaliseSchedule,
  scheduleEquals,
  validateSchedule,
} from '@/lib/schedule';

const REFETCH_AFTER_SAVE_MS = 3000;

const FULL_NAME: Record<Day, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

/** Week view of heating transitions: edit, add, remove, validate, save with PUT /schedule. */
function ScheduleEditor() {
  const state = useQuery(orpc.getState.queryOptions());
  const { refetch } = state;
  const server = state.data?.schedule?.schedule;

  const [baseline, setBaseline] = useState<Schedule>(emptySchedule);
  const [draft, setDraft] = useState<Schedule>(emptySchedule);
  const [saved, setSaved] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  // Adopt the server's schedule whenever it changes and there are no unsaved edits.
  const serverKey = server ? JSON.stringify(server) : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: serverKey stands in for server
  useEffect(() => {
    if (!server) return;
    if (scheduleEquals(draftRef.current, baselineRef.current)) {
      setDraft(structuredClone(server));
    }
    setBaseline(structuredClone(server));
  }, [serverKey]);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = useMutation(
    orpc.putSchedule.mutationOptions({
      onSuccess: (_data, vars) => {
        setBaseline(structuredClone(vars.schedule));
        setSaved(true);
        timer.current = setTimeout(() => void refetch(), REFETCH_AFTER_SAVE_MS);
      },
    }),
  );

  const errors = validateSchedule(draft);
  const invalid = hasErrors(errors);
  const dirty = !scheduleEquals(draft, baseline);

  const update = (day: Day, entries: ScheduleEntry[]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [day]: entries }));
  };
  const patch = (day: Day, i: number, change: Partial<ScheduleEntry>) =>
    update(
      day,
      draft[day].map((e, j) => (j === i ? { ...e, ...change } : e)),
    );

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>

      {state.isLoading && <Spinner className="text-muted-foreground" />}
      {state.isError && (
        <p role="alert" className="text-destructive text-sm">
          Error: {state.error.message}
        </p>
      )}
      {state.data && !server && (
        <p className="text-muted-foreground text-sm">
          The thermostat has not reported a schedule yet. Anything you save here replaces it.
        </p>
      )}

      {state.data && (
        <>
          <p className="text-muted-foreground text-sm">
            Each change sets the target temperature from that time until the next change.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {DAYS.map((day) => (
              <Card key={day}>
                <CardHeader>
                  <CardTitle>{FULL_NAME[day]}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {draft[day].length === 0 && (
                    <p className="text-muted-foreground text-sm">No changes</p>
                  )}
                  {draft[day].map((entry, i) => {
                    const err = errors[day].entries[i];
                    const label = `${FULL_NAME[day]} change ${i + 1}`;
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place and have no id
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            aria-label={`${label} time`}
                            aria-invalid={err ? true : undefined}
                            value={entry.at}
                            onChange={(e) => patch(day, i, { at: e.target.value })}
                            className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
                          />
                          <input
                            type="number"
                            aria-label={`${label} temperature`}
                            aria-invalid={err ? true : undefined}
                            min={MIN_SETPOINT}
                            max={MAX_SETPOINT}
                            step={0.5}
                            value={Number.isNaN(entry.targetC) ? '' : entry.targetC}
                            onChange={(e) => patch(day, i, { targetC: e.target.valueAsNumber })}
                            className="border-input bg-background h-8 w-20 rounded-lg border px-2 text-sm tabular-nums"
                          />
                          <span className="text-muted-foreground text-sm">°C</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${label}`}
                            onClick={() =>
                              update(
                                day,
                                draft[day].filter((_, j) => j !== i),
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        {err && (
                          <p role="alert" className="text-destructive text-xs">
                            {err}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {errors[day].day && (
                    <p role="alert" className="text-destructive text-xs">
                      {errors[day].day}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    aria-label={`Add change on ${FULL_NAME[day]}`}
                    disabled={draft[day].length >= MAX_TRANSITIONS_PER_DAY}
                    onClick={() => update(day, [...draft[day], nextEntry(draft[day])])}
                  >
                    <Plus /> Add change
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button
              disabled={!dirty || invalid || save.isPending}
              onClick={() => save.mutate({ schedule: normaliseSchedule(draft) })}
            >
              {save.isPending ? 'Saving…' : 'Save schedule'}
            </Button>
            <Button
              variant="ghost"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setDraft(structuredClone(baseline));
                setSaved(false);
              }}
            >
              Discard changes
            </Button>
            {saved && !dirty && (
              <span role="status" className="text-muted-foreground text-sm">
                Saved. The thermostat will pick it up shortly.
              </span>
            )}
            {save.isError && (
              <span role="alert" className="text-destructive text-sm">
                Could not save: {save.error.message}
              </span>
            )}
          </div>
        </>
      )}
    </main>
  );
}

export default ScheduleEditor;
