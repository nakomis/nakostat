import configJson from './config.json';

export interface NakostatConfig {
  env: string;
  aws: { region: string };
  cognito: {
    authority: string;
    userPoolId: string;
    userPoolClientId: string;
    cognitoDomain: string;
    redirectUri: string;
    logoutUri: string;
  };
  api: { apiUrl: string };
  /** Shared deployment tracker (nakomis-infra) that records the deployed version. */
  deploymentTracker?: { trackerUrl?: string };
}

/** Public URL of the shared deployment tracker API (always the prod account). */
export const DEFAULT_TRACKER_URL = 'https://api.infra.nakomis.com';

/**
 * Tracker base URL from config, falling back to the default when the key is
 * missing, empty or still an unreplaced `<PLACEHOLDER>` token (e.g. an older
 * `config.json` written before the key existed).
 */
export function resolveTrackerUrl(config: Pick<NakostatConfig, 'deploymentTracker'>): string {
  const url = config.deploymentTracker?.trackerUrl?.trim();
  return url && !url.startsWith('<') ? url : DEFAULT_TRACKER_URL;
}

/**
 * Runtime configuration, baked in at build time.
 *
 * `config.json` holds placeholder tokens in source control; `scripts/set-config.sh`
 * overwrites it from SSM for a given environment before a real build/deploy.
 */
const Config = configJson as NakostatConfig;

export default Config;
