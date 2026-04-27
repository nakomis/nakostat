import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: Record<string, unknown>): Promise<void> => {
  const tableName = process.env.READINGS_TABLE_NAME!;
  const timestamp = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  await client.send(new PutCommand({
    TableName: tableName,
    Item: { locationId: 'pi', timestamp, ttl, ...event },
  }));
};
