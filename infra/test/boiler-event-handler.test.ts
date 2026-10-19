import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { BOILER_EVENT_TTL_DAYS, handler } from '../lambda/iot-rules/boiler-event-handler';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const NOW = new Date('2026-10-19T12:34:56.789Z');

beforeEach(() => {
  dynamoMock.reset();
  dynamoMock.on(PutCommand).resolves({});
  process.env.BOILER_USAGE_TABLE_NAME = 'nakostat-boiler-usage-sandbox';
  jest.useFakeTimers({ now: NOW });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const expectedTtl = Math.floor(NOW.getTime() / 1000) + BOILER_EVENT_TTL_DAYS * 24 * 60 * 60;

describe('boiler event handler', () => {
  test('relay on → state "on" for boilerId "heatlink"', async () => {
    await handler({ relay: true, source: 'schedule' });

    const calls = dynamoMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      TableName: 'nakostat-boiler-usage-sandbox',
      Item: {
        boilerId: 'heatlink',
        timestamp: '2026-10-19T12:34:56.789Z',
        state: 'on',
        source: 'schedule',
        ttl: expectedTtl,
      },
    });
  });

  test('relay off → state "off"', async () => {
    await handler({ relay: false, source: 'switch' });
    const item = dynamoMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item?.state).toBe('off');
    expect(item?.source).toBe('switch');
  });

  test.each([
    'schedule',
    'override',
    'frost',
    'off',
    'fallback',
    'switch',
  ])('keeps the spec source %s', async (source) => {
    await handler({ relay: true, source });
    expect(dynamoMock.commandCalls(PutCommand)[0].args[0].input.Item?.source).toBe(source);
  });

  test('a missing or non-string source is recorded as "unknown"', async () => {
    await handler({ relay: true, source: 7 });
    expect(dynamoMock.commandCalls(PutCommand)[0].args[0].input.Item?.source).toBe('unknown');
  });

  test('keeps boiler history for over a year', () => {
    expect(BOILER_EVENT_TTL_DAYS).toBeGreaterThanOrEqual(365);
  });

  test.each([undefined, 'true', 1])('drops a status whose relay is %p', async (relay) => {
    await handler({ relay, source: 'schedule' });
    expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });
});
