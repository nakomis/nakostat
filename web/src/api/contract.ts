import { oc } from '@orpc/contract';
import { z } from 'zod';

/**
 * Typed, declarative contract for the nakostat HTTP API.
 *
 * Each procedure pairs an HTTP route (method + path, relative to the API base
 * URL) with zod schemas for its input/output. The schemas are the single source
 * of truth: they validate responses at the network boundary at runtime AND give
 * us the static types for free (`z.infer`), so there are no hand-written
 * interfaces to drift from the wire format.
 *
 * Backed by infra/lambda/api/*.ts — keep these in step with the handlers.
 */

/** Current thermostat state — the raw DynamoDB item for deviceId `esp32`. */
export const thermostatState = z.object({
  deviceId: z.string(),
  setpoint: z.number().optional(),
  boilerActive: z.boolean().optional(),
  mode: z.string().optional(),
  updatedAt: z.string().optional(),
  setpointUpdatedAt: z.string().optional(),
});
export type ThermostatState = z.infer<typeof thermostatState>;

/** POST /setpoint body — target temperature in °C (boiler safe range). */
export const setpointRequest = z.object({
  temperature: z.number().min(0).max(30),
});
export type SetpointRequest = z.infer<typeof setpointRequest>;

/** POST /setpoint response — the persisted setpoint. */
export const setpointResponse = z.object({
  deviceId: z.string(),
  setpoint: z.number(),
  setpointUpdatedAt: z.string(),
});
export type SetpointResponse = z.infer<typeof setpointResponse>;

export const contract = {
  /** GET /state — current boiler/setpoint state. */
  getState: oc.route({ method: 'GET', path: '/state' }).output(thermostatState),
  /** POST /setpoint — set the target temperature (requires a bearer token). */
  setpoint: oc
    .route({ method: 'POST', path: '/setpoint' })
    .input(setpointRequest)
    .output(setpointResponse),
};
