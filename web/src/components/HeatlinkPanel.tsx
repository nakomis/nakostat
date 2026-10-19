import { AlertTriangle } from 'lucide-react';
import type { HeatlinkStatus } from '@/api/contract';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAge, isStale } from '@/lib/status';

const MODE_LABEL: Record<HeatlinkStatus['mode'], string> = {
  auto: 'Auto (following the thermostat)',
  fallback: 'Fallback (local schedule)',
  force_on: 'Forced on',
  force_off: 'Forced off',
};

interface HeatlinkPanelProps {
  status: HeatlinkStatus | null;
  /** Current time in ms; injected so staleness is testable. */
  now: number;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function HeatlinkPanel({ status, now }: HeatlinkPanelProps) {
  const stale = status ? isStale(status.seen, now) : false;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Heatlink</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!status ? (
          <p className="text-muted-foreground text-sm">The heatlink has not reported yet</p>
        ) : (
          <>
            {stale && (
              <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4" /> Last heard from {formatAge(status.seen, now)}:
                the boiler state shown may be out of date
              </p>
            )}
            {status.mode === 'fallback' && (
              <p
                role="alert"
                className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle className="size-4" /> Running on its local fallback schedule: no
                temperature control
              </p>
            )}
            <dl className="flex flex-col gap-1.5">
              <Row label="Mode">{MODE_LABEL[status.mode]}</Row>
              <Row label="Switch">
                <span className="capitalize">{status.switch}</span>
              </Row>
              <Row label="Relay">
                <Badge variant={status.relay ? 'destructive' : 'secondary'}>
                  {status.relay ? 'On' : 'Off'}
                </Badge>
              </Row>
              <Row label="Last seen">{formatAge(status.seen, now)}</Row>
              {status.version && <Row label="Firmware">{status.version}</Row>}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default HeatlinkPanel;
