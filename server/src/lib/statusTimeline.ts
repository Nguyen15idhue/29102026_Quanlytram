export type TimelineStatus = 'online' | 'no_data' | 'offline' | 'none';

export const ONLINE_TOLERANCE_MS = 5_000;
export const DISCONNECT_GRACE_MS = 10_000;
const SAMPLE_INTERVAL_MS = 90_000;

export interface TimelineSample {
  ts: Date;
  state: string;
  ageMs: number;
}

export interface ConnectionInterval {
  from: Date;
  to: Date | null;
}

export interface StatusTimelineOptions {
  createdAt: Date | null;
  deletedAt?: Date | null;
  rangeFrom: Date;
  now: Date;
  bucketSec: number;
  resolutionSec?: number;
  samples: TimelineSample[];
  connections?: ConnectionInterval[];
  hasConnectionInfo?: boolean;
  currentStatus?: Exclude<TimelineStatus, 'none'>;
}

export interface StatusBucket {
  from: string;
  to: string;
  status: TimelineStatus;
}

export interface StatusTimeline {
  rangeFrom: string;
  to: string;
  createdAt: string | null;
  buckets: StatusBucket[];
  onlineSec: number;
  offlineSec: number;
  noDataSec: number;
  noneSec: number;
  totalSec: number;
  uptimePct: number;
  current: TimelineStatus;
}

function lastDataAt(sample: TimelineSample): number {
  return sample.ts.getTime() - Math.max(0, sample.ageMs);
}

function upperBound(samples: TimelineSample[], atMs: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].ts.getTime() <= atMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export interface LiveStatusOptions {
  connected?: boolean;
  everConnected?: boolean;
  disconnectAgeMs?: number | null;
}

export function statusForLiveAge(
  ageMs: number | null | undefined,
  options: LiveStatusOptions = {}
): Exclude<TimelineStatus, 'none'> {
  const age = ageMs === null || ageMs === undefined ? null : Number(ageMs);
  if (options.connected) {
    return age !== null && age <= ONLINE_TOLERANCE_MS ? 'online' : 'no_data';
  }
  if (options.everConnected === false) return 'offline';
  if (options.disconnectAgeMs !== null && options.disconnectAgeMs !== undefined) {
    return Number(options.disconnectAgeMs) <= DISCONNECT_GRACE_MS ? 'no_data' : 'offline';
  }
  if (age !== null && age <= ONLINE_TOLERANCE_MS) return 'online';
  if (age !== null && age <= DISCONNECT_GRACE_MS) return 'no_data';
  return 'offline';
}

export function combinedRelayStatus(
  upstream: Exclude<TimelineStatus, 'none'>,
  downstream: Exclude<TimelineStatus, 'none'>
): Exclude<TimelineStatus, 'none'> {
  if (upstream === 'offline' || downstream === 'offline') return 'offline';
  if (upstream === 'online' && downstream === 'online') return 'online';
  return 'no_data';
}

export const TIMELINE_RANGES = {
  '1h': { hours: 1, bucketSec: 10, resolutionSec: 10, seriesBucketSec: 60 },
  '24h': { hours: 24, bucketSec: 60, resolutionSec: 10, seriesBucketSec: 300 },
  '7d': { hours: 24 * 7, bucketSec: 600, resolutionSec: 60, seriesBucketSec: 1800 },
  '1m': { hours: 24 * 30, bucketSec: 3600, resolutionSec: 60, seriesBucketSec: 7200 }
} as const;

export type TimelineRange = keyof typeof TIMELINE_RANGES;

export function timelineRange(value: unknown): TimelineRange {
  return value === '1h' || value === '7d' || value === '1m' ? value : '24h';
}

export function buildStatusTimeline(options: StatusTimelineOptions): StatusTimeline {
  const bucketMs = Math.max(1, Math.round(options.bucketSec * 1000));
  const resolutionMs = Math.max(
    1000,
    Math.round((options.resolutionSec ?? Math.min(options.bucketSec, 60)) * 1000)
  );
  const rangeFromMs = options.rangeFrom.getTime();
  const nowMs = options.now.getTime();
  const endMs = Math.min(nowMs, options.deletedAt ? options.deletedAt.getTime() : nowMs);
  const createdAtMs = options.createdAt ? options.createdAt.getTime() : rangeFromMs;
  const activeStartMs = Math.max(rangeFromMs, createdAtMs);
  const samples = [...options.samples]
    .filter((sample) => Number.isFinite(sample.ts.getTime()))
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const connections = (options.connections ?? [])
    .filter((interval) => Number.isFinite(interval.from.getTime()))
    .sort((a, b) => a.from.getTime() - b.from.getTime());
  const hasConnectionInfo = Boolean(options.hasConnectionInfo);
  const firstConnectionStart = connections.length
    ? connections[0].from.getTime()
    : null;

  const connectedAt = (atMs: number) =>
    connections.some(
      (interval) =>
        interval.from.getTime() <= atMs &&
        (interval.to === null || atMs < interval.to.getTime())
    );
  const lastDisconnectBefore = (atMs: number) => {
    let last: number | null = null;
    for (const interval of connections) {
      if (interval.to && interval.to.getTime() <= atMs) {
        last = Math.max(last ?? 0, interval.to.getTime());
      }
    }
    return last;
  };
  const streamingAt = (atMs: number) => {
    const index = upperBound(samples, atMs) - 1;
    const previous = index >= 0 ? samples[index] : null;
    const next = index + 1 < samples.length ? samples[index + 1] : null;
    if (previous?.state === 'streaming') {
      const dataEnd = next
        ? lastDataAt(next)
        : Math.min(nowMs, lastDataAt(previous) + SAMPLE_INTERVAL_MS);
      if (atMs < dataEnd) return true;
    }
    if (next?.state === 'streaming' && atMs >= lastDataAt(next)) return true;
    return false;
  };
  const statusAt = (atMs: number): TimelineStatus => {
    if (atMs < activeStartMs || atMs >= endMs) return 'none';
    const streaming = streamingAt(atMs);
    if (
      hasConnectionInfo &&
      firstConnectionStart !== null &&
      atMs >= firstConnectionStart
    ) {
      if (connectedAt(atMs)) return streaming ? 'online' : 'no_data';
      const lastEnd = lastDisconnectBefore(atMs);
      if (lastEnd === null) return 'offline';
      return atMs < lastEnd + DISCONNECT_GRACE_MS ? 'no_data' : 'offline';
    }
    if (streaming) return 'online';
    const index = upperBound(samples, atMs) - 1;
    const previous = index >= 0 ? samples[index] : null;
    if (!previous) return 'offline';
    return atMs < lastDataAt(previous) + DISCONNECT_GRACE_MS ? 'no_data' : 'offline';
  };

  const buckets: StatusBucket[] = [];
  if (endMs > rangeFromMs) {
    for (let startMs = rangeFromMs; startMs < endMs; startMs += bucketMs) {
      const bucketEndMs = Math.min(startMs + bucketMs, endMs);
      const activeFromMs = Math.max(startMs, activeStartMs);
      const activeToMs = Math.min(bucketEndMs, endMs);
      let status: TimelineStatus = 'none';
      if (activeToMs > activeFromMs) {
        const referenceMs = Math.min(
          activeToMs,
          Math.max(activeFromMs, startMs + bucketMs / 2)
        );
        status =
          activeToMs >= endMs && options.currentStatus
            ? options.currentStatus
            : statusAt(referenceMs);
      }
      buckets.push({
        from: new Date(startMs).toISOString(),
        to: new Date(bucketEndMs).toISOString(),
        status
      });
    }
  }

  let online = 0;
  let offline = 0;
  let noData = 0;
  for (let cursor = activeStartMs; cursor < endMs; cursor += resolutionMs) {
    const stepEnd = Math.min(endMs, cursor + resolutionMs);
    const status = statusAt(cursor + (stepEnd - cursor) / 2);
    const seconds = (stepEnd - cursor) / 1000;
    if (status === 'online') online += seconds;
    else if (status === 'no_data') noData += seconds;
    else if (status === 'offline') offline += seconds;
  }
  const onlineSec = Math.round(online);
  const offlineSec = Math.round(offline);
  const noDataSec = Math.round(noData);
  const totalSec = Math.max(0, onlineSec + offlineSec + noDataSec);
  const noneSec = Math.max(0, Math.round((activeStartMs - rangeFromMs) / 1000));
  const lastBucket = [...buckets].reverse().find((bucket) => bucket.status !== 'none');
  const current: TimelineStatus =
    endMs <= activeStartMs
      ? 'none'
      : options.currentStatus ?? (lastBucket ? lastBucket.status : 'offline');

  return {
    rangeFrom: options.rangeFrom.toISOString(),
    to: new Date(endMs).toISOString(),
    createdAt: options.createdAt ? options.createdAt.toISOString() : null,
    buckets,
    onlineSec,
    offlineSec,
    noDataSec,
    noneSec,
    totalSec,
    uptimePct: totalSec > 0 ? Math.min(100, (onlineSec / totalSec) * 100) : 0,
    current
  };
}
