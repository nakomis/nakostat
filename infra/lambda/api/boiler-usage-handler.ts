import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface BoilerEvent {
  boilerId: string;
  timestamp: string;
  state: 'on' | 'off';
  source: string;
  userId?: string;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tableName = process.env.BOILER_USAGE_TABLE_NAME!;
  const queryParams = event.queryStringParameters || {};

  const fromParam = queryParams.from;
  const toParam = queryParams.to;
  const sourceFilter = queryParams.source;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const from = fromParam ? new Date(fromParam) : thirtyDaysAgo;
  const to = toParam ? new Date(toParam) : now;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ message: 'Invalid date format. Use ISO-8601 format.' }),
    };
  }

  if (from > to) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ message: 'from date must be before to date' }),
    };
  }

  try {
    const result = await client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'boilerId = :boilerId AND #ts BETWEEN :from AND :to',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':boilerId': 'esp32',
        ':from': from.toISOString(),
        ':to': to.toISOString(),
      },
      ScanIndexForward: false,
    }));

    let events = (result.Items || []) as BoilerEvent[];

    if (sourceFilter) {
      events = events.filter(e => e.source === sourceFilter);
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(events),
    };
  } catch (error) {
    console.error('Error querying boiler usage:', error);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
