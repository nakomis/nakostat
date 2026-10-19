import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Boiler history is kept for 13 months, so a year can be compared with the one before. */
export const BOILER_EVENT_TTL_DAYS = 395;

/** The fields the boiler-usage rule selects from a heatlink status with `reason = 'change'`. */
export interface HeatlinkChange {
  relay?: unknown;
  source?: unknown;
}

/**
 * Records a boiler on/off event from a heatlink status change. The heatlink also reports a change
 * when only its mode changes, so consecutive events can share a state; readers treat the history
 * as a series of "state from this time" points.
 */
export const handler = async (event: HeatlinkChange): Promise<void> => {
  if (typeof event.relay !== 'boolean') {
    console.warn('Ignoring heatlink change without a boolean relay:', JSON.stringify(event));
    return;
  }

  const now = Date.now();
  await client.send(
    new PutCommand({
      TableName: process.env.BOILER_USAGE_TABLE_NAME!,
      Item: {
        boilerId: 'heatlink',
        timestamp: new Date(now).toISOString(),
        state: event.relay ? 'on' : 'off',
        source: typeof event.source === 'string' ? event.source : 'unknown',
        ttl: Math.floor(now / 1000) + BOILER_EVENT_TTL_DAYS * 24 * 60 * 60,
      },
    }),
  );
};
