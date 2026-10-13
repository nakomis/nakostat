import { describe, expect, it, vi } from 'vitest';
import {
  fetchDeployedVersion,
  latestDeploymentUrl,
  trackerEnvironment,
} from './deployment-tracker';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('trackerEnvironment', () => {
  it('maps prod to prod and everything else to sandbox', () => {
    expect(trackerEnvironment('prod')).toBe('prod');
    expect(trackerEnvironment('sandbox')).toBe('sandbox');
    expect(trackerEnvironment('localhost')).toBe('sandbox');
    expect(trackerEnvironment('<ENV>')).toBe('sandbox');
  });
});

describe('latestDeploymentUrl', () => {
  it('builds the tracker path, tolerating a trailing slash', () => {
    expect(latestDeploymentUrl('https://api.infra.nakomis.com/', 'prod')).toBe(
      'https://api.infra.nakomis.com/deployments/nakostat/prod/latest',
    );
  });
});

describe('fetchDeployedVersion', () => {
  const baseUrl = 'https://tracker.example';

  it('returns the version from the latest deployment', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        projectEnv: 'nakostat#sandbox',
        deployedAt: '2026-10-01T12:00:00.000Z',
        version: '1.4.2',
        commitHash: 'abc1234',
      }),
    );

    await expect(
      fetchDeployedVersion({ baseUrl, environment: 'sandbox', fetchImpl }),
    ).resolves.toBe('1.4.2');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://tracker.example/deployments/nakostat/sandbox/latest',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns null on a non-OK status (e.g. 403 from the IAM-only API)', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'nope' }, 403));
    await expect(
      fetchDeployedVersion({ baseUrl, environment: 'prod', fetchImpl }),
    ).resolves.toBeNull();
  });

  it('returns null when fetch rejects (network or CORS failure)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      fetchDeployedVersion({ baseUrl, environment: 'prod', fetchImpl }),
    ).resolves.toBeNull();
  });

  it('returns null for an unexpected body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ items: [] }));
    await expect(
      fetchDeployedVersion({ baseUrl, environment: 'prod', fetchImpl }),
    ).resolves.toBeNull();
  });
});
