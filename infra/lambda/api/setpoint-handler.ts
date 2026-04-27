import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const iotClient = new IoTDataPlaneClient({});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface SetpointRequest {
  temperature: number;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tableName = process.env.STATE_TABLE_NAME!;
  const deployEnv = process.env.DEPLOY_ENV || 'sandbox';
  const userId = (event.requestContext as any).authorizer?.claims?.sub;

  if (!userId) {
    return {
      statusCode: 401,
      headers: cors,
      body: JSON.stringify({ message: 'Unauthorized' }),
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ message: 'Request body is required' }),
    };
  }

  let body: SetpointRequest;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ message: 'Invalid JSON in request body' }),
    };
  }

  const { temperature } = body;

  if (typeof temperature !== 'number' || temperature < 0 || temperature > 30) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ message: 'Temperature must be between 0 and 30°C' }),
    };
  }

  const now = new Date().toISOString();

  try {
    await dynamoClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { deviceId: 'esp32' },
      UpdateExpression: 'SET setpoint = :temp, setpointUpdatedAt = :timestamp',
      ExpressionAttributeValues: {
        ':temp': temperature,
        ':timestamp': now,
      },
    }));

    const mqttPayload = {
      temperature,
      timestamp: now,
      userId,
    };

    await iotClient.send(new PublishCommand({
      topic: `nakostat/${deployEnv}/api/setpoint`,
      qos: 1,
      payload: JSON.stringify(mqttPayload),
    }));

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        deviceId: 'esp32',
        setpoint: temperature,
        setpointUpdatedAt: now,
      }),
    };
  } catch (error) {
    console.error('Error updating setpoint:', error);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
