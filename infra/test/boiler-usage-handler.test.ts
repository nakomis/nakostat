import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../lambda/api/boiler-usage-handler';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const dynamoMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  dynamoMock.reset();
  process.env.BOILER_USAGE_TABLE_NAME = 'nakostat-boiler-usage-sandbox';
});

describe('boiler-usage handler', () => {
  const baseEvent = {
    queryStringParameters: undefined,
    requestContext: {},
  } as unknown as APIGatewayProxyEventV2;

  const mockEvent = (queryStringParameters?: Record<string, string>) => ({
    ...baseEvent,
    queryStringParameters,
  } as unknown as APIGatewayProxyEventV2);

  test('returns events from last 30 days by default', async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          boilerId: 'esp32',
          timestamp: now.toISOString(),
          state: 'on',
          source: 'UserRequest',
          userId: 'user-123',
        },
      ],
    });

    const result = (await handler(mockEvent())) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].state).toBe('on');
  });

  test('accepts custom from and to date ranges', async () => {
    const from = '2026-04-01T00:00:00Z';
    const to = '2026-04-30T23:59:59Z';

    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const result = (await handler(mockEvent({ from, to }))) as any;

    expect(result.statusCode).toBe(200);
    const queryCall = dynamoMock.commandCalls(QueryCommand)[0]!;
    expect(queryCall.args[0].input.ExpressionAttributeValues![':from']).toBe(new Date(from).toISOString());
    expect(queryCall.args[0].input.ExpressionAttributeValues![':to']).toBe(new Date(to).toISOString());
  });

  test('returns 400 if from date is invalid', async () => {
    const result = (await handler(mockEvent({ from: 'not-a-date' }))) as any;
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Invalid date format');
  });

  test('returns 400 if to date is invalid', async () => {
    const result = (await handler(mockEvent({ to: 'not-a-date' }))) as any;
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Invalid date format');
  });

  test('returns 400 if from is after to', async () => {
    const result = (await handler(mockEvent({
      from: '2026-04-30T00:00:00Z',
      to: '2026-04-01T00:00:00Z',
    }))) as any;
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('from date must be before to date');
  });

  test('filters events by source when source query param is provided', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          boilerId: 'esp32',
          timestamp: '2026-04-27T10:00:00Z',
          state: 'on',
          source: 'Schedule',
        },
        {
          boilerId: 'esp32',
          timestamp: '2026-04-27T11:00:00Z',
          state: 'off',
          source: 'UserRequest',
          userId: 'user-123',
        },
      ],
    });

    const result = (await handler(mockEvent({ source: 'UserRequest' }))) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(body[0].source).toBe('UserRequest');
  });

  test('returns events sorted newest-first (ScanIndexForward: false)', async () => {
    const now = new Date();
    const events = [
      {
        boilerId: 'esp32',
        timestamp: now.toISOString(),
        state: 'on',
        source: 'Schedule',
      },
      {
        boilerId: 'esp32',
        timestamp: new Date(now.getTime() - 1000).toISOString(),
        state: 'off',
        source: 'Schedule',
      },
    ];

    dynamoMock.on(QueryCommand).resolves({ Items: events });

    const result = (await handler(mockEvent())) as any;

    const queryCall = dynamoMock.commandCalls(QueryCommand)[0];
    expect(queryCall.args[0].input.ScanIndexForward).toBe(false);
  });

  test('returns 500 on database error', async () => {
    dynamoMock.on(QueryCommand).rejects(new Error('DynamoDB error'));

    const result = (await handler(mockEvent())) as any;

    expect(result.statusCode).toBe(500);
    expect(result.body).toContain('Internal server error');
  });

  test('returns empty array when no events found', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const result = (await handler(mockEvent())) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });
});
