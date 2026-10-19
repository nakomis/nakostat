import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../lambda/api/get-state-handler';
import { apiEvent, structured } from './api-event';

const dynamoMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  dynamoMock.reset();
  process.env.STATE_TABLE_NAME = 'nakostat-state-sandbox';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const items: Record<string, Record<string, unknown>> = {
  pi: { deviceId: 'pi', temperature: 19.8, mode: 'heat', setpoint: 20.5, seen: 'a' },
  heatlink: { deviceId: 'heatlink', mode: 'auto', relay: true, switch: 'auto', seen: 'b' },
  schedule: { deviceId: 'schedule', schedule: { Mon: [] }, timestamp: 't', seen: 'c' },
};

function stubItems(present: string[]) {
  for (const id of ['pi', 'heatlink', 'schedule']) {
    dynamoMock
      .on(GetCommand, { TableName: 'nakostat-state-sandbox', Key: { deviceId: id } })
      .resolves(present.includes(id) ? { Item: items[id] } : {});
  }
}

describe('get state handler', () => {
  test('returns pi, heatlink and schedule without their deviceId', async () => {
    stubItems(['pi', 'heatlink', 'schedule']);
    const result = structured(await handler(apiEvent()));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      pi: { temperature: 19.8, mode: 'heat', setpoint: 20.5, seen: 'a' },
      heatlink: { mode: 'auto', relay: true, switch: 'auto', seen: 'b' },
      schedule: { schedule: { Mon: [] }, timestamp: 't', seen: 'c' },
    });
    expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(3);
  });

  test('returns 200 with nulls when nothing has reported yet', async () => {
    stubItems([]);
    const result = structured(await handler(apiEvent()));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ pi: null, heatlink: null, schedule: null });
  });

  test('a missing item is null while the others are returned', async () => {
    stubItems(['pi']);
    const body = JSON.parse(structured(await handler(apiEvent())).body);
    expect(Object.keys(body)).toEqual(['pi', 'heatlink', 'schedule']);
    expect(body.heatlink).toBeNull();
    expect(body.schedule).toBeNull();
    expect(body.pi.temperature).toBe(19.8);
  });

  test('returns 500 when DynamoDB fails', async () => {
    dynamoMock.on(GetCommand).rejects(new Error('DynamoDB error'));
    const result = structured(await handler(apiEvent()));
    expect(result.statusCode).toBe(500);
    expect(result.body).toContain('Internal server error');
  });
});
