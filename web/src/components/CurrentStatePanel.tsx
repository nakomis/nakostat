import { Flame } from 'lucide-react';
import type { PiState } from '@/api/contract';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatClock } from '@/lib/status';

interface CurrentStatePanelProps {
  /** Latest daemon state; `null` until the Pi has reported. */
  pi: PiState | null;
}

function Reading({ label, value, unit }: { label: string; value?: number | null; unit: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-4xl font-semibold tabular-nums">
        {value == null ? '–' : value.toFixed(1)}
        <span className="text-muted-foreground ml-0.5 text-xl font-normal">{unit}</span>
      </dd>
    </div>
  );
}

/** Room temperature and humidity, with whether the boiler is being asked to fire. */
function CurrentStatePanel({ pi }: CurrentStatePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current State</CardTitle>
      </CardHeader>
      <CardContent>
        {!pi ? (
          <p className="text-muted-foreground text-sm">No data from the thermostat yet</p>
        ) : (
          <div className="flex flex-col gap-3">
            <dl className="flex gap-8">
              <Reading label="Temperature" value={pi.temperature} unit="°C" />
              <Reading label="Humidity" value={pi.humidity} unit="%" />
            </dl>
            <div className="flex items-center gap-3">
              {pi.demand ? (
                <Badge variant="destructive">
                  <Flame /> Heating
                </Badge>
              ) : (
                <Badge variant="secondary">Idle</Badge>
              )}
              <span className="text-muted-foreground text-xs">
                Updated {formatClock(pi.timestamp)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CurrentStatePanel;
