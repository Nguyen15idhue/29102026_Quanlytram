import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { Scope } from './scope';

export interface PermissionEntry {
  code: string;
  scope: Scope;
}

export async function permissionsForRole(roleId: number): Promise<PermissionEntry[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT p.code, rp.scope
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.code`,
    [roleId]
  );
  return rows.map((row) => ({ code: String(row.code), scope: row.scope as Scope }));
}
