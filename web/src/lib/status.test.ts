import { describe, expect, it } from 'vitest';
import { formatAge, formatClock, formatDuration, isStale } from './status';

const now = Date.parse('2026-10-19T10:00:00Z');

describe('isStale', () => {
  it('is fresh within 3 minutes', () => {
    expect(isStale('2026-10-19T09:57:30Z', now)).toBe(false);
  });
  it('is stale after 3 minutes', () => {
    expect(isStale('2026-10-19T09:56:00Z', now)).toBe(true);
  });
  it('treats garbage as stale', () => {
    expect(isStale('nope', now)).toBe(true);
  });
});

describe('formatAge', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatAge('2026-10-19T09:59:30Z', now)).toBe('30s ago');
    expect(formatAge('2026-10-19T09:55:00Z', now)).toBe('5 min ago');
    expect(formatAge('2026-10-19T08:30:00Z', now)).toBe('1h 30m ago');
  });
});

describe('formatDuration', () => {
  it('formats', () => {
    expect(formatDuration(25 * 60000)).toBe('25m');
    expect(formatDuration(135 * 60000)).toBe('2h 15m');
  });
});

describe('formatClock', () => {
  it('returns HH:MM', () => {
    expect(formatClock('2026-10-19T10:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
  });
});
