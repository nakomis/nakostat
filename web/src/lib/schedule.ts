import {
  DAYS,
  type Day,
  MAX_SETPOINT,
  MAX_TRANSITIONS_PER_DAY,
  MIN_SETPOINT,
  type Schedule,
  type ScheduleEntry,
} from '@/api/contract';

export function emptySchedule(): Schedule {
  return { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
}

export function sortEntries(entries: ScheduleEntry[]): ScheduleEntry[] {
  return [...entries].sort((a, b) => a.at.localeCompare(b.at));
}

/** Sort every day by time, ready to send. */
export function normaliseSchedule(schedule: Schedule): Schedule {
  const out = emptySchedule();
  for (const d of DAYS) out[d] = sortEntries(schedule[d]);
  return out;
}

export function scheduleEquals(a: Schedule, b: Schedule): boolean {
  return JSON.stringify(normaliseSchedule(a)) === JSON.stringify(normaliseSchedule(b));
}

/** Problems for one day, keyed by entry index (and `day` for whole-day problems). */
export interface DayErrors {
  day?: string;
  entries: Record<number, string>;
}

export function validateDay(entries: ScheduleEntry[]): DayErrors {
  const errors: DayErrors = { entries: {} };
  if (entries.length > MAX_TRANSITIONS_PER_DAY) {
    errors.day = `At most ${MAX_TRANSITIONS_PER_DAY} changes a day`;
  }
  const seen = new Map<string, number>();
  entries.forEach((e, i) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.at)) {
      errors.entries[i] = 'Enter a time as HH:MM';
    } else if (Number.isNaN(e.targetC) || e.targetC < MIN_SETPOINT || e.targetC > MAX_SETPOINT) {
      errors.entries[i] = `Temperature must be ${MIN_SETPOINT}–${MAX_SETPOINT} °C`;
    } else if (!Number.isInteger(e.targetC * 2)) {
      errors.entries[i] = 'Use 0.5 °C steps';
    } else if (seen.has(e.at)) {
      errors.entries[i] = 'Two changes at the same time';
    }
    if (!seen.has(e.at)) seen.set(e.at, i);
  });
  return errors;
}

export function validateSchedule(schedule: Schedule): Record<Day, DayErrors> {
  const out = {} as Record<Day, DayErrors>;
  for (const d of DAYS) out[d] = validateDay(schedule[d]);
  return out;
}

export function hasErrors(errors: Record<Day, DayErrors>): boolean {
  return DAYS.some((d) => errors[d].day || Object.keys(errors[d].entries).length > 0);
}

/** Default new transition: an hour after the last one, same target. */
export function nextEntry(entries: ScheduleEntry[]): ScheduleEntry {
  const last = sortEntries(entries).at(-1);
  if (!last) return { at: '07:00', targetC: 20 };
  const [h, m] = last.at.split(':').map(Number);
  const mins = Math.min(h * 60 + m + 60, 23 * 60 + 30);
  const at = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return { at, targetC: last.targetC };
}
