import { describe, expect, it } from 'vitest';
import { buildSegments, totalOnMs } from './timeline';

const H = 3600_000;
const T0 = Date.parse('2026-10-19T00:00:00Z');
const iso = (h: number) => new Date(T0 + h * H).toISOString();

describe('buildSegments', () => {
  it('returns nothing when state is unknown', () => {
    expect(buildSegments([], T0, T0 + 24 * H)).toEqual([]);
  });

  it('uses the current relay with no events', () => {
    expect(buildSegments([], T0, T0 + 24 * H, true)).toEqual([
      { from: T0, to: T0 + 24 * H, on: true },
    ]);
  });

  it('infers the initial state from the first event, any order', () => {
    const segs = buildSegments(
      [
        { timestamp: iso(10), state: 'off' },
        { timestamp: iso(6), state: 'on' },
      ],
      T0,
      T0 + 24 * H,
    );
    expect(segs).toEqual([
      { from: T0, to: T0 + 6 * H, on: false },
      { from: T0 + 6 * H, to: T0 + 10 * H, on: true },
      { from: T0 + 10 * H, to: T0 + 24 * H, on: false },
    ]);
    expect(totalOnMs(segs)).toBe(4 * H);
  });

  it('uses an event before the window as the starting state', () => {
    const segs = buildSegments([{ timestamp: iso(-3), state: 'on' }], T0, T0 + 4 * H);
    expect(segs).toEqual([{ from: T0, to: T0 + 4 * H, on: true }]);
  });

  it('ignores repeated states, bad timestamps and future events', () => {
    const segs = buildSegments(
      [
        { timestamp: iso(1), state: 'on' },
        { timestamp: iso(2), state: 'on' },
        { timestamp: 'junk', state: 'off' },
        { timestamp: iso(30), state: 'off' },
      ],
      T0,
      T0 + 5 * H,
    );
    expect(segs).toEqual([
      { from: T0, to: T0 + H, on: false },
      { from: T0 + H, to: T0 + 5 * H, on: true },
    ]);
  });
});
