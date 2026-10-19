/** A heatlink that has not reported for this long is considered stale. */
export const STALE_AFTER_MS = 3 * 60 * 1000;

export function isStale(seenIso: string, now: number): boolean {
  const seen = Date.parse(seenIso);
  return Number.isNaN(seen) || now - seen > STALE_AFTER_MS;
}

/** "HH:MM" in the viewer's local time. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Human "3 min ago" style age. */
export function formatAge(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}
