import { describe, expect, it } from 'vitest';
import { linear, linePath, nearest, niceDomain, splitOnGaps } from './chart';

describe('chart helpers', () => {
  it('scales linearly and survives a zero span', () => {
    expect(linear(0, 10, 0, 100)(5)).toBe(50);
    expect(Number.isFinite(linear(3, 3, 0, 100)(3))).toBe(true);
  });

  it('pads the domain to a minimum span', () => {
    expect(niceDomain([20, 20.5])).toEqual([18, 23]);
    expect(niceDomain([10, 30])).toEqual([10, 30]);
    expect(niceDomain([])).toEqual([0, 4]);
  });

  it('splits on gaps', () => {
    const runs = splitOnGaps(
      [
        { t: 0, v: 1 },
        { t: 1, v: 1 },
        { t: 100, v: 1 },
      ],
      10,
    );
    expect(runs.map((r) => r.length)).toEqual([2, 1]);
    expect(splitOnGaps([], 10)).toEqual([]);
  });

  it('builds a path', () => {
    const id = (x: number) => x;
    expect(
      linePath(
        [
          { t: 0, v: 1 },
          { t: 2, v: 3 },
        ],
        id,
        id,
      ),
    ).toBe('M0.0,1.0 L2.0,3.0');
  });

  it('finds the nearest point', () => {
    const pts = [
      { t: 0, v: 1 },
      { t: 10, v: 2 },
    ];
    expect(nearest(pts, 7)?.v).toBe(2);
    expect(nearest([], 1)).toBeUndefined();
  });
});
