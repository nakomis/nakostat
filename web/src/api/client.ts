import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import Config from '@/config/config';
import { authHeaders } from './auth-token';
import { contract } from './contract';

/**
 * oRPC link that speaks plain REST to our existing API Gateway endpoints.
 * `headers` runs per request, so it always picks up the freshest access token.
 */
const link = new OpenAPILink(contract, {
  url: Config.api.apiUrl,
  headers: authHeaders,
});

/** Typed RPC-style client: `client.getState()`, `client.setpoint({ temperature })`. */
export const client: ContractRouterClient<typeof contract> = createORPCClient(link);

/**
 * TanStack Query helpers derived from the contract:
 *   orpc.getState.queryOptions()
 *   orpc.setpoint.mutationOptions()
 */
export const orpc = createTanstackQueryUtils(client);
