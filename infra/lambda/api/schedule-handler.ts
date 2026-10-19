import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { isOnGrid, SETPOINT_STEP_C } from '../shared/limits';
import {
  badRequest,
  isValidTemperature,
  MAX_SETPOINT_C,
  MIN_SETPOINT_C,
  parseControlRequest,
  publishToDaemon,
} from './common';

/** Day keys of the daemon's persisted schedule (`schedule.rs`), Monday first. */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Day = (typeof DAYS)[number];

/** The heatlink stores at most this many transitions a day (`set_schedule`). */
export const MAX_ENTRIES_PER_DAY = 8;

export interface ScheduleEntry {
  at: string;
  targetC: number;
}
export type Schedule = Record<Day, ScheduleEntry[]>;

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Checks a week schedule in the daemon's format, `{"Mon": [{"at": "07:00", "targetC": 20}], …}`:
 * all seven days and no others, at most eight entries a day, times "HH:MM" and unique within a day, targets 5–30 °C in 0.5 °C steps.
 * Returns it with only `at` and `targetC` kept on each entry.
 */
export function validateSchedule(
  value: unknown,
): { ok: true; schedule: Schedule } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'schedule must be an object keyed by day' };
  }
  const input = value as Record<string, unknown>;

  const unknownDay = Object.keys(input).find((k) => !(DAYS as readonly string[]).includes(k));
  if (unknownDay) return { ok: false, error: `unknown day "${unknownDay}"` };

  const schedule = {} as Schedule;
  for (const day of DAYS) {
    const entries = input[day];
    if (!Array.isArray(entries)) return { ok: false, error: `${day} must be an array of entries` };
    if (entries.length > MAX_ENTRIES_PER_DAY) {
      return { ok: false, error: `${day} has ${entries.length} entries; at most 8 are allowed` };
    }
    schedule[day] = [];
    for (const [i, entry] of entries.entries()) {
      if (typeof entry !== 'object' || entry === null) {
        return { ok: false, error: `${day}[${i}] must be an object` };
      }
      const { at, targetC } = entry as Record<string, unknown>;
      if (typeof at !== 'string' || !HH_MM.test(at)) {
        return { ok: false, error: `${day}[${i}].at must be a time "HH:MM"` };
      }
      if (!isValidTemperature(targetC)) {
        return {
          ok: false,
          error: `${day}[${i}].targetC must be between ${MIN_SETPOINT_C} and ${MAX_SETPOINT_C}°C`,
        };
      }
      if (!isOnGrid(targetC)) {
        return {
          ok: false,
          error: `${day}[${i}].targetC must be a multiple of ${SETPOINT_STEP_C}°C`,
        };
      }
      if (schedule[day].some((e) => e.at === at)) {
        return { ok: false, error: `${day}[${i}].at duplicates another entry at ${at}` };
      }
      schedule[day].push({ at, targetC });
    }
  }
  return { ok: true, schedule };
}

/** `PUT /schedule` `{"schedule": {…}}`: replaces the daemon's week schedule. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const request = parseControlRequest(event);
  if (!request.ok) return request.response;

  const result = validateSchedule(request.body.schedule);
  if (!result.ok) return badRequest(`Invalid schedule: ${result.error}`);
  return publishToDaemon('schedule', request.userId, { schedule: result.schedule });
};
