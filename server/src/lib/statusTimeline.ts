export type TimelineStatus = 'online' | 'no_data' | 'offline' | 'none';

export type OfflineReason =
  | 'system_down'
  | 'source_network'
  | 'source_silent'
  | 'source_auth'
  | 'disabled';

export const ONLINE_TOLERANCE_MS = 5_000;
export const DISCONNECT_GRACE_MS = 10_000;
export const MAX_SAMPLE_GAP_MS = 120_000;
export const DEFAULT_MIN_FRAMES_PER_WINDOW = 10;

// Đọc lùi đủ xa để có sample liền trước rangeFrom; nếu không, phút đầu của
// mỗi khung sẽ bị coi là không có dữ liệu.
export const SAMPLE_LOOKBACK_MS = MAX_SAMPLE_GAP_MS + 30_000;

export interface TimelineSample {
  ts: Date;
  state: string;
  ageMs: number;
  frames?: number;
  windowSec?: number;
}

export interface ConnectionInterval {
  from: Date;
  to: Date | null;
  reason?: string | null;
}

export interface DowntimeInterval {
  from: Date;
  to: Date | null;
  reason?: OfflineReason;
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
  downtime?: DowntimeInterval[];
  minFramesPerWindow?: number;
  currentStatus?: Exclude<TimelineStatus, 'none'>;
  currentReason?: OfflineReason | null;
}

export interface StatusBucket {
  from: string;
  to: string;
  status: TimelineStatus;
  reason?: OfflineReason;
}

export interface StatusTimeline {
  rangeFrom: string;
  to: string;
  createdAt: string | null;
  buckets: StatusBucket[];
  segments: StatusBucket[];
  onlineSec: number;
  offlineSec: number;
  noDataSec: number;
  noneSec: number;
  totalSec: number;
  uptimePct: number;
  current: TimelineStatus;
  currentReason: OfflineReason | null;
  offlineReasons: Record<string, number>;
}

function lastDataAt(sample: TimelineSample): number {
  return sample.ts.getTime() - Math.max(0, sample.ageMs);
}

function lowerBound(samples: TimelineSample[], atMs: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].ts.getTime() < atMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sampleWindowMs(sample: TimelineSample): number {
  return Math.max(1000, Math.round((sample.windowSec ?? 60) * 1000));
}

// Số frame trong cửa sổ 60 giây phủ thời điểm atMs. Sample được ghi ở cuối
// cửa sổ, nên sample kế tiếp có thể là sample phủ atMs. Nếu không sample nào
// phủ atMs thì trả 0, không suy diễn dữ liệu từ sample cách xa.
function framesAt(samples: TimelineSample[], atMs: number, fallbackMinFrames: number): number {
  if (samples.length === 0) return 0;
  const index = lowerBound(samples, atMs);
  const sample = index < samples.length ? samples[index] : samples[samples.length - 1];
  if (!sample) return 0;
  const windowMs = sampleWindowMs(sample);
  if (atMs < sample.ts.getTime() - windowMs) return 0;
  if (atMs > sample.ts.getTime() + windowMs) return 0;
  if (sample.frames === null || sample.frames === undefined) {
    return sample.state === 'streaming' ? fallbackMinFrames : 0;
  }
  return sample.frames;
}

export interface LiveStatusOptions {
  connected?: boolean;
  everConnected?: boolean;
  disconnectAgeMs?: number | null;
  framesRecent?: number | null;
  minFramesPerWindow?: number;
}

export function statusForLiveAge(
  ageMs: number | null | undefined,
  options: LiveStatusOptions = {}
): Exclude<TimelineStatus, 'none'> {
  const age = ageMs === null || ageMs === undefined ? null : Number(ageMs);
  if (options.connected) {
    if (options.framesRecent !== null && options.framesRecent !== undefined) {
      const minFrames = options.minFramesPerWindow ?? DEFAULT_MIN_FRAMES_PER_WINDOW;
      return Number(options.framesRecent) >= minFrames ? 'online' : 'no_data';
    }
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

export function offlineReasonFromClose(reason: string | null | undefined): OfflineReason {
  const value = String(reason ?? '').toLowerCase();
  if (value.includes('auth')) return 'source_auth';
  if (value.includes('network') || value.includes('timeout') || value.includes('proxy') || value.includes('dial')) {
    return 'source_network';
  }
  if (value.includes('disabled') || value.includes('lock')) return 'disabled';
  return 'source_silent';
}

interface TimelineStep {
  start: number;
  end: number;
  status: Exclude<TimelineStatus, 'none'>;
  reason?: OfflineReason;
}

const STEP_STATUSES = ['online', 'no_data', 'offline'] as const;

function dominantStatus(
  durations: Record<(typeof STEP_STATUSES)[number], number>,
  fallback: Exclude<TimelineStatus, 'none'>
): Exclude<TimelineStatus, 'none'> {
  let best = fallback;
  for (const status of STEP_STATUSES) {
    if (durations[status] > durations[best]) best = status;
  }
  return best;
}

export function buildStatusTimeline(options: StatusTimelineOptions): StatusTimeline {
  const bucketMs = Math.max(1, Math.round(options.bucketSec * 1000));
  const resolutionMs = Math.max(
    1000,
    Math.round((options.resolutionSec ?? Math.min(options.bucketSec, 60)) * 1000)
  );
  const minFrames = options.minFramesPerWindow ?? DEFAULT_MIN_FRAMES_PER_WINDOW;
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
  const downtime = (options.downtime ?? [])
    .filter((interval) => Number.isFinite(interval.from.getTime()))
    .sort((a, b) => a.from.getTime() - b.from.getTime());
  const hasConnectionInfo = Boolean(options.hasConnectionInfo);

  const downtimeAt = (atMs: number): DowntimeInterval | null => {
    for (const interval of downtime) {
      const from = interval.from.getTime();
      const to = interval.to ? interval.to.getTime() : nowMs;
      if (atMs >= from && atMs < to) return interval;
    }
    return null;
  };

  const connectedIgnoringDowntime = (atMs: number): boolean => {
    if (hasConnectionInfo) {
      return connections.some(
        (interval) =>
          interval.from.getTime() <= atMs &&
          (interval.to === null || atMs < interval.to.getTime())
      );
    }
    // Không có thông tin session: suy ra kết nối từ việc có frame trong cửa sổ.
    return framesAt(samples, atMs, minFrames) > 0;
  };

  const reasonFromLastConnection = (atMs: number): OfflineReason => {
    let last: ConnectionInterval | null = null;
    for (const interval of connections) {
      if (interval.to && interval.to.getTime() <= atMs) last = interval;
    }
    if (!last) return 'source_silent';
    return offlineReasonFromClose(last.reason);
  };

  const detailAt = (
    atMs: number
  ): { status: TimelineStatus; reason?: OfflineReason } => {
    if (atMs < activeStartMs || atMs >= endMs) return { status: 'none' };
    const frames = framesAt(samples, atMs, minFrames);
    if (frames >= minFrames) return { status: 'online' };
    const down = downtimeAt(atMs);
    if (down) {
      return { status: 'offline', reason: down.reason ?? 'system_down' };
    }
    if (connectedIgnoringDowntime(atMs)) return { status: 'no_data' };
    return { status: 'offline', reason: reasonFromLastConnection(atMs) };
  };

  const steps: TimelineStep[] = [];
  let online = 0;
  let offline = 0;
  let noData = 0;
  for (let cursor = activeStartMs; cursor < endMs; cursor += resolutionMs) {
    const stepEnd = Math.min(endMs, cursor + resolutionMs);
    let detail: { status: TimelineStatus; reason?: OfflineReason };
    if (stepEnd >= endMs && options.currentStatus) {
      detail = { status: options.currentStatus, reason: options.currentReason ?? undefined };
    } else {
      detail = detailAt(cursor + (stepEnd - cursor) / 2);
    }
    if (detail.status === 'none') {
      // Không xảy ra vì vòng lặp bắt đầu tại activeStart, nhưng giữ an toàn.
      continue;
    }
    const status = detail.status as Exclude<TimelineStatus, 'none'>;
    const seconds = (stepEnd - cursor) / 1000;
    if (status === 'online') online += seconds;
    else if (status === 'no_data') noData += seconds;
    else offline += seconds;
    steps.push({ start: cursor, end: stepEnd, status, reason: detail.reason });
  }

  const bucketCount =
    endMs > rangeFromMs ? Math.ceil((endMs - rangeFromMs) / bucketMs) : 0;
  const bucketDurations = Array.from({ length: bucketCount }, () => ({
    online: 0,
    no_data: 0,
    offline: 0,
    last: null as Exclude<TimelineStatus, 'none'> | null,
    reasons: {
      online: undefined as OfflineReason | undefined,
      no_data: undefined as OfflineReason | undefined,
      offline: undefined as OfflineReason | undefined
    }
  }));
  for (const step of steps) {
    let cursor = step.start;
    while (cursor < step.end) {
      const index = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor((cursor - rangeFromMs) / bucketMs))
      );
      const bucketEnd = Math.min(endMs, rangeFromMs + (index + 1) * bucketMs);
      const chunkEnd = Math.min(step.end, bucketEnd);
      if (chunkEnd <= cursor) break;
      bucketDurations[index][step.status] += chunkEnd - cursor;
      bucketDurations[index].last = step.status;
      bucketDurations[index].reasons[step.status] = step.reason;
      cursor = chunkEnd;
    }
  }

  const buckets: StatusBucket[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const startMs = rangeFromMs + index * bucketMs;
    const bucketEndMs = Math.min(startMs + bucketMs, endMs);
    if (bucketEndMs <= activeStartMs) {
      buckets.push({
        from: new Date(startMs).toISOString(),
        to: new Date(bucketEndMs).toISOString(),
        status: 'none'
      });
      continue;
    }
    const durations = bucketDurations[index];
    // Bucket rộng (10 phút / 1 giờ) phản ánh trạng thái chiếm phần lớn thời gian,
    // không lấy một điểm giữa bucket.
    const status = dominantStatus(durations, durations.last ?? 'online');
    const reason = durations.reasons[status];
    buckets.push({
      from: new Date(startMs).toISOString(),
      to: new Date(bucketEndMs).toISOString(),
      status,
      ...(reason ? { reason } : {})
    });
  }

  const segments: StatusBucket[] = [];
  // Phần trước khi tạo vẫn phải nằm trong dòng thời gian; nếu chỉ trả các step
  // đang hoạt động, thanh timeline sẽ kéo giãn và mất mốc "trước khi tạo".
  if (activeStartMs > rangeFromMs) {
    const noneEndMs = Math.min(endMs, activeStartMs);
    if (noneEndMs > rangeFromMs) {
      segments.push({
        from: new Date(rangeFromMs).toISOString(),
        to: new Date(noneEndMs).toISOString(),
        status: 'none'
      });
    }
  }
  for (const step of steps) {
    const from = new Date(step.start).toISOString();
    const to = new Date(step.end).toISOString();
    const last = segments[segments.length - 1];
    if (last && last.status === step.status && last.reason === step.reason) {
      last.to = to;
    } else {
      segments.push({
        from,
        to,
        status: step.status,
        ...(step.reason ? { reason: step.reason } : {})
      });
    }
  }

  const offlineReasons: Record<string, number> = {};
  for (const step of steps) {
    if (step.status !== 'offline' || !step.reason) continue;
    offlineReasons[step.reason] =
      (offlineReasons[step.reason] ?? 0) + (step.end - step.start) / 1000;
  }
  for (const key of Object.keys(offlineReasons)) {
    offlineReasons[key] = Math.round(offlineReasons[key]);
  }

  const onlineSec = Math.round(online);
  const offlineSec = Math.round(offline);
  const noDataSec = Math.round(noData);
  const totalSec = Math.max(0, onlineSec + offlineSec + noDataSec);
  const noneSec = Math.max(0, Math.round((activeStartMs - rangeFromMs) / 1000));
  const lastStep = steps[steps.length - 1];
  const fallbackCurrent = detailAt(endMs > activeStartMs ? endMs - 1 : endMs);
  const current: TimelineStatus =
    endMs <= activeStartMs
      ? 'none'
      : options.currentStatus ?? lastStep?.status ?? fallbackCurrent.status ?? 'offline';
  const currentReason: OfflineReason | null =
    endMs <= activeStartMs
      ? null
      : options.currentStatus
        ? options.currentReason ?? null
        : lastStep?.reason ?? fallbackCurrent.reason ?? null;

  return {
    rangeFrom: options.rangeFrom.toISOString(),
    to: new Date(endMs).toISOString(),
    createdAt: options.createdAt ? options.createdAt.toISOString() : null,
    buckets,
    segments,
    onlineSec,
    offlineSec,
    noDataSec,
    noneSec,
    totalSec,
    uptimePct: totalSec > 0 ? Math.min(100, (onlineSec / totalSec) * 100) : 0,
    current,
    currentReason,
    offlineReasons
  };
}
