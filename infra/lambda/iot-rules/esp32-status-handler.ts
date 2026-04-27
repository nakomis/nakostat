import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: Record<string, unknown>): Promise<void> => {
  const tableName = process.env.STATE_TABLE_NAME!;
  const updatedAt = new Date().toISOString();
  await client.send(new PutCommand({
    TableName: tableName,
    Item: { deviceId: 'esp32', updatedAt, ...event },
  }));
};
