import { z } from 'zod';

/**
 * Typed client for the nakostat HTTP API.
 *
 * Keeps URL construction, auth headers and response validation out of the
 * components: a component is handed a {@link NakostatApi} and just calls the
 * named operations. Responses are validated with zod at runtime, so a shape
 * the backend didn't promise surfaces as a rejected promise rather than an
 * `undefined` deep in the render tree.
 */

export const thermostatStateSchema = z.object({
  deviceId: z.string(),
  boilerActive: z.boolean().optional(),
  setpoint: z.number().optional(),
  mode: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ThermostatState = z.infer<typeof thermostatStateSchema>;

export interface NakostatApi {
  getState(): Promise<ThermostatState>;
}

export function createApiClient(baseUrl: string, accessToken?: string): NakostatApi {
  async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const headers: HeadersInit = accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : {};
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return schema.parse(await res.json());
  }

  return {
    getState: () => request('/state', thermostatStateSchema),
  };
}
