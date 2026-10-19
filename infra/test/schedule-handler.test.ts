import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { mockClient } from 'aws-sdk-client-mock';
import { handler, validateSchedule } from '../lambda/api/schedule-handler';
import { apiEvent, structured } from './api-event';

const iotMock = mockClient(IoTDataPlaneClient);

beforeEach(() => {
  iotMock.reset();
  iotMock.on(PublishCommand).resolves({});
  process.env.DEPLOY_ENV = 'sandbox';
  jest.useFakeTimers({ now: new Date('2026-10-19T07:30:00.000Z') });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const weekday = [
  { at: '06:30', targetC: 20 },
  { at: '09:00', targetC: 16.5 },
  { at: '17:30', targetC: 20.5 },
  { at: '22:30', targetC: 15 },
];
const week = () => ({
  Mon: weekday,
  Tue: weekday,
  Wed: weekday,
  Thu: weekday,
  Fri: weekday,
  Sat: [{ at: '08:00', targetC: 20 }],
  Sun: [],
});

describe('validateSchedule', () => {
  test('accepts a full week', () => {
    expect(validateSchedule(week())).toEqual({ ok: true, schedule: week() });
  });

  test('keeps only at and targetC from each entry', () => {
    const s = { ...week(), Sun: [{ at: '00:00', targetC: 5, colour: 'red' }] };
    const result = validateSchedule(s);
    expect(result.ok && result.schedule.Sun).toEqual([{ at: '00:00', targetC: 5 }]);
  });

  test.each([
    ['not an object', [], 'object'],
    ['null', null, 'object'],
    [
      'a missing day',
      (() => {
        const { Sun: _, ...rest } = week();
        return rest;
      })(),
      'Sun',
    ],
    ['an unknown day', { ...week(), Funday: [] }, 'Funday'],
    ['a day that is not an array', { ...week(), Mon: {} }, 'Mon'],
    [
      'nine entries in a day',
      { ...week(), Tue: Array.from({ length: 9 }, (_, i) => ({ at: `0${i}:00`, targetC: 18 })) },
      'at most 8',
    ],
    ['an entry that is not an object', { ...week(), Wed: ['07:00'] }, 'Wed'],
    ['24:00', { ...week(), Thu: [{ at: '24:00', targetC: 18 }] }, 'HH:MM'],
    ['7:00 (no leading zero)', { ...week(), Thu: [{ at: '7:00', targetC: 18 }] }, 'HH:MM'],
    ['12:60', { ...week(), Thu: [{ at: '12:60', targetC: 18 }] }, 'HH:MM'],
    ['a numeric time', { ...week(), Thu: [{ at: 700, targetC: 18 }] }, 'HH:MM'],
    ['4.5 °C', { ...week(), Fri: [{ at: '07:00', targetC: 4.5 }] }, '5 and 30'],
    ['a target off the 0.5 grid', { ...week(), Fri: [{ at: '07:00', targetC: 20.3 }] }, '0.5'],
    [
      'duplicate times in a day',
      {
        ...week(),
        Fri: [
          { at: '07:00', targetC: 20 },
          { at: '07:00', targetC: 18 },
        ],
      },
      'duplicate',
    ],
    ['31 °C', { ...week(), Fri: [{ at: '07:00', targetC: 31 }] }, '5 and 30'],
    ['a string target', { ...week(), Fri: [{ at: '07:00', targetC: '20' }] }, '5 and 30'],
  ])('rejects %s', (_label, schedule, message) => {
    const result = validateSchedule(schedule);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
  });

  test('accepts exactly eight entries and the 5/30 °C bounds', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      at: `1${i}:00`,
      targetC: i % 2 ? 5 : 30,
    }));
    expect(validateSchedule({ ...week(), Sat: eight }).ok).toBe(true);
  });
});

describe('schedule handler', () => {
  test('returns 401 without a Cognito subject', async () => {
    const result = structured(await handler(apiEvent({ schedule: week() }, null)));
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 without a body or with invalid JSON', async () => {
    expect(structured(await handler(apiEvent())).statusCode).toBe(400);
    expect(structured(await handler(apiEvent('nope'))).statusCode).toBe(400);
  });

  test('returns 400 when the body has no schedule', async () => {
    const result = structured(await handler(apiEvent(week())));
    expect(result.statusCode).toBe(400);
    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  test('returns 400 with the validation message', async () => {
    const result = structured(
      await handler(apiEvent({ schedule: { ...week(), Mon: [{ at: '25:00', targetC: 20 }] } })),
    );
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('Mon');
  });

  test('publishes the schedule to api/schedule', async () => {
    const result = structured(await handler(apiEvent({ schedule: week() })));

    expect(result.statusCode).toBe(202);
    const calls = iotMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.topic).toBe('nakostat/sandbox/api/schedule');
    expect(JSON.parse(calls[0].args[0].input.payload as string)).toEqual({
      schedule: week(),
      timestamp: '2026-10-19T07:30:00.000Z',
      userId: 'user-123',
    });
  });

  test('returns 500 when the publish fails', async () => {
    iotMock.on(PublishCommand).rejects(new Error('IoT down'));
    expect(structured(await handler(apiEvent({ schedule: week() }))).statusCode).toBe(500);
  });
});
