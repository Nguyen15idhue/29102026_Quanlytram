import { RowDataPacket } from 'mysql2/promise';
import { runtimeQuery } from '../db/runtimePool';

export interface DataUptimeBucket {
  bucket: string;
  onlineSec: number;
  downSec: number;
  samples: number;
  crcErrors: number;
  parseErrors: number;
}

export interface DataUptimeResult {
  from: string;
  to: string;
  totalSec: number;
  onlineSec: number;
  downSec: number;
  uptimePct: number;
  samples: number;
  crcErrors: number;
  parseErrors: number;
  lastDataAt: string | null;
  buckets: DataUptimeBucket[];
}

export async function dataUptime(input: {
  targetType: 'station' | 'relay_job';
  targetId: number;
  hours: number;
  now?: Date;
}): Promise<DataUptimeResult> {
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - input.hours * 3600_000);
  const rows = await runtimeQuery<RowDataPacket[]>(
    `SELECT ts, direction, window_sec, frames, crc_errors, parse_errors
       FROM quality_samples
      WHERE target_type = ? AND target_id = ? AND ts >= ? AND ts <= ?
      ORDER BY ts`,
    [input.targetType, input.targetId, from, now]
  );

  const byTs = new Map<
    number,
    {
      windowSec: number;
      up: number;
      down: number;
      ingest: number;
      crc: number;
      parse: number;
    }
  >();
  for (const row of rows) {
    const ts = new Date(row.ts).getTime();
    if (!Number.isFinite(ts)) continue;
    const key = Math.floor(ts / 1000);
    const item = byTs.get(key) ?? {
      windowSec: Number(row.window_sec ?? 60),
      up: 0,
      down: 0,
      ingest: 0,
      crc: 0,
      parse: 0
    };
    const frames = Number(row.frames ?? 0);
    if (row.direction === 'upstream') item.up += frames;
    else if (row.direction === 'downstream') item.down += frames;
    else item.ingest += frames;
    item.crc += Number(row.crc_errors ?? 0);
    item.parse += Number(row.parse_errors ?? 0);
    item.windowSec = Math.max(item.windowSec, Number(row.window_sec ?? 60));
    byTs.set(key, item);
  }

  const buckets = new Map<string, DataUptimeBucket>();
  let onlineSec = 0;
  let samples = 0;
  let crcErrors = 0;
  let parseErrors = 0;
  let lastDataAt: string | null = null;
  const ordered = [...byTs.entries()].sort((a, b) => a[0] - b[0]);
  for (const [tsSec, item] of ordered) {
    const online =
      input.targetType === 'station'
        ? item.ingest > 0
        : item.up > 0 && item.down > 0;
    const windowSec = Math.max(1, Math.min(300, item.windowSec));
    const date = new Date(tsSec * 1000);
    const bucketKey = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours()
      )
    ).toISOString();
    const bucket =
      buckets.get(bucketKey) ??
      {
        bucket: bucketKey,
        onlineSec: 0,
        downSec: 0,
        samples: 0,
        crcErrors: 0,
        parseErrors: 0
      };
    bucket.samples += 1;
    bucket.crcErrors += item.crc;
    bucket.parseErrors += item.parse;
    if (online) {
      bucket.onlineSec += windowSec;
      onlineSec += windowSec;
      lastDataAt = date.toISOString();
    } else {
      bucket.downSec += windowSec;
    }
    if (bucket.onlineSec > 3600) bucket.onlineSec = 3600;
    if (bucket.downSec > 3600) bucket.downSec = 3600;
    buckets.set(bucketKey, bucket);
    samples += 1;
    crcErrors += item.crc;
    parseErrors += item.parse;
  }

  const totalSec = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  const cappedOnline = Math.min(totalSec, onlineSec);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    totalSec,
    onlineSec: cappedOnline,
    downSec: Math.max(0, totalSec - cappedOnline),
    uptimePct: totalSec > 0 ? (cappedOnline / totalSec) * 100 : 0,
    samples,
    crcErrors,
    parseErrors,
    lastDataAt,
    buckets: [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
  };
}
