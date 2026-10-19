import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../lambda/iot-rules/device-state-handler';

const dynamoMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  dynamoMock.reset();
  dynamoMock.on(PutCommand).resolves({});
  process.env.STATE_TABLE_NAME = 'nakostat-state-sandbox';
  jest.useFakeTimers({ now: new Date('2026-10-19T12:34:56.789Z') });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const heatlinkStatus = {
  mode: 'auto',
  relay: true,
  switch: 'auto',
  source: 'schedule',
  demand_age_s: 12,
  schedule_known: true,
  time_valid: true,
  rssi: -61,
  uptime_s: 3600,
  reason: 'heartbeat',
};

describe('device state handler', () => {
  test('writes heatlink status as deviceId "heatlink" with seen = receive time', async () => {
    await handler({ ...heatlinkStatus, deviceId: 'heatlink' });

    const calls = dynamoMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      TableName: 'nakostat-state-sandbox',
      Item: { ...heatlinkStatus, deviceId: 'heatlink', seen: '2026-10-19T12:34:56.789Z' },
    });
  });

  test('writes pi state as deviceId "pi"', async () => {
    const piState = {
      timestamp: '2026-10-19T12:34:00Z',
      temperature: 19.8,
      mode: 'heat',
      override: null,
      heatlink: null,
    };
    await handler({ ...piState, deviceId: 'pi' });

    const item = dynamoMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item).toEqual({ ...piState, deviceId: 'pi', seen: '2026-10-19T12:34:56.789Z' });
  });

  test('writes the schedule as deviceId "schedule"', async () => {
    const schedule = { schedule: { Mon: [{ at: '07:00', targetC: 20 }] }, timestamp: 'x' };
    await handler({ ...schedule, deviceId: 'schedule' });

    const item = dynamoMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item?.deviceId).toBe('schedule');
    expect(item?.schedule).toEqual(schedule.schedule);
  });

  test('a payload cannot overwrite the receive time', async () => {
    await handler({ deviceId: 'heatlink', seen: '1970-01-01T00:00:00Z' });
    const item = dynamoMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item?.seen).toBe('2026-10-19T12:34:56.789Z');
  });

  test.each([undefined, 'esp32', 42])('drops a message with deviceId %p', async (deviceId) => {
    await handler({ ...heatlinkStatus, deviceId } as Record<string, unknown>);
    expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });
});
