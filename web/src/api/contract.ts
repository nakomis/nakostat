import { oc } from '@orpc/contract';
import { z } from 'zod';

/**
 * Typed, declarative contract for the nakostat HTTP API.
 *
 * Each procedure pairs an HTTP route (method + path, relative to the API base
 * URL) with zod schemas for its input/output. The schemas are the single source
 * of truth: they validate responses at the network boundary at runtime AND give
 * us the static types (`z.infer`). Payloads follow the heatlink v2 design spec
 * (docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md).
 *
 * Backed by infra/lambda/api/*.ts — keep these in step with the handlers.
 */

export const MIN_SETPOINT = 5;
export const MAX_SETPOINT = 30;
export const MAX_TRANSITIONS_PER_DAY = 8;

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Day = (typeof DAYS)[number];

/** A setpoint within the boiler-safe range, in 0.5 °C steps. */
const setpointValue = z
  .number()
  .min(MIN_SETPOINT)
  .max(MAX_SETPOINT)
  .refine((v) => Number.isInteger(v * 2), { message: 'Use 0.5 °C steps' });

/** Time of day, 24 h "HH:MM". */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const scheduleEntry = z.object({
  at: timeOfDay,
  targetC: z.number().min(MIN_SETPOINT).max(MAX_SETPOINT),
});
export type ScheduleEntry = z.infer<typeof scheduleEntry>;

const dayEntries = z.array(scheduleEntry).max(MAX_TRANSITIONS_PER_DAY);

export const schedule = z.object({
  Mon: dayEntries,
  Tue: dayEntries,
  Wed: dayEntries,
  Thu: dayEntries,
  Fri: dayEntries,
  Sat: dayEntries,
  Sun: dayEntries,
});
export type Schedule = z.infer<typeof schedule>;

export const demandSource = z.enum(['schedule', 'override', 'frost', 'off']);

/** Pi daemon state (`pi/state`, deviceId "pi"). */
export const piState = z.object({
  timestamp: z.string(),
  temperature: z.number().nullish(),
  humidity: z.number().nullish(),
  mode: z.enum(['heat', 'off']),
  setpoint: z.number(),
  scheduled_setpoint: z.number().nullish(),
  override: z.object({ setpoint: z.number(), until: z.string() }).nullish(),
  demand: z.boolean(),
  demand_source: z.string().nullish(),
});
export type PiState = z.infer<typeof piState>;

/** Heatlink status (`…/status`, deviceId "heatlink") plus `seen` and `version`. */
export const heatlinkStatus = z.object({
  mode: z.enum(['auto', 'fallback', 'force_on', 'force_off']),
  relay: z.boolean(),
  switch: z.enum(['auto', 'on', 'off']),
  source: z.string().nullish(),
  demand_age_s: z.number().nullish(),
  schedule_known: z.boolean().nullish(),
  time_valid: z.boolean().nullish(),
  rssi: z.number().nullish(),
  uptime_s: z.number().nullish(),
  reason: z.string().nullish(),
  seen: z.string(),
  version: z.string().nullish(),
});
export type HeatlinkStatus = z.infer<typeof heatlinkStatus>;

/** GET /state response. Each part is null until the device has reported. */
export const stateResponse = z.object({
  pi: piState.nullable(),
  heatlink: heatlinkStatus.nullable(),
  schedule: z.object({ schedule, timestamp: z.string() }).nullable(),
});
export type StateResponse = z.infer<typeof stateResponse>;

/** POST /setpoint body. */
export const setpointRequest = z.object({ temperature: setpointValue });
export type SetpointRequest = z.infer<typeof setpointRequest>;

/** POST /mode body. */
export const modeRequest = z.object({ mode: z.enum(['heat', 'off']) });
export type ModeRequest = z.infer<typeof modeRequest>;

/** PUT /schedule body. */
export const scheduleRequest = z.object({ schedule });
export type ScheduleRequest = z.infer<typeof scheduleRequest>;

/** Writes are fire-and-forget (the daemon applies them asynchronously). */
const ack = z.unknown();

/** One row of GET /readings. Other sensor fields pass through. */
export const reading = z.looseObject({
  timestamp: z.string(),
  temperature: z.number().nullish(),
  humidity: z.number().nullish(),
});
export type Reading = z.infer<typeof reading>;
export const readingsResponse = z.object({ readings: z.array(reading) });

export const boilerEvent = z.looseObject({
  timestamp: z.string(),
  state: z.enum(['on', 'off']),
  source: z.string().nullish(),
});
export type BoilerEvent = z.infer<typeof boilerEvent>;

export const contract = {
  /** GET /state — Pi daemon state, heatlink status and the active schedule. */
  getState: oc.route({ method: 'GET', path: '/state' }).output(stateResponse),
  /** POST /setpoint — request a target temperature (daemon decides). */
  setpoint: oc.route({ method: 'POST', path: '/setpoint' }).input(setpointRequest).output(ack),
  /** POST /mode — heat or off (frost protection only). */
  setMode: oc.route({ method: 'POST', path: '/mode' }).input(modeRequest).output(ack),
  /** PUT /schedule — replace the weekly schedule. */
  putSchedule: oc.route({ method: 'PUT', path: '/schedule' }).input(scheduleRequest).output(ack),
  /** GET /readings?limit=N or ?from&to (ISO-8601, up to 2000 rows) — newest first. */
  getReadings: oc
    .route({ method: 'GET', path: '/readings' })
    .input(
      z.object({
        limit: z.coerce.number().int().min(1).max(2000).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    )
    .output(readingsResponse),
  /** GET /boiler-usage?from&to — newest first. */
  getBoilerUsage: oc
    .route({ method: 'GET', path: '/boiler-usage' })
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }))
    .output(z.array(boilerEvent)),
};
