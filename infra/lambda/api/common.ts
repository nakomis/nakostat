import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const iotClient = new IoTDataPlaneClient({});

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: cors, body: JSON.stringify(body) };
}

import { MAX_SETPOINT_C, MIN_SETPOINT_C } from '../shared/limits';

export { MAX_SETPOINT_C, MIN_SETPOINT_C };

export function isValidTemperature(t: unknown): t is number {
  return typeof t === 'number' && Number.isFinite(t) && t >= MIN_SETPOINT_C && t <= MAX_SETPOINT_C;
}

export const badRequest = (message: string) => json(400, { message });

/** The Cognito subject the HTTP API (v2) JWT authoriser verified, if any. */
export function userIdOf(event: APIGatewayProxyEventV2): string | undefined {
  const context = event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: { sub?: unknown } } };
  };
  const sub = context.authorizer?.jwt?.claims?.sub;
  return typeof sub === 'string' && sub !== '' ? sub : undefined;
}

/**
 * A control request from the web dashboard, ready to forward to the Pi daemon: the authorised user
 * and the parsed JSON body, or the error response to return instead.
 */
export type ControlRequest =
  | { ok: true; userId: string; body: Record<string, unknown> }
  | { ok: false; response: APIGatewayProxyStructuredResultV2 };

export function parseControlRequest(event: APIGatewayProxyEventV2): ControlRequest {
  const userId = userIdOf(event);
  if (!userId) return { ok: false, response: json(401, { message: 'Unauthorized' }) };
  if (!event.body) return { ok: false, response: badRequest('Request body is required') };

  let body: unknown;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { ok: false, response: badRequest('Invalid JSON in request body') };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, response: badRequest('Request body must be a JSON object') };
  }
  return { ok: true, userId, body: body as Record<string, unknown> };
}

/**
 * Publishes a request on `nakostat/{env}/api/{name}` for the Pi daemon, the authority on what the
 * heating does, stamped with the time and the user. Answers 202 with the published message: the
 * daemon applies it, and its next `pi/state` shows the result.
 */
export async function publishToDaemon(
  name: 'setpoint' | 'mode' | 'schedule',
  userId: string,
  fields: Record<string, unknown>,
): Promise<APIGatewayProxyStructuredResultV2> {
  const deployEnv = process.env.DEPLOY_ENV || 'sandbox';
  const message = { ...fields, timestamp: new Date().toISOString(), userId };
  try {
    await iotClient.send(
      new PublishCommand({
        topic: `nakostat/${deployEnv}/api/${name}`,
        qos: 1,
        payload: JSON.stringify(message),
      }),
    );
  } catch (error) {
    console.error(`Error publishing ${name}:`, error);
    return json(500, { message: 'Internal server error' });
  }
  return json(202, message);
}
