import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';

export type Scope = 'all' | 'subtree' | 'tenant' | 'own' | 'none';

export async function subtreeIds(userId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM web_users WHERE id = ?
       UNION ALL
       SELECT u.id FROM web_users u JOIN tree t ON u.parent_user_id = t.id
     )
     SELECT id FROM tree`,
    [userId]
  );
  return rows.map((row) => Number(row.id));
}

export async function companyIdForUser(userId: number): Promise<number | null> {
  const rows = await query<RowDataPacket[]>(
    'SELECT company_id FROM web_users WHERE id = ?',
    [userId]
  );
  const value = rows[0]?.company_id;
  return value === null || value === undefined ? null : Number(value);
}

export async function companyUserIds(companyId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    'SELECT id FROM web_users WHERE company_id = ?',
    [companyId]
  );
  return rows.map((row) => Number(row.id));
}

export async function tenantRootId(userId: number): Promise<number> {
  const rows = await query<RowDataPacket[]>(
    `WITH RECURSIVE ancestry AS (
       SELECT u.id, u.parent_user_id, r.code AS role_code, 0 AS depth
         FROM web_users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
       UNION ALL
       SELECT u.id, u.parent_user_id, r.code AS role_code, a.depth + 1
         FROM web_users u
         JOIN roles r ON r.id = u.role_id
         JOIN ancestry a ON u.id = a.parent_user_id
     )
     SELECT id FROM ancestry
      WHERE role_code <> 'super_admin'
      ORDER BY depth DESC LIMIT 1`,
    [userId]
  );
  return Number(rows[0]?.id ?? userId);
}

export async function tenantIds(userId: number): Promise<number[]> {
  const companyId = await companyIdForUser(userId);
  if (companyId !== null) return companyUserIds(companyId);
  return subtreeIds(await tenantRootId(userId));
}

export function scopeClause(
  scope: Scope,
  userId: number,
  ids: number[],
  column: string
): { sql: string; params: number[] } {
  if (scope === 'all') return { sql: '1=1', params: [] };
  if (scope === 'none') return { sql: '1=0', params: [] };
  if (scope === 'own') return { sql: `${column} = ?`, params: [userId] };
  if (ids.length === 0) return { sql: '1=0', params: [] };
  return {
    sql: `${column} IN (${ids.map(() => '?').join(',')})`,
    params: ids
  };
}

export function inScope(
  scope: Scope,
  userId: number,
  ids: number[],
  ownerId: number | null
): boolean {
  if (scope === 'all') return true;
  if (scope === 'none' || ownerId === null) return false;
  if (scope === 'own') return Number(ownerId) === userId;
  return ids.includes(Number(ownerId));
}

export function canManageRole(
  actorLevel: number,
  targetLevel: number,
  actorIsSuper: boolean
): boolean {
  if (actorIsSuper) return true;
  return targetLevel < actorLevel;
}

export function canAssignRole(
  actorLevel: number,
  targetLevel: number,
  actorIsSuper: boolean
): boolean {
  if (actorIsSuper) return true;
  return targetLevel <= actorLevel;
}
