import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/http';
import { clientIp, pagination } from '../lib/http';
import { query } from '../db/pool';
import { permissionsForRole } from '../rbac/permissions';
import { inScope, scopeClause, subtreeIds, tenantIds } from '../rbac/scope';

export async function scopeIdsFor(req: Request): Promise<number[]> {
  if (!req.auth) return [];
  return req.permissionScope === 'tenant'
    ? tenantIds(req.auth.id)
    : subtreeIds(req.auth.id);
}

export async function assertRecordScope(
  req: Request,
  ownerId: number | null,
  column = 'owner_web_user_id'
): Promise<void> {
  if (!req.auth || !req.permissionScope) {
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
  }
  const ids =
    req.permissionScope === 'tenant'
      ? await tenantIds(req.auth.id)
      : req.permissionScope === 'subtree'
        ? await subtreeIds(req.auth.id)
        : [];
  if (!inScope(req.permissionScope, req.auth.id, ids, ownerId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bản ghi');
  }
}

export function listScope(req: Request, ids: number[], column = 'owner_web_user_id') {
  if (!req.auth || !req.permissionScope) {
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
  }
  return scopeClause(req.permissionScope, req.auth.id, ids, column);
}

export function requireBulkPermission(
  module: string,
  actionForBulkAction: Record<string, string>
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const bulkAction = String((req.body as any)?.action ?? '');
      const action = actionForBulkAction[bulkAction];
      if (!action) throw new ApiError(400, 'INVALID_ACTION', 'Hành động không hợp lệ');
      const permissions = await permissionsForRole(req.auth!.roleId);
      const permission = permissions.find((item) => item.code === `${module}.${action}`);
      if (!permission || permission.scope === 'none') {
        throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
      }
      req.permissionScope = permission.scope;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function pageFrom(req: Request) {
  return pagination(req.query as Record<string, unknown>);
}

export function ipFrom(req: Request): string {
  return clientIp(req);
}
