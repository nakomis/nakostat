import { useState } from 'react';
import { linear, linePath, nearest, niceDomain, type Point, splitOnGaps } from '@/lib/chart';

interface LineChartProps {
  title: string;
  unit: string;
  /** CSS colour for the line, e.g. `var(--viz-temp)`. */
  colour: string;
  points: Point[];
  from: number;
  to: number;
  /** Optional horizontal reference line (e.g. the current setpoint). */
  reference?: { value: number; label: string };
  /** A gap longer than this breaks the line. */
  gapMs?: number;
}

const W = 640;
const H = 200;
const M = { top: 12, right: 12, bottom: 24, left: 36 };

function hhmm(t: number) {
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** A single-measure time-series line chart in plain SVG (one axis, recessive grid, hover readout). */
function LineChart({
  title,
  unit,
  colour,
  points,
  from,
  to,
  reference,
  gapMs = 15 * 60_000,
}: LineChartProps) {
  const [hover, setHover] = useState<Point | null>(null);
  const sorted = [...points].sort((a, b) => a.t - b.t);

  const values = sorted.map((p) => p.v);
  if (reference) values.push(reference.value);
  const [lo, hi] = niceDomain(values);
  const x = linear(from, to, M.left, W - M.right);
  const y = linear(lo, hi, H - M.bottom, M.top);

  const yTicks = [lo, lo + (hi - lo) / 2, hi];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => from + f * (to - from));
  const runs = splitOnGaps(sorted, gapMs);
  const latest = sorted.at(-1);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = from + ((px - M.left) / (W - M.left - M.right)) * (to - from);
    setHover(nearest(sorted, t) ?? null);
  };

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground tabular-nums">
          {hover
            ? `${hhmm(hover.t)}: ${hover.v.toFixed(1)}${unit}`
            : latest
              ? `Latest ${latest.v.toFixed(1)}${unit}`
              : 'No data'}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        className="h-auto w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" />
            <text
              x={M.left - 6}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            {hhmm(t)}
          </text>
        ))}
        {reference && (
          <g data-testid="reference">
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(reference.value)}
              y2={y(reference.value)}
              stroke="currentColor"
              strokeDasharray="4 4"
              className="text-muted-foreground"
            />
            <text
              x={W - M.right}
              y={y(reference.value) - 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {reference.label} {reference.value.toFixed(1)}
              {unit}
            </text>
          </g>
        )}
        {runs.map((run) =>
          run.length === 1 ? (
            <circle key={run[0].t} cx={x(run[0].t)} cy={y(run[0].v)} r={2.5} fill={colour} />
          ) : (
            <path
              key={run[0].t}
              d={linePath(run, x, y)}
              fill="none"
              stroke={colour}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )}
        {hover && (
          <g data-testid="crosshair">
            <line
              x1={x(hover.t)}
              x2={x(hover.t)}
              y1={M.top}
              y2={H - M.bottom}
              stroke="currentColor"
              className="text-muted-foreground"
            />
            <circle
              cx={x(hover.t)}
              cy={y(hover.v)}
              r={4}
              fill={colour}
              stroke="var(--card)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
    </figure>
  );
}

export default LineChart;
