import { Pool } from 'mysql2/promise';
import { ApiError } from './http';

const SECRET_KEY = /pass|password|token|secret|hash|dsn|authorization|cookie/i;
const SENSITIVE_ACTION = /(^|\.)(delete|lock|unlock|import|change_password|role|permission|seed)(\.|$)/i;

export function isSensitiveAudit(action: string): boolean {
  return SENSITIVE_ACTION.test(action);
}

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
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      return;
    } catch (err) {
      lastError = err;
    }
  }
  console.error(
    '[audit] write failed sau 2 lần thử',
    action,
    lastError instanceof Error ? lastError.message : lastError
  );
  if (isSensitiveAudit(action)) {
    throw new ApiError(500, 'AUDIT_WRITE_FAILED', 'Không ghi được nhật ký kiểm toán');
  }
}
