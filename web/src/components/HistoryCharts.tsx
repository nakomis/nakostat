import type { Reading } from '@/api/contract';
import LineChart from '@/components/LineChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Point } from '@/lib/chart';

interface HistoryChartsProps {
  readings: Reading[];
  /** Current effective setpoint, drawn on the temperature chart. */
  setpoint?: number | null;
  now: number;
}

const DAY_MS = 24 * 3600_000;

function series(readings: Reading[], key: 'temperature' | 'humidity', from: number): Point[] {
  const out: Point[] = [];
  for (const r of readings) {
    const v = r[key];
    const t = Date.parse(r.timestamp);
    if (typeof v === 'number' && !Number.isNaN(t) && t >= from) out.push({ t, v });
  }
  return out;
}

/** Last 24 hours of temperature and humidity: two charts, because they have different scales. */
function HistoryCharts({ readings, setpoint, now }: HistoryChartsProps) {
  const from = now - DAY_MS;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Last 24 hours</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <LineChart
          title="Temperature"
          unit="°C"
          colour="var(--viz-temp)"
          points={series(readings, 'temperature', from)}
          from={from}
          to={now}
          reference={setpoint != null ? { value: setpoint, label: 'Setpoint now' } : undefined}
        />
        <LineChart
          title="Humidity"
          unit="%"
          colour="var(--viz-humidity)"
          points={series(readings, 'humidity', from)}
          from={from}
          to={now}
        />
      </CardContent>
    </Card>
  );
}

export default HistoryCharts;
