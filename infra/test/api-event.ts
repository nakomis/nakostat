import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

/** An HTTP API (v2) event as the Cognito JWT authoriser passes it on. */
export function apiEvent(body?: unknown, sub: string | null = 'user-123'): APIGatewayProxyEventV2 {
  return {
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    requestContext: { authorizer: sub ? { jwt: { claims: { sub } } } : {} },
  } as unknown as APIGatewayProxyEventV2;
}

/** Narrows a handler result to the structured form every handler returns. */
export function structured(result: unknown): APIGatewayProxyStructuredResultV2 & { body: string } {
  return result as APIGatewayProxyStructuredResultV2 & { body: string };
}
