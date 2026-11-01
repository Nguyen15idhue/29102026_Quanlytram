import { NextFunction, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
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
  column = 'owner_web_user_id',
  companyId?: number | null
): Promise<void> {
  if (!req.auth || !req.permissionScope) {
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
  }
  if (req.permissionScope === 'tenant' && companyId !== undefined) {
    if (
      companyId === null ||
      req.auth.companyId === null ||
      Number(companyId) !== Number(req.auth.companyId)
    ) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bản ghi');
    }
    return;
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

export function listScope(
  req: Request,
  ids: number[],
  column = 'owner_web_user_id',
  options: { companyColumn?: string } = {}
) {
  if (!req.auth || !req.permissionScope) {
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
  }
  if (req.permissionScope === 'tenant' && options.companyColumn) {
    if (req.auth.companyId === null) return { sql: '1=0', params: [] as number[] };
    return {
      sql: `${options.companyColumn} = ?`,
      params: [Number(req.auth.companyId)]
    };
  }
  return scopeClause(req.permissionScope, req.auth.id, ids, column);
}

export interface WriteOwnership {
  ownerId: number;
  companyId: number | null;
}

export async function resolveWriteOwnership(
  req: Request,
  requestedOwner?: number | null,
  requestedCompanyId?: number | null
): Promise<WriteOwnership> {
  if (!req.auth || !req.permissionScope) {
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
  }
  const actor = req.auth;
  const isSuper = actor.roleCode === 'super_admin';
  let companyId: number | null;
  if (!isSuper) {
    if (actor.companyId === null) {
      throw new ApiError(403, 'FORBIDDEN', 'Tài khoản chưa thuộc công ty');
    }
    companyId = Number(actor.companyId);
    if (requestedCompanyId !== undefined && requestedCompanyId !== null) {
      if (Number(requestedCompanyId) !== companyId) {
        throw new ApiError(403, 'FORBIDDEN', 'Không được tạo tài nguyên cho công ty khác');
      }
    }
  } else if (requestedCompanyId !== undefined && requestedCompanyId !== null) {
    const rows = await query<RowDataPacket[]>(
      'SELECT id FROM companies WHERE id = ?',
      [requestedCompanyId]
    );
    if (rows.length === 0) {
      throw new ApiError(400, 'INVALID_COMPANY', 'Công ty không tồn tại');
    }
    companyId = Number(requestedCompanyId);
  } else if (requestedOwner !== undefined && requestedOwner !== null) {
    const rows = await query<RowDataPacket[]>(
      'SELECT company_id FROM web_users WHERE id = ?',
      [requestedOwner]
    );
    const ownerCompany = rows[0]?.company_id;
    if (ownerCompany === null || ownerCompany === undefined) {
      throw new ApiError(400, 'COMPANY_REQUIRED', 'Phải chọn công ty');
    }
    companyId = Number(ownerCompany);
  } else {
    throw new ApiError(400, 'COMPANY_REQUIRED', 'Phải chọn công ty');
  }

  const ownerId = requestedOwner ?? actor.id;
  if (ownerId !== actor.id || isSuper) {
    const rows = await query<RowDataPacket[]>(
      'SELECT company_id FROM web_users WHERE id = ?',
      [ownerId]
    );
    if (rows.length === 0) {
      throw new ApiError(400, 'INVALID_OWNER', 'Chủ sở hữu không tồn tại');
    }
    const ownerCompany = rows[0].company_id;
    if (!isSuper) {
      if (req.permissionScope === 'own' && ownerId !== actor.id) {
        throw new ApiError(403, 'FORBIDDEN', 'Không được gán chủ sở hữu khác');
      }
      if (ownerCompany === null || Number(ownerCompany) !== Number(companyId)) {
        throw new ApiError(400, 'OWNER_COMPANY_MISMATCH', 'Chủ sở hữu khác công ty');
      }
    } else if (ownerCompany !== null && Number(ownerCompany) !== Number(companyId)) {
      throw new ApiError(400, 'OWNER_COMPANY_MISMATCH', 'Chủ sở hữu khác công ty');
    }
  }
  return { ownerId: Number(ownerId), companyId };
}

export async function assertOwnerCompany(
  req: Request,
  ownerId: number | null
): Promise<void> {
  if (!req.auth || !req.permissionScope) {
    throw new ApiError(403, 'FORBIDDEN', 'Không có quyền');
  }
  if (req.permissionScope === 'all') return;
  if (ownerId === null) {
    throw new ApiError(400, 'INVALID_OWNER', 'Chủ sở hữu không hợp lệ');
  }
  const rows = await query<RowDataPacket[]>(
    'SELECT company_id FROM web_users WHERE id = ?',
    [ownerId]
  );
  const companyId = rows[0]?.company_id;
  if (companyId === null || companyId === undefined) {
    throw new ApiError(400, 'INVALID_OWNER', 'Chủ sở hữu không thuộc công ty');
  }
  const actorCompany = req.auth.companyId;
  if (actorCompany === null || actorCompany === undefined) {
    throw new ApiError(403, 'FORBIDDEN', 'Tài khoản chưa thuộc công ty');
  }
  if (Number(companyId) !== Number(actorCompany)) {
    throw new ApiError(400, 'OWNER_COMPANY_MISMATCH', 'Chủ sở hữu khác công ty');
  }
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
