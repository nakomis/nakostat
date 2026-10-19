import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../lambda/api/setpoint-handler';
import { apiEvent, structured } from './api-event';

const iotMock = mockClient(IoTDataPlaneClient);
const dynamoMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  iotMock.reset();
  dynamoMock.reset();
  iotMock.on(PublishCommand).resolves({});
  process.env.DEPLOY_ENV = 'sandbox';
  jest.useFakeTimers({ now: new Date('2026-10-19T07:30:00.000Z') });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const run = async (body?: unknown) => structured(await handler(apiEvent(body)));

describe('setpoint handler', () => {
  test('returns 401 without a Cognito subject', async () => {
    const result = structured(await handler(apiEvent({ temperature: 20 }, null)));
    expect(result.statusCode).toBe(401);
    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  test('returns 400 without a body', async () => {
    const result = await run();
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Request body is required');
  });

  test('returns 400 for invalid JSON', async () => {
    const result = await run('not json');
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Invalid JSON');
  });

  test.each([
    ['a string', 'twenty'],
    ['below 5 °C', 4.9],
    ['above 30 °C', 30.1],
    ['missing', undefined],
    ['not finite', null],
  ])('returns 400 when the temperature is %s', async (_label, temperature) => {
    const result = await run({ temperature });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('between 5 and 30');
    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  test('publishes the spec payload to api/setpoint only, writing nothing to DynamoDB', async () => {
    const result = await run({ temperature: 20.5 });

    expect(result.statusCode).toBe(202);
    const calls = iotMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.topic).toBe('nakostat/sandbox/api/setpoint');
    expect(calls[0].args[0].input.qos).toBe(1);
    const payload = JSON.parse(calls[0].args[0].input.payload as string);
    expect(payload).toEqual({
      temperature: 20.5,
      timestamp: '2026-10-19T07:30:00.000Z',
      userId: 'user-123',
    });
    expect(JSON.parse(result.body)).toEqual(payload);
    expect(dynamoMock.calls()).toHaveLength(0);
  });

  test.each([5, 30])('accepts the boundary %p °C', async (temperature) => {
    expect((await run({ temperature })).statusCode).toBe(202);
  });

  test('uses the prod topic in prod', async () => {
    process.env.DEPLOY_ENV = 'prod';
    await run({ temperature: 20 });
    expect(iotMock.commandCalls(PublishCommand)[0].args[0].input.topic).toBe(
      'nakostat/prod/api/setpoint',
    );
  });

  test('returns 500 when the publish fails', async () => {
    iotMock.on(PublishCommand).rejects(new Error('IoT down'));
    const result = await run({ temperature: 20 });
    expect(result.statusCode).toBe(500);
    expect(result.body).toContain('Internal server error');
  });
});
