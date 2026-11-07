import { z } from 'zod';
import { callGoInternal } from './internalApi';

export const WALLY_COMPANY_CODE = 'WALLY';
export const RESERVED_CASTER_PORTS = new Set([1508, 1509, 2101]);
export const CUSTOM_CASTER_PORT_MIN = 1510;
export const CUSTOM_CASTER_PORT_MAX = 1599;
export const FORBIDDEN_CASTER_PORTS = new Set([8081]);

export function isReservedCasterPort(port: number): boolean {
  return RESERVED_CASTER_PORTS.has(port);
}

export function isCustomCasterPort(port: number): boolean {
  return port >= CUSTOM_CASTER_PORT_MIN && port <= CUSTOM_CASTER_PORT_MAX;
}

export function isAllowedCasterPort(port: number): boolean {
  return isReservedCasterPort(port) || isCustomCasterPort(port);
}

const portField = z
  .number()
  .int()
  .min(1)
  .max(65535)
  .refine((port) => isAllowedCasterPort(port) && !FORBIDDEN_CASTER_PORTS.has(port), {
    message: 'Port phải là 1508, 1509, 2101 hoặc trong dải 1510-1599'
  });

export const listenerCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  port: portField,
  enabled: z.boolean().optional().default(true),
  role: z.enum(['both', 'source', 'rover']).optional().default('both'),
  description: z.string().max(500).optional().default(''),
  company_id: z.number().int().positive().optional(),
  mountpointIds: z.array(z.number().int().positive()).max(1000).optional()
});

export const listenerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  port: portField.optional(),
  enabled: z.boolean().optional(),
  role: z.enum(['both', 'source', 'rover']).optional(),
  description: z.string().max(500).optional(),
  company_id: z.number().int().positive().nullable().optional(),
  mountpointIds: z.array(z.number().int().positive()).max(1000).optional()
});

export const listenerMountpointsSchema = z.object({
  mountpointIds: z.array(z.number().int().positive()).max(1000)
});

export function isForbiddenCasterPort(port: number): boolean {
  return FORBIDDEN_CASTER_PORTS.has(port);
}

/** Kết nối tối thiểu dùng được cho helper (pool hoặc transaction). */
export interface Queryable {
  query: (sql: string, values?: any) => Promise<any>;
}

/**
 * YC4 — gán một mountpoint vào listener hiện có cùng công ty.
 * companyId = null nghĩa là mountpoint toàn cục (D18-10): gán vào mọi listener.
 * Dùng INSERT IGNORE để chống trùng và chạy được trong transaction.
 */
export async function mapMountpointToCompanyListeners(
  conn: Queryable,
  mountpointId: number,
  companyId: number | null
): Promise<number> {
  const [result] = await conn.query(
    companyId === null
      ? `INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id)
         SELECT id, ? FROM caster_listeners`
      : `INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id)
         SELECT id, ? FROM caster_listeners WHERE company_id = ?`,
    companyId === null ? [mountpointId] : [mountpointId, companyId]
  );
  return Number(result?.affectedRows ?? 0);
}

/**
 * Remap toàn bộ mountpoint → listener cùng công ty. Dùng cho import để xử lý
 * trường hợp listener được tạo sau mountpoint. company NULL áp dụng mọi listener.
 */
export async function remapAllMountpointsToCompanyListeners(conn: Queryable): Promise<number> {
  await conn.query(
    `DELETE lm FROM caster_listener_mountpoints lm
       JOIN mountpoints m ON m.id = lm.mountpoint_id
       JOIN caster_listeners l ON l.id = lm.listener_id
      WHERE m.company_id IS NOT NULL
        AND l.company_id IS NOT NULL
        AND m.company_id <> l.company_id`
  );
  const [result] = await conn.query(
    `INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id)
     SELECT l.id, m.id
       FROM mountpoints m
       JOIN caster_listeners l
         ON (m.company_id IS NULL OR l.company_id = m.company_id)`
  );
  return Number(result?.affectedRows ?? 0);
}

export function isListenerEnabled(row: { enabled: unknown }): boolean {
  return Number(row.enabled) === 1;
}

export function publicListener(row: any) {
  return {
    id: Number(row.id),
    name: String(row.name),
    port: Number(row.port),
    enabled: Boolean(row.enabled),
    role: String(row.role),
    description: String(row.description ?? ''),
    global: row.company_id === null || row.company_id === undefined,
    companyId:
      row.company_id === null || row.company_id === undefined
        ? null
        : Number(row.company_id),
    companyName: row.company_name ?? null,
    mountpointCount: Number(row.mountpoint_count ?? 0),
    ownerWebUserId:
      row.owner_web_user_id === null || row.owner_web_user_id === undefined
        ? null
        : Number(row.owner_web_user_id),
    ownerName: row.owner_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface GoConnection {
  id: number;
  direction: 'source' | 'rover';
  listenerId: number;
  mountpointId: number;
  accountId: number | null;
  accountUsername?: string;
  remoteAddr: string;
  userAgent: string;
  startTs: string;
  bytesIn: number;
  bytesOut: number;
  fixType?: string;
  roverLat?: number | null;
  roverLon?: number | null;
  roverAlt?: number | null;
  roverSats?: number | null;
  roverFixTs?: string;
}

/**
 * Danh sách online chỉ gồm tài khoản NTRIP đã xác thực: chiều rover và có
 * account_id. Nguồn publish (source) không thuộc trang này; nó hiển thị ở
 * CORS → Listener → Kết nối.
 */
export function selectOnlineConnections(items: GoConnection[]): GoConnection[] {
  return items.filter(
    (item) => item.direction === 'rover' && item.accountId !== null && item.accountId !== undefined
  );
}

export async function fetchCasterConnections(): Promise<{
  available: boolean;
  items: GoConnection[];
}> {
  try {
    const response = await callGoInternal<{ items: GoConnection[] }>(
      '/internal/caster/connections',
      undefined,
      { method: 'GET' }
    );
    return { available: true, items: response?.items ?? [] };
  } catch {
    return { available: false, items: [] };
  }
}

export function publicConnection(
  item: GoConnection,
  listenerName: string | undefined,
  mountpointName: string | undefined,
  accountUsername: string | undefined
) {
  return {
    id: Number(item.id),
    direction: item.direction,
    listenerId: Number(item.listenerId),
    listenerName: listenerName ?? '',
    mountpointId: Number(item.mountpointId),
    mountpointName: mountpointName ?? '',
    accountId: item.accountId === null ? null : Number(item.accountId),
    accountUsername: accountUsername || item.accountUsername || '',
    remoteAddr: item.remoteAddr ?? '',
    userAgent: item.userAgent ?? '',
    startTs: item.startTs,
    bytesIn: Number(item.bytesIn ?? 0),
    bytesOut: Number(item.bytesOut ?? 0),
    fixType: item.fixType ?? '',
    roverLat: item.roverLat ?? null,
    roverLon: item.roverLon ?? null,
    roverAlt: item.roverAlt ?? null,
    roverSats: item.roverSats ?? null,
    roverFixTs: item.roverFixTs ?? null
  };
}
