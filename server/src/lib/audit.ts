import { Pool } from 'mysql2/promise';

const SECRET_KEY = /pass|password|token|secret|hash|dsn|authorization|cookie/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '***' : redact(item);
    }
    return out;
  }
  return value;
}

export async function writeAudit(
  pool: Pool,
  actorWebUserId: number | null,
  action: string,
  entityType: string,
  entityId: string | number,
  before: unknown,
  after: unknown,
  ip: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (actor_web_user_id, action, entity_type, entity_id, before_redacted, after_redacted, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        actorWebUserId,
        action,
        entityType,
        String(entityId),
        before === undefined ? null : JSON.stringify(redact(before)),
        after === undefined ? null : JSON.stringify(redact(after)),
        ip
      ]
    );
  } catch (err) {
    console.error('[audit] write failed', err instanceof Error ? err.message : err);
  }
}
