import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../lambda/api/mode-handler';
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

describe('mode handler', () => {
  test('returns 401 without a Cognito subject', async () => {
    const result = structured(await handler(apiEvent({ mode: 'heat' }, null)));
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 without a body', async () => {
    expect(structured(await handler(apiEvent())).statusCode).toBe(400);
  });

  test('returns 400 for invalid JSON', async () => {
    expect(structured(await handler(apiEvent('{'))).statusCode).toBe(400);
  });

  test('returns 400 when the body is not a JSON object', async () => {
    const result = structured(await handler(apiEvent('["heat"]')));
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('JSON object');
  });

  test.each(['HEAT', 'auto', '', 1, undefined])('returns 400 for mode %p', async (mode) => {
    const result = structured(await handler(apiEvent({ mode })));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('"heat" or "off"');
    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  test.each(['heat', 'off'])('publishes mode %s to api/mode', async (mode) => {
    const result = structured(await handler(apiEvent({ mode })));

    expect(result.statusCode).toBe(202);
    const calls = iotMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.topic).toBe('nakostat/sandbox/api/mode');
    expect(JSON.parse(calls[0].args[0].input.payload as string)).toEqual({
      mode,
      timestamp: '2026-10-19T07:30:00.000Z',
      userId: 'user-123',
    });
  });

  test('returns 500 when the publish fails', async () => {
    iotMock.on(PublishCommand).rejects(new Error('IoT down'));
    expect(structured(await handler(apiEvent({ mode: 'off' }))).statusCode).toBe(500);
  });
});
