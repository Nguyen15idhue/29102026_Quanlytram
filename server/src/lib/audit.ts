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

function companyFrom(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).company_id;
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
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
    const explicitCompany = companyFrom(after) ?? companyFrom(before);
    await pool.query(
      `INSERT INTO audit_logs
         (actor_web_user_id, company_id, action, entity_type, entity_id,
          before_redacted, after_redacted, ip)
       SELECT ?, COALESCE(?, (SELECT company_id FROM web_users WHERE id = ?)),
              ?, ?, ?, ?, ?, ?`,
      [
        actorWebUserId,
        explicitCompany,
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
