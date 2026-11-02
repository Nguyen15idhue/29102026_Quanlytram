import { RowDataPacket } from 'mysql2/promise';
import { runtimeQuery } from '../db/runtimePool';
import type { DowntimeInterval, OfflineReason } from './statusTimeline';

// Khoảng nghỉ nhỏ hơn ngưỡng này được coi là nhịp heartbeat bình thường.
export const SERVICE_GAP_MS = 45_000;

export interface ServiceRun {
  startedAt: Date;
  lastSeenAt: Date;
  stoppedAt: Date | null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function pushInterval(
  target: DowntimeInterval[],
  fromMs: number,
  toMs: number,
  rangeFrom: Date,
  rangeTo: Date
): void {
  const start = Math.max(rangeFrom.getTime(), fromMs);
  const end = Math.min(rangeTo.getTime(), toMs);
  if (end > start) {
    const reason: OfflineReason = 'system_down';
    target.push({ from: new Date(start), to: new Date(end), reason });
  }
}

// Suy ra các khoảng service dừng từ danh sách service_runs. Hàm thuần để test.
export function buildDowntimeIntervals(
  runs: ServiceRun[],
  rangeFrom: Date,
  rangeTo: Date
): DowntimeInterval[] {
  const sorted = [...runs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const intervals: DowntimeInterval[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const end = current.stoppedAt ?? current.lastSeenAt;
    const next = sorted[index + 1];
    if (next) {
      if (next.startedAt.getTime() - end.getTime() > SERVICE_GAP_MS) {
        pushInterval(
          intervals,
          end.getTime(),
          next.startedAt.getTime(),
          rangeFrom,
          rangeTo
        );
      }
      continue;
    }
    // Run cuối: nếu đã dừng hoặc heartbeat cũ hơn ngưỡng thì kéo downtime tới
    // rangeTo (thường là now) để timeline hiện offline.
    if (rangeTo.getTime() - end.getTime() > SERVICE_GAP_MS) {
      pushInterval(intervals, end.getTime(), rangeTo.getTime(), rangeFrom, rangeTo);
    }
  }

  return intervals;
}

export async function loadServiceDowntime(
  rangeFrom: Date,
  rangeTo: Date
): Promise<DowntimeInterval[]> {
  try {
    const previous = await runtimeQuery<RowDataPacket[]>(
      `SELECT started_at, last_seen_at, stopped_at
         FROM service_runs
        WHERE service = 'go' AND started_at < ?
        ORDER BY started_at DESC LIMIT 1`,
      [rangeFrom]
    );
    const within = await runtimeQuery<RowDataPacket[]>(
      `SELECT started_at, last_seen_at, stopped_at
         FROM service_runs
        WHERE service = 'go' AND started_at >= ? AND started_at <= ?
        ORDER BY started_at ASC`,
      [rangeFrom, rangeTo]
    );

    const runs: ServiceRun[] = [];
    for (const row of [...previous, ...within]) {
      const startedAt = toDate(row.started_at);
      const lastSeenAt = toDate(row.last_seen_at);
      if (!startedAt || !lastSeenAt) continue;
      runs.push({ startedAt, lastSeenAt, stoppedAt: toDate(row.stopped_at) });
    }
    return buildDowntimeIntervals(runs, rangeFrom, rangeTo);
  } catch {
    // Bảng service_runs có thể chưa được migrate; timeline vẫn chạy.
    return [];
  }
}
