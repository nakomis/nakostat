import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Payload published by the Pish touch display on nakostat/<env>/pish/setpoint.
 * Same schema as the setpoint API's MQTT message; `userId` is the display's
 * thing name rather than a Cognito subject.
 */
export interface PishSetpointEvent {
  temperature?: unknown;
  timestamp?: unknown;
  userId?: unknown;
}

/**
 * Applies a setpoint from the Pish display to the state table, with the same
 * validation (0–30 °C) and the same attributes as the setpoint API handler.
 * Invalid messages are logged and dropped: there is no caller to reply to.
 */
export const handler = async (event: PishSetpointEvent): Promise<void> => {
  const { temperature, userId } = event;

  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 30) {
    console.warn('Ignoring Pish setpoint with invalid temperature:', JSON.stringify(event));
    return;
  }

  await client.send(new UpdateCommand({
    TableName: process.env.STATE_TABLE_NAME!,
    Key: { deviceId: 'esp32' },
    UpdateExpression: 'SET setpoint = :temp, setpointUpdatedAt = :timestamp',
    ExpressionAttributeValues: {
      ':temp': temperature,
      ':timestamp': new Date().toISOString(),
    },
  }));

  console.log(`Setpoint ${temperature}°C applied from ${typeof userId === 'string' ? userId : 'Pish display'}`);
};
