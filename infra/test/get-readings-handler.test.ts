import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { handler, MAX_RANGE_ROWS } from '../lambda/api/get-readings-handler';
import { structured } from './api-event';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const NOW = new Date('2026-10-19T12:00:00.000Z');

beforeEach(() => {
  dynamoMock.reset();
  process.env.READINGS_TABLE_NAME = 'nakostat-readings-sandbox';
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

const get = async (queryStringParameters?: Record<string, string>) =>
  structured(await handler({ queryStringParameters } as unknown as APIGatewayProxyEventV2));

const rows = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ locationId: 'pi', temperature: 20, i: i + offset }));

describe('get readings handler — latest N (no range)', () => {
  test('defaults to the newest 100 readings', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: rows(2) });
    const result = await get();

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ readings: rows(2) });
    const input = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input).toEqual({
      TableName: 'nakostat-readings-sandbox',
      KeyConditionExpression: 'locationId = :loc',
      ExpressionAttributeValues: { ':loc': 'pi' },
      ScanIndexForward: false,
      Limit: 100,
    });
  });

  test('ignores a limit that is not a positive number', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    await get({ limit: 'lots' });
    expect(dynamoMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(100);
  });

  test('caps limit at 500', async () => {
    dynamoMock.on(QueryCommand).resolves({});
    const result = await get({ limit: '9999' });
    expect(JSON.parse(result.body)).toEqual({ readings: [] });
    expect(dynamoMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(500);
  });
});

describe('get readings handler — time range', () => {
  test('queries the timestamp range newest-first', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: rows(3) });
    const result = await get({ from: '2026-10-18T12:00:00Z', to: '2026-10-19T12:00:00Z' });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ readings: rows(3) });
    const input = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.KeyConditionExpression).toBe('locationId = :loc AND #ts BETWEEN :from AND :to');
    expect(input.ExpressionAttributeNames).toEqual({ '#ts': 'timestamp' });
    expect(input.ExpressionAttributeValues).toEqual({
      ':loc': 'pi',
      ':from': '2026-10-18T12:00:00.000Z',
      ':to': '2026-10-19T12:00:00.000Z',
    });
    expect(input.ScanIndexForward).toBe(false);
  });

  test('from alone runs to now', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    await get({ from: '2026-10-18T12:00:00Z' });
    const values = dynamoMock.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues;
    expect(values?.[':to']).toBe(NOW.toISOString());
  });

  test('to alone covers the 24 h before it', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    await get({ to: '2026-10-19T00:00:00Z' });
    const values = dynamoMock.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues;
    expect(values?.[':from']).toBe('2026-10-18T00:00:00.000Z');
  });

  test('pages through DynamoDB results', async () => {
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({ Items: rows(2), LastEvaluatedKey: { k: 1 } })
      .resolvesOnce({ Items: rows(2, 2) });
    const result = await get({ from: '2026-10-18T12:00:00Z' });

    expect(JSON.parse(result.body).readings).toEqual(rows(4));
    const calls = dynamoMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({ k: 1 });
  });

  test(`stops at ${MAX_RANGE_ROWS} rows`, async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: rows(1500), LastEvaluatedKey: { k: 1 } });
    const result = await get({ from: '2026-10-01T00:00:00Z' });

    expect(JSON.parse(result.body).readings).toHaveLength(MAX_RANGE_ROWS);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(2);
    expect(dynamoMock.commandCalls(QueryCommand)[1].args[0].input.Limit).toBe(500);
  });

  test('a limit narrows a range', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: rows(10) });
    const result = await get({ from: '2026-10-18T12:00:00Z', limit: '10' });
    expect(JSON.parse(result.body).readings).toHaveLength(10);
    expect(dynamoMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(10);
  });

  test.each([
    [{ from: 'yesterday' }],
    [{ to: 'not-a-date' }],
  ])('returns 400 for an invalid date %p', async (params) => {
    const result = await get(params);
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('ISO-8601');
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test('returns 400 when from is after to', async () => {
    const result = await get({ from: '2026-10-19T12:00:00Z', to: '2026-10-18T12:00:00Z' });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('from must not be after to');
  });
});

describe('get readings handler — errors', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  test.each([
    ['latest', undefined],
    ['range', { from: '2026-10-19T00:00:00Z' }],
  ])('returns 500 with CORS headers when DynamoDB fails (%s)', async (_l, q) => {
    dynamoMock.on(QueryCommand).rejects(new Error('boom'));
    const event = { queryStringParameters: q } as unknown as APIGatewayProxyEventV2;
    const result = structured(await handler(event));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ message: 'Internal server error' });
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });
});
