import { describe, expect, it } from 'vitest';
import { setpointRequest, setpointResponse, thermostatState } from './contract';

describe('thermostatState schema', () => {
  it('accepts a full state item', () => {
    const parsed = thermostatState.parse({
      deviceId: 'esp32',
      setpoint: 20,
      boilerActive: true,
      mode: 'auto',
      updatedAt: '2026-06-03T20:00:00Z',
      setpointUpdatedAt: '2026-06-03T20:05:00Z',
    });
    expect(parsed.deviceId).toBe('esp32');
    expect(parsed.boilerActive).toBe(true);
  });

  it('accepts a minimal item with only deviceId', () => {
    expect(thermostatState.parse({ deviceId: 'esp32' })).toEqual({ deviceId: 'esp32' });
  });

  it('rejects a missing deviceId', () => {
    expect(thermostatState.safeParse({ setpoint: 20 }).success).toBe(false);
  });

  it('rejects a non-numeric setpoint', () => {
    expect(thermostatState.safeParse({ deviceId: 'esp32', setpoint: 'hot' }).success).toBe(false);
  });
});

describe('setpointRequest schema', () => {
  it('accepts a temperature in range', () => {
    expect(setpointRequest.parse({ temperature: 18 })).toEqual({ temperature: 18 });
  });

  it.each([-1, 31])('rejects out-of-range temperature %d', (temperature) => {
    expect(setpointRequest.safeParse({ temperature }).success).toBe(false);
  });

  it('rejects a missing temperature', () => {
    expect(setpointRequest.safeParse({}).success).toBe(false);
  });
});

describe('setpointResponse schema', () => {
  it('accepts a persisted setpoint', () => {
    const parsed = setpointResponse.parse({
      deviceId: 'esp32',
      setpoint: 18,
      setpointUpdatedAt: '2026-06-03T20:05:00Z',
    });
    expect(parsed.setpoint).toBe(18);
  });
});
