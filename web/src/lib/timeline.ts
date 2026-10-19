import type { BoilerEvent } from '@/api/contract';

export interface Segment {
  from: number;
  to: number;
  on: boolean;
}

/**
 * Turn boiler change events into on/off segments covering [from, to].
 * Events may arrive in any order. State before the first event is inferred
 * as the opposite of that event; with no events we fall back to `currentOn`
 * (the heatlink's relay), or return no segments if that's unknown too.
 */
export function buildSegments(
  events: Pick<BoilerEvent, 'timestamp' | 'state'>[],
  from: number,
  to: number,
  currentOn?: boolean | null,
): Segment[] {
  const sorted = events
    .map((e) => ({ t: Date.parse(e.timestamp), on: e.state === 'on' }))
    .filter((e) => !Number.isNaN(e.t))
    .sort((a, b) => a.t - b.t);

  const inWindow = sorted.filter((e) => e.t <= to);
  const before = inWindow.filter((e) => e.t < from).at(-1);
  const during = inWindow.filter((e) => e.t >= from);

  let state: boolean | undefined;
  if (before) state = before.on;
  else if (during.length > 0) state = !during[0].on;
  else state = currentOn ?? undefined;
  if (state === undefined) return [];

  const segments: Segment[] = [];
  let cursor = from;
  for (const e of during) {
    if (e.on === state) continue; // repeated state, no change
    if (e.t > cursor) segments.push({ from: cursor, to: e.t, on: state });
    cursor = e.t;
    state = e.on;
  }
  if (to > cursor) segments.push({ from: cursor, to, on: state });
  return segments;
}

export function totalOnMs(segments: Segment[]): number {
  return segments.filter((s) => s.on).reduce((sum, s) => sum + (s.to - s.from), 0);
}
