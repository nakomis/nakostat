import type { BoilerEvent } from '@/api/contract';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDuration } from '@/lib/status';
import { buildSegments, totalOnMs } from '@/lib/timeline';

interface BoilerTimelineProps {
  events: BoilerEvent[];
  /** The heatlink's current relay state, used when no changes fall in the window. */
  currentOn?: boolean | null;
  now: number;
}

const DAY_MS = 24 * 3600_000;
const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** One-row on/off bar for the last 24 hours. */
function BoilerTimeline({ events, currentOn, now }: BoilerTimelineProps) {
  const from = now - DAY_MS;
  const segments = buildSegments(events, from, now, currentOn);
  const pct = (t: number) => ((t - from) / DAY_MS) * 100;
  const onMs = totalOnMs(segments);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Boiler, last 24 hours</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {segments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No boiler changes recorded</p>
        ) : (
          <>
            <p className="text-sm">
              On for <strong>{formatDuration(onMs)}</strong> ({Math.round((onMs / DAY_MS) * 100)}%)
            </p>
            <div
              role="img"
              aria-label={`Boiler on for ${formatDuration(onMs)} in the last 24 hours`}
              className="bg-muted relative h-6 overflow-hidden rounded-md"
            >
              {segments
                .filter((s) => s.on)
                .map((s) => (
                  <div
                    key={s.from}
                    data-testid="on-segment"
                    title={`On ${hhmm(s.from)}–${hhmm(s.to)}`}
                    className="absolute inset-y-0 rounded-sm"
                    style={{
                      left: `${pct(s.from)}%`,
                      width: `${pct(s.to) - pct(s.from)}%`,
                      background: 'var(--viz-boiler)',
                    }}
                  />
                ))}
            </div>
            <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
              <span>{hhmm(from)}</span>
              <span>{hhmm(from + DAY_MS / 2)}</span>
              <span>{hhmm(now)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default BoilerTimeline;
