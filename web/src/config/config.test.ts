import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKER_URL, resolveTrackerUrl } from './config';

describe('resolveTrackerUrl', () => {
  it('uses the configured URL', () => {
    expect(resolveTrackerUrl({ deploymentTracker: { trackerUrl: 'https://t.example' } })).toBe(
      'https://t.example',
    );
  });

  it('falls back to the default when missing, empty or a placeholder', () => {
    expect(resolveTrackerUrl({})).toBe(DEFAULT_TRACKER_URL);
    expect(resolveTrackerUrl({ deploymentTracker: { trackerUrl: ' ' } })).toBe(DEFAULT_TRACKER_URL);
    expect(resolveTrackerUrl({ deploymentTracker: { trackerUrl: '<TRACKER_URL>' } })).toBe(
      DEFAULT_TRACKER_URL,
    );
  });
});
