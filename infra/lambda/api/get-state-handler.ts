import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { json } from './common';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** The state-table items `GET /state` returns, in this order. */
export const STATE_ITEMS = ['pi', 'heatlink', 'schedule'] as const;

/**
 * `GET /state`: `{"pi": …, "heatlink": …, "schedule": …}`, each the latest message that device
 * published (without its `deviceId` key), or null if it has not reported. Always 200.
 */
export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tableName = process.env.STATE_TABLE_NAME!;
  try {
    const items = await Promise.all(
      STATE_ITEMS.map((deviceId) =>
        client.send(new GetCommand({ TableName: tableName, Key: { deviceId } })),
      ),
    );
    const state = Object.fromEntries(
      STATE_ITEMS.map((id, i) => {
        const item = items[i].Item;
        if (!item) return [id, null];
        const { deviceId: _deviceId, ...rest } = item;
        return [id, rest];
      }),
    );
    return json(200, state);
  } catch (error) {
    console.error('Error reading state:', error);
    return json(500, { message: 'Internal server error' });
  }
};
