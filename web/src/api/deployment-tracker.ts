import { z } from 'zod';

/** Project key nakostat records its deployments under in the tracker. */
export const TRACKER_PROJECT = 'nakostat';

/**
 * The tracker's `GET /deployments/{project}/{environment}/latest` returns the
 * most recent DynamoDB item for `project#environment`. Only `version` matters
 * here; the other fields are tolerated but not relied upon.
 */
const latestDeploymentSchema = z.object({
  version: z.string().min(1),
  commitHash: z.string().optional(),
  deployedAt: z.string().optional(),
});

/**
 * Maps the web app's `env` (`prod`, `sandbox`, `localhost` or a placeholder)
 * onto a tracker environment. Anything other than prod reads sandbox, which is
 * what a local build is pointed at.
 */
export function trackerEnvironment(env: string): 'prod' | 'sandbox' {
  return env === 'prod' ? 'prod' : 'sandbox';
}

export function latestDeploymentUrl(baseUrl: string, environment: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/deployments/${TRACKER_PROJECT}/${encodeURIComponent(environment)}/latest`;
}

export interface FetchDeployedVersionOptions {
  baseUrl: string;
  environment: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches the currently deployed version from the tracker.
 *
 * Resolves to `null` rather than throwing on any failure (network or CORS
 * error, 403 from the IAM-only API, 404 when nothing is recorded, or an
 * unexpected body): the version badge is decoration and must never break the UI.
 */
export async function fetchDeployedVersion({
  baseUrl,
  environment,
  signal,
  fetchImpl = fetch,
}: FetchDeployedVersionOptions): Promise<string | null> {
  try {
    const response = await fetchImpl(latestDeploymentUrl(baseUrl, environment), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    const parsed = latestDeploymentSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
}
