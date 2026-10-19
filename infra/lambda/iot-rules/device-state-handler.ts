import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** The state-table items this handler may write; the rule SQL names one with `'x' AS deviceId`. */
export const DEVICE_IDS = ['heatlink', 'pi', 'schedule'] as const;

/**
 * Stores the latest message of one device in the state table, replacing the previous item:
 * the heatlink's status, the Pi daemon's state or the daemon's schedule. `seen` is when IoT
 * delivered it (ISO-8601), so a reader can tell a stale device from a quiet one.
 */
export const handler = async (event: Record<string, unknown>): Promise<void> => {
  const { deviceId } = event;
  if (typeof deviceId !== 'string' || !(DEVICE_IDS as readonly string[]).includes(deviceId)) {
    console.warn('Ignoring state message with unexpected deviceId:', JSON.stringify(event));
    return;
  }

  await client.send(
    new PutCommand({
      TableName: process.env.STATE_TABLE_NAME!,
      Item: { ...event, deviceId, seen: new Date().toISOString() },
    }),
  );
};
