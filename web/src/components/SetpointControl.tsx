import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_SETPOINT, MIN_SETPOINT } from '@/api/contract';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatClock } from '@/lib/status';

export const SETPOINT_STEP = 0.5;
export const SETPOINT_DEBOUNCE_MS = 1000;

interface SetpointControlProps {
  /** Effective setpoint (including any pending, optimistic value). */
  setpoint: number;
  /** Heating mode; in `off` the setpoint is the frost floor and not adjustable. */
  mode: 'heat' | 'off';
  scheduled?: number | null;
  override?: { setpoint: number; until: string } | null;
  /** True whilst a change is awaiting the daemon. */
  pending?: boolean;
  onCommit: (temperature: number) => void;
}

function SetpointControl({
  setpoint,
  mode,
  scheduled,
  override,
  pending,
  onCommit,
}: SetpointControlProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (draft === null) return;
    const timer = setTimeout(() => {
      commitRef.current(draft);
      setDraft(null);
    }, SETPOINT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const shown = draft ?? setpoint;
  const off = mode === 'off';
  const step = (delta: number) => {
    // Snap to the 0.5 grid first, so an off-grid value (e.g. 20.3 from Alexa) steps to 20.5 or 20.0.
    const base = Math.round((draft ?? setpoint) / SETPOINT_STEP) * SETPOINT_STEP;
    const next = Math.min(MAX_SETPOINT, Math.max(MIN_SETPOINT, base + delta));
    setDraft(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Setpoint</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Decrease setpoint"
            disabled={off || shown <= MIN_SETPOINT}
            onClick={() => step(-SETPOINT_STEP)}
          >
            <Minus />
          </Button>
          <output
            aria-label="Target temperature"
            className="min-w-28 text-center text-5xl font-semibold tabular-nums"
          >
            {shown.toFixed(1)}°
          </output>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Increase setpoint"
            disabled={off || shown >= MAX_SETPOINT}
            onClick={() => step(SETPOINT_STEP)}
          >
            <Plus />
          </Button>
        </div>
        <div className="text-muted-foreground min-h-5 text-center text-sm">
          {off && 'Heating off: frost protection only'}
          {!off && draft !== null && 'Updating…'}
          {!off && draft === null && pending && 'Waiting for the thermostat…'}
          {!off && draft === null && !pending && override && (
            <>
              Override until {formatClock(override.until)}
              {scheduled != null && <> (schedule: {scheduled.toFixed(1)}°)</>}
            </>
          )}
          {!off &&
            draft === null &&
            !pending &&
            !override &&
            scheduled != null &&
            'Following the schedule'}
        </div>
      </CardContent>
    </Card>
  );
}

export default SetpointControl;
