import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';

export type Scope = 'all' | 'subtree' | 'own' | 'none';

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
