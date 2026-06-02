import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { handler } from '../lambda/api/setpoint-handler';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const iotMock = mockClient(IoTDataPlaneClient);

beforeEach(() => {
  dynamoMock.reset();
  iotMock.reset();
  process.env.STATE_TABLE_NAME = 'nakostat-state-sandbox';
  process.env.DEPLOY_ENV = 'sandbox';
});

describe('setpoint handler', () => {
  const baseEvent = {
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'user-123',
          },
        },
      },
    },
  } as unknown as APIGatewayProxyEventV2;

  test('returns 401 if not authorised', async () => {
    const event = { ...baseEvent, requestContext: { authorizer: {} } } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;
    expect(result.statusCode).toBe(401);
    expect(result.body).toContain('Unauthorized');
  });

  test('returns 400 if no request body', async () => {
    const event = { ...baseEvent, body: undefined } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Request body is required');
  });

  test('returns 400 if body is invalid JSON', async () => {
    const event = { ...baseEvent, body: 'not json' } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Invalid JSON');
  });

  test('returns 400 if temperature is not a number', async () => {
    const event = { ...baseEvent, body: JSON.stringify({ temperature: 'twenty' }) } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('between 0 and 30');
  });

  test('returns 400 if temperature is below 0°C', async () => {
    const event = { ...baseEvent, body: JSON.stringify({ temperature: -1 }) } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('between 0 and 30');
  });

  test('returns 400 if temperature is above 30°C', async () => {
    const event = { ...baseEvent, body: JSON.stringify({ temperature: 31 }) } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('between 0 and 30');
  });

  test('successfully updates setpoint and publishes MQTT message', async () => {
    dynamoMock.on(UpdateCommand).resolves({});
    iotMock.on(PublishCommand).resolves({});

    const event = { ...baseEvent, body: JSON.stringify({ temperature: 20 }) } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('20');
    expect(result.body).toContain('esp32');
    expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(1);
    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(1);

    const publishCall = iotMock.commandCalls(PublishCommand)[0];
    const publishPayload = JSON.parse(publishCall.args[0].input.payload as string);
    expect(publishPayload.temperature).toBe(20);
    expect(publishPayload.userId).toBe('user-123');
  });

  test('accepts valid temperature at boundary 0°C', async () => {
    dynamoMock.on(UpdateCommand).resolves({});
    iotMock.on(PublishCommand).resolves({});

    const event = { ...baseEvent, body: JSON.stringify({ temperature: 0 }) } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('0');
  });

  test('accepts valid temperature at boundary 30°C', async () => {
    dynamoMock.on(UpdateCommand).resolves({});
    iotMock.on(PublishCommand).resolves({});

    const event = { ...baseEvent, body: JSON.stringify({ temperature: 30 }) } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('30');
  });

  test('returns 500 on database error', async () => {
    dynamoMock.on(UpdateCommand).rejects(new Error('DynamoDB error'));

    const event = { ...baseEvent, body: JSON.stringify({ temperature: 20 }) } as unknown as APIGatewayProxyEventV2;
    const result = (await handler(event)) as any;

    expect(result.statusCode).toBe(500);
    expect(result.body).toContain('Internal server error');
  });
});
