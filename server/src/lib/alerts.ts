import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import type { RawData, RawJob, RawRelayMetric } from '../realtime/filter';

export interface AlertInput {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  targetType: 'relay_job' | 'caster' | 'system';
  targetId: number | null;
  title: string;
  message: string;
  dedupeKey: string;
  ownerId: number | null;
  cooldownMinutes?: number;
}

const MAX_TITLE = 200;
const MAX_MESSAGE = 500;

export async function createAlertOnce(input: AlertInput): Promise<number | null> {
  const cooldownMinutes = input.cooldownMinutes ?? 5;
  const cutoff = new Date(Date.now() - cooldownMinutes * 60_000);
  const existing = await query<RowDataPacket[]>(
    `SELECT id FROM alerts
      WHERE dedupe_key = ? AND created_at > ?
      LIMIT 1`,
    [input.dedupeKey, cutoff]
  );
  if (existing.length > 0) return null;

  const [result] = await query<any>(
    `INSERT INTO alerts
       (type, severity, target_type, target_id, title, message, dedupe_key, owner_web_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.type,
      input.severity,
      input.targetType,
      input.targetId,
      input.title.slice(0, MAX_TITLE),
      input.message.slice(0, MAX_MESSAGE),
      input.dedupeKey,
      input.ownerId
    ]
  );
  return Number(result.insertId);
}

export async function evaluateAlerts(data: RawData): Promise<number> {
  const created: Array<Promise<number | null>> = [];
  if (!data.goOk) {
    created.push(
      createAlertOnce({
        type: 'system.go_unavailable',
        severity: 'critical',
        targetType: 'system',
        targetId: null,
        title: 'Dịch vụ GNSS/relay không phản hồi',
        message: 'Node không lấy được snapshot từ Go internal API. Relay có thể đang gián đoạn.',
        dedupeKey: 'system:go_unavailable',
        ownerId: null
      })
    );
  }
  if (!data.casterOk) {
    created.push(
      createAlertOnce({
        type: 'system.caster_unavailable',
        severity: 'warning',
        targetType: 'caster',
        targetId: null,
        title: 'Không lấy được kết nối caster',
        message: 'Node không lấy được danh sách kết nối caster từ Go internal API.',
        dedupeKey: 'system:caster_unavailable',
        ownerId: null
      })
    );
  }

  const jobById = new Map<number, RawJob>(data.jobs.map((job) => [job.id, job]));
  for (const metric of data.relay) {
    const job = jobById.get(metric.jobId);
    if (!job) continue;
    if (metric.state === 'error') {
      created.push(relayAlert(job, metric, 'critical'));
    } else if (metric.state === 'backoff') {
      created.push(relayAlert(job, metric, 'warning'));
    }
  }

  let count = 0;
  for (const id of await Promise.all(created)) {
    if (id !== null) count += 1;
  }
  return count;
}

function relayAlert(
  job: RawJob,
  metric: RawRelayMetric,
  severity: 'warning' | 'critical'
): Promise<number | null> {
  const detail = metric.lastError ? ` Lỗi: ${metric.lastError}` : '';
  return createAlertOnce({
    type: `relay.state.${metric.state}`,
    severity,
    targetType: 'relay_job',
    targetId: job.id,
    title: `Relay ${job.name} đang ${metric.state}`,
    message: `Relay job #${job.id} ở trạng thái ${metric.state}.${detail}`,
    dedupeKey: `relay:${job.id}:${metric.state}`,
    ownerId: job.ownerId
  });
}
