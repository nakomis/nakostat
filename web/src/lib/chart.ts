export interface Point {
  t: number;
  v: number;
}

export type Scale = (x: number) => number;

export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const span = d1 - d0 || 1;
  return (x) => r0 + ((x - d0) / span) * (r1 - r0);
}

/** A y-domain padded around the data with a minimum span, snapped to whole numbers. */
export function niceDomain(values: number[], minSpan = 4): [number, number] {
  if (values.length === 0) return [0, minSpan];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  return [Math.floor(lo), Math.ceil(hi)];
}

/** Break the series where consecutive points are further apart than `gapMs`. */
export function splitOnGaps(points: Point[], gapMs: number): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    const prev = run.at(-1);
    if (prev && p.t - prev.t > gapMs) {
      runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) runs.push(run);
  return runs;
}

export function linePath(points: Point[], x: Scale, y: Scale): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ');
}

export function nearest(points: Point[], t: number): Point | undefined {
  let best: Point | undefined;
  for (const p of points) {
    if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  }
  return best;
}
