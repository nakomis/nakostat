/** Setpoint limits shared by the HTTP API and the Alexa skill (and mirrored in the web app and daemon). */
export const MIN_SETPOINT_C = 5;
export const MAX_SETPOINT_C = 30;
/** Setpoints and schedule targets sit on this grid, in °C. */
export const SETPOINT_STEP_C = 0.5;

export const isOnGrid = (c: number) =>
  Math.abs(c / SETPOINT_STEP_C - Math.round(c / SETPOINT_STEP_C)) < 1e-9;
export const roundToGrid = (c: number) => Math.round(c / SETPOINT_STEP_C) * SETPOINT_STEP_C;
