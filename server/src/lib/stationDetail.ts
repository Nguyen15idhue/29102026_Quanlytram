export type TransportStatus = 'online' | 'stale' | 'offline' | 'error' | 'unknown';
export type QualityStatus = 'good' | 'warning' | 'critical' | 'unknown';
export type MetadataStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export interface Reliability {
  windowSec: number;
  sampleCount: number;
  validSampleCount: number;
  dataCompleteness: number;
  observationStartedAt: string | null;
  scoreUpdatedAt: string | null;
  lastDataAt: string | null;
}

export interface ReliabilitySample {
  ts: unknown;
  state?: unknown;
  frames?: unknown;
}

const SAMPLE_INTERVAL_SEC = 60;
const ONLINE_AGE_MS = 5_000;
const STALE_AGE_MS = 30_000;

export function transportStatusFor(
  state: string | null | undefined,
  ageMs: number | null | undefined
): TransportStatus {
  const normalized = String(state ?? '').toLowerCase();
  if (normalized === 'error') return 'error';
  if (ageMs === null || ageMs === undefined || !Number.isFinite(ageMs) || ageMs < 0) {
    return 'unknown';
  }
  if (ageMs <= ONLINE_AGE_MS && normalized === 'streaming') return 'online';
  if (ageMs <= STALE_AGE_MS) return 'stale';
  return 'offline';
}

export function qualityStatusFor(input: {
  score: number | null | undefined;
  state?: string | null;
  metadataOk: boolean;
  hasMsm: boolean;
}): QualityStatus {
  const state = String(input.state ?? '').toLowerCase();
  if (state === 'error') return 'critical';
  if (input.score === null || input.score === undefined || !Number.isFinite(input.score)) {
    return 'unknown';
  }
  if (input.score >= 85 && input.metadataOk && input.hasMsm) return 'good';
  if (input.score >= 60) return 'warning';
  return 'critical';
}

export function metadataStatusFor(input: {
  present: boolean;
  streaming: boolean;
  reportedStationId: number | null | undefined;
  hasArp: boolean;
  antenna: string | null | undefined;
}): MetadataStatus {
  if (!input.present) return 'unknown';
  const hasId = input.reportedStationId !== null && input.reportedStationId !== undefined;
  if (input.streaming && !hasId && !input.hasArp) return 'critical';
  if (hasId && input.hasArp && Boolean(input.antenna)) return 'ok';
  return 'warning';
}

export function sampleHasArp(sample: Record<string, unknown> | null | undefined): boolean {
  if (!sample) return false;
  return (
    sample.arp_x !== null &&
    sample.arp_x !== undefined &&
    sample.arp_y !== null &&
    sample.arp_y !== undefined &&
    sample.arp_z !== null &&
    sample.arp_z !== undefined
  );
}

export function sampleMetadataOk(sample: Record<string, unknown> | null | undefined): boolean {
  if (!sample) return false;
  const hasId =
    sample.reported_station_id !== null && sample.reported_station_id !== undefined;
  return hasId && sampleHasArp(sample);
}

export function buildReliability(
  samples: ReliabilitySample[],
  options: { windowSec?: number; now?: number } = {}
): Reliability {
  const windowSec = Math.max(60, options.windowSec ?? 900);
  const now = options.now ?? Date.now();
  const from = now - windowSec * 1000;
  const expected = Math.max(1, Math.ceil(windowSec / SAMPLE_INTERVAL_SEC));

  const rows = samples
    .map((sample) => {
      const date = new Date(sample.ts as string | number | Date);
      return {
        date,
        state: String(sample.state ?? '').toLowerCase(),
        frames: Number(sample.frames ?? 0)
      };
    })
    .filter((sample) => Number.isFinite(sample.date.getTime()))
    .filter((sample) => sample.date.getTime() >= from && sample.date.getTime() <= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const valid = rows.filter(
    (sample) => sample.frames > 0 && sample.state !== 'error' && sample.state !== 'unknown'
  );
  const started = rows[0]?.date ?? null;
  const updated = rows[rows.length - 1]?.date ?? null;

  return {
    windowSec,
    sampleCount: rows.length,
    validSampleCount: valid.length,
    dataCompleteness: rows.length === 0 ? 0 : Math.min(1, valid.length / expected),
    observationStartedAt: started ? started.toISOString() : null,
    scoreUpdatedAt: updated ? updated.toISOString() : null,
    lastDataAt: updated ? updated.toISOString() : null
  };
}
