export type MountpointSourceState = 'online' | 'stale' | 'offline' | 'error' | 'unknown' | 'disabled';

const STALE_SEC = 120;

export function mountpointSourceState(input: {
  enabled: boolean;
  latest: { state?: unknown; ts?: unknown } | null;
  now?: number;
}): MountpointSourceState {
  if (!input.enabled) return 'disabled';
  if (!input.latest) return 'unknown';
  const state = String(input.latest.state ?? '').toLowerCase();
  if (state === 'error') return 'error';
  const at = new Date(input.latest.ts as string | number | Date);
  if (Number.isNaN(at.getTime())) return 'unknown';
  const ageSec = Math.max(0, ((input.now ?? Date.now()) - at.getTime()) / 1000);
  if (state === 'streaming' && ageSec <= STALE_SEC) return 'online';
  if (ageSec <= STALE_SEC) return 'stale';
  return 'offline';
}
