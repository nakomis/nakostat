import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../lambda/iot-rules/pish-setpoint-handler';

const dynamoMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  dynamoMock.reset();
  process.env.STATE_TABLE_NAME = 'nakostat-state-sandbox';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const validEvent = {
  temperature: 21.5,
  timestamp: '2026-10-13T07:30:00.000Z',
  userId: 'nakostat-pish-sandbox',
};

describe('Pish setpoint handler', () => {
  test('writes the setpoint to the esp32 state item', async () => {
    dynamoMock.on(UpdateCommand).resolves({});
    await handler(validEvent);

    const calls = dynamoMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('nakostat-state-sandbox');
    expect(input.Key).toEqual({ deviceId: 'esp32' });
    expect(input.UpdateExpression).toBe('SET setpoint = :temp, setpointUpdatedAt = :timestamp');
    expect(input.ExpressionAttributeValues?.[':temp']).toBe(21.5);
    expect(input.ExpressionAttributeValues?.[':timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  test('accepts the boundary values 0 and 30', async () => {
    dynamoMock.on(UpdateCommand).resolves({});
    await handler({ ...validEvent, temperature: 0 });
    await handler({ ...validEvent, temperature: 30 });
    expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(2);
  });

  test('works without a userId', async () => {
    dynamoMock.on(UpdateCommand).resolves({});
    await handler({ temperature: 19 });
    expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  test.each([
    ['missing', undefined],
    ['a string', '21'],
    ['below range', -1],
    ['above range', 30.5],
    ['NaN', NaN],
  ])('drops a temperature that is %s', async (_label, temperature) => {
    await handler({ ...validEvent, temperature });
    expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });

  test('propagates DynamoDB errors so IoT records the failure', async () => {
    dynamoMock.on(UpdateCommand).rejects(new Error('boom'));
    await expect(handler(validEvent)).rejects.toThrow('boom');
  });
});
