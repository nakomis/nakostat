import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tableName = process.env.READINGS_TABLE_NAME!;
  const limitParam = event.queryStringParameters?.limit;
  const limit = Math.min(parseInt(limitParam ?? '100', 10), 500);
  const result = await client.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'locationId = :loc',
    ExpressionAttributeValues: { ':loc': 'pi' },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return { statusCode: 200, headers: cors, body: JSON.stringify({ readings: result.Items ?? [] }) };
};
