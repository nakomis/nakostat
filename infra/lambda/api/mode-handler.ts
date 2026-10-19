import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { badRequest, parseControlRequest, publishToDaemon } from './common';

export const MODES = ['heat', 'off'] as const;

/** `POST /mode` `{"mode": "heat" | "off"}`: asks the Pi daemon to heat normally or hold frost only. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const request = parseControlRequest(event);
  if (!request.ok) return request.response;

  const { mode } = request.body;
  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) {
    return badRequest('Mode must be "heat" or "off"');
  }
  return publishToDaemon('mode', request.userId, { mode });
};
