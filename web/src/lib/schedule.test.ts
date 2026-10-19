import { describe, expect, it } from 'vitest';
import {
  emptySchedule,
  hasErrors,
  nextEntry,
  normaliseSchedule,
  scheduleEquals,
  validateDay,
  validateSchedule,
} from './schedule';

describe('schedule helpers', () => {
  it('sorts entries on normalise', () => {
    const s = emptySchedule();
    s.Mon = [
      { at: '18:00', targetC: 20 },
      { at: '06:00', targetC: 21 },
    ];
    expect(normaliseSchedule(s).Mon.map((e) => e.at)).toEqual(['06:00', '18:00']);
  });

  it('compares schedules ignoring order', () => {
    const a = emptySchedule();
    const b = emptySchedule();
    a.Tue = [
      { at: '06:00', targetC: 20 },
      { at: '08:00', targetC: 17 },
    ];
    b.Tue = [...a.Tue].reverse();
    expect(scheduleEquals(a, b)).toBe(true);
    b.Tue[0] = { at: '08:00', targetC: 18 };
    expect(scheduleEquals(a, b)).toBe(false);
  });

  it('accepts a valid day', () => {
    expect(validateDay([{ at: '06:00', targetC: 20.5 }]).entries).toEqual({});
  });

  it('flags bad time, range, step and duplicates', () => {
    const e = validateDay([
      { at: '6:00', targetC: 20 },
      { at: '07:00', targetC: 4 },
      { at: '08:00', targetC: 20.25 },
      { at: '09:00', targetC: 20 },
      { at: '09:00', targetC: 21 },
      { at: '10:00', targetC: Number.NaN },
    ]).entries;
    expect(e[0]).toMatch(/HH:MM/);
    expect(e[1]).toMatch(/5–30/);
    expect(e[2]).toMatch(/0.5/);
    expect(e[3]).toBeUndefined();
    expect(e[4]).toMatch(/same time/);
    expect(e[5]).toMatch(/5–30/);
  });

  it('flags more than 8 entries', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      at: `${String(i).padStart(2, '0')}:00`,
      targetC: 20,
    }));
    expect(validateDay(many).day).toMatch(/8/);
  });

  it('hasErrors reflects any day', () => {
    const s = emptySchedule();
    expect(hasErrors(validateSchedule(s))).toBe(false);
    s.Sun = [{ at: 'xx', targetC: 20 }];
    expect(hasErrors(validateSchedule(s))).toBe(true);
  });

  it('suggests the next entry', () => {
    expect(nextEntry([])).toEqual({ at: '07:00', targetC: 20 });
    expect(nextEntry([{ at: '08:00', targetC: 17 }])).toEqual({ at: '09:00', targetC: 17 });
    expect(nextEntry([{ at: '23:45', targetC: 17 }]).at).toBe('23:30');
  });
});
