import { z } from 'zod';

export const FORBIDDEN_CASTER_PORTS = new Set([2101, 8081]);

const portField = z
  .number()
  .int()
  .min(1)
  .max(65535)
  .refine((port) => !FORBIDDEN_CASTER_PORTS.has(port), {
    message: 'Không dùng cổng 2101 hoặc 8081'
  });

export const listenerCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  port: portField,
  enabled: z.boolean().optional().default(true),
  role: z.enum(['both', 'source', 'rover']).optional().default('both'),
  description: z.string().max(500).optional().default(''),
  mountpointIds: z.array(z.number().int().positive()).max(1000).optional()
});

export const listenerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  port: portField.optional(),
  enabled: z.boolean().optional(),
  role: z.enum(['both', 'source', 'rover']).optional(),
  description: z.string().max(500).optional(),
  mountpointIds: z.array(z.number().int().positive()).max(1000).optional()
});

export const listenerMountpointsSchema = z.object({
  mountpointIds: z.array(z.number().int().positive()).max(1000)
});

export function isForbiddenCasterPort(port: number): boolean {
  return FORBIDDEN_CASTER_PORTS.has(port);
}

export function publicListener(row: any) {
  return {
    id: Number(row.id),
    name: String(row.name),
    port: Number(row.port),
    enabled: Boolean(row.enabled),
    role: String(row.role),
    description: String(row.description ?? ''),
    mountpointCount: Number(row.mountpoint_count ?? 0),
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
  remoteAddr: string;
  userAgent: string;
  startTs: string;
  bytesIn: number;
  bytesOut: number;
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
    accountUsername: accountUsername ?? '',
    remoteAddr: item.remoteAddr ?? '',
    userAgent: item.userAgent ?? '',
    startTs: item.startTs,
    bytesIn: Number(item.bytesIn ?? 0),
    bytesOut: Number(item.bytesOut ?? 0)
  };
}
