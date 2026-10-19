import { describe, expect, it } from 'vitest';
import {
  boilerEvent,
  contract,
  heatlinkStatus,
  modeRequest,
  piState,
  readingsResponse,
  scheduleRequest,
  setpointRequest,
  stateResponse,
} from './contract';

const emptyDays = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };
const pi = {
  timestamp: '2026-10-19T10:00:00Z',
  temperature: 19.8,
  humidity: 45.2,
  mode: 'heat',
  setpoint: 20.5,
  scheduled_setpoint: 20,
  override: { setpoint: 20.5, until: '2026-10-19T12:00:00Z' },
  demand: true,
  demand_source: 'override',
};
const hl = {
  mode: 'auto',
  relay: true,
  switch: 'auto',
  source: 'schedule',
  seen: '2026-10-19T10:00:00Z',
  version: '1.0.0',
};

describe('stateResponse', () => {
  it('accepts a full state', () => {
    const parsed = stateResponse.parse({
      pi,
      heatlink: hl,
      schedule: { schedule: emptyDays, timestamp: 'x' },
    });
    expect(parsed.pi?.override?.until).toBe('2026-10-19T12:00:00Z');
  });

  it('accepts all-null parts', () => {
    expect(stateResponse.parse({ pi: null, heatlink: null, schedule: null }).pi).toBeNull();
  });

  it('accepts a pi state with null override and missing sensor', () => {
    expect(piState.safeParse({ ...pi, override: null, temperature: null }).success).toBe(true);
  });

  it('rejects an unknown heatlink mode', () => {
    expect(heatlinkStatus.safeParse({ ...hl, mode: 'weird' }).success).toBe(false);
  });
});

describe('requests', () => {
  it.each([5, 20.5, 30])('accepts setpoint %d', (temperature) => {
    expect(setpointRequest.safeParse({ temperature }).success).toBe(true);
  });

  it.each([4.5, 30.5, 20.25])('rejects setpoint %d', (temperature) => {
    expect(setpointRequest.safeParse({ temperature }).success).toBe(false);
  });

  it('validates mode', () => {
    expect(modeRequest.safeParse({ mode: 'off' }).success).toBe(true);
    expect(modeRequest.safeParse({ mode: 'auto' }).success).toBe(false);
  });

  it('validates schedules', () => {
    expect(scheduleRequest.safeParse({ schedule: emptyDays }).success).toBe(true);
    expect(
      scheduleRequest.safeParse({
        schedule: { ...emptyDays, Mon: [{ at: '06:30', targetC: 20 }] },
      }).success,
    ).toBe(true);
    expect(
      scheduleRequest.safeParse({
        schedule: { ...emptyDays, Mon: [{ at: '25:00', targetC: 20 }] },
      }).success,
    ).toBe(false);
    expect(
      scheduleRequest.safeParse({
        schedule: { ...emptyDays, Mon: [{ at: '06:30', targetC: 31 }] },
      }).success,
    ).toBe(false);
    expect(
      scheduleRequest.safeParse({
        schedule: {
          ...emptyDays,
          Mon: Array.from({ length: 9 }, (_, i) => ({ at: `0${i}:00`, targetC: 20 })),
        },
      }).success,
    ).toBe(false);
    expect(scheduleRequest.safeParse({ schedule: { Mon: [] } }).success).toBe(false);
  });
});

describe('history responses', () => {
  it('accepts readings with extra fields', () => {
    const parsed = readingsResponse.parse({
      readings: [{ timestamp: 't', temperature: 20, humidity: 40, eco2: 400, locationId: 'pi' }],
    });
    expect(parsed.readings[0].temperature).toBe(20);
  });

  it('accepts boiler events', () => {
    expect(boilerEvent.parse({ timestamp: 't', state: 'on', source: 'schedule' }).state).toBe('on');
    expect(boilerEvent.safeParse({ timestamp: 't', state: 'maybe' }).success).toBe(false);
  });
});

describe('contract', () => {
  it('defines every route', () => {
    expect(Object.keys(contract).sort()).toEqual(
      ['getBoilerUsage', 'getReadings', 'getState', 'putSchedule', 'setMode', 'setpoint'].sort(),
    );
  });
});
