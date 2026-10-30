import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/http';
import { clientIp, pagination } from '../lib/http';
import { query } from '../db/pool';
import { inScope, scopeClause, subtreeIds } from '../rbac/scope';

export async function scopeIdsFor(req: Request): Promise<number[]> {
  if (!req.auth) return [];
  return subtreeIds(req.auth.id);
}

export async function assertRecordScope(
  req: Request,
  ownerId: number | null,
  column = 'owner_web_user_id'
): Promise<void> {
  if (!req.auth || !req.permissionScope) {
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
  }
  const ids = req.permissionScope === 'subtree' ? await subtreeIds(req.auth.id) : [];
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

export function pageFrom(req: Request) {
  return pagination(req.query as Record<string, unknown>);
}

export function ipFrom(req: Request): string {
  return clientIp(req);
}
