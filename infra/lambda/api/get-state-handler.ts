import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tableName = process.env.STATE_TABLE_NAME!;
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { deviceId: 'esp32' },
  }));
  if (!result.Item) {
    return { statusCode: 404, headers: cors, body: JSON.stringify({ message: 'No state found' }) };
  }
  return { statusCode: 200, headers: cors, body: JSON.stringify(result.Item) };
};
