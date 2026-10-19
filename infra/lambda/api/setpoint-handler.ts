import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  badRequest,
  isValidTemperature,
  MAX_SETPOINT_C,
  MIN_SETPOINT_C,
  parseControlRequest,
  publishToDaemon,
} from './common';

/**
 * `POST /setpoint` `{"temperature": 20.5}`: asks the Pi daemon for a manual setpoint (an override
 * until the next schedule transition). Publishes only; the daemon is the authority, so nothing is
 * written to DynamoDB here.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const request = parseControlRequest(event);
  if (!request.ok) return request.response;

  const { temperature } = request.body;
  if (!isValidTemperature(temperature)) {
    return badRequest(`Temperature must be between ${MIN_SETPOINT_C} and ${MAX_SETPOINT_C}°C`);
  }
  return publishToDaemon('setpoint', request.userId, { temperature });
};
