import { NextFunction, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { query } from '../db/pool';
import { ApiError } from '../lib/http';
import { sha256 } from '../lib/token';
import { Scope } from '../rbac/scope';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleCode: string;
  roleLevel: number;
  parentUserId: number | null;
  companyId: number | null;
  csrfToken: string;
  sessionId: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser;
      permissionScope?: Scope;
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.[config.session.cookieName];
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập');

    const rows = await query<RowDataPacket[]>(
      `SELECT s.id AS session_id, s.csrf_token,
              u.id, u.username, u.display_name, u.role_id, u.parent_user_id, u.company_id,
              r.code AS role_code, r.level AS role_level
         FROM web_sessions s
         JOIN web_users u ON u.id = s.web_user_id
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN companies co ON co.id = u.company_id
        WHERE s.token_hash = ?
          AND s.expires_at > UTC_TIMESTAMP(3)
          AND u.status = 'active'
          AND (u.company_id IS NULL OR co.status = 'active')
        LIMIT 1`,
      [sha256(String(token))]
    );
    if (rows.length === 0) {
      throw new ApiError(401, 'SESSION_EXPIRED', 'Phiên đăng nhập không hợp lệ');
    }
    const row = rows[0];
    req.auth = {
      id: Number(row.id),
      username: String(row.username),
      displayName: String(row.display_name),
      roleId: Number(row.role_id),
      roleCode: String(row.role_code),
      roleLevel: Number(row.role_level),
      parentUserId: row.parent_user_id === null ? null : Number(row.parent_user_id),
      companyId: row.company_id === null || row.company_id === undefined ? null : Number(row.company_id),
      csrfToken: String(row.csrf_token),
      sessionId: Number(row.session_id)
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(module: string, action: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) throw new ApiError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập');
      const rows = await query<RowDataPacket[]>(
        `SELECT rp.scope
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ? AND p.code = ?
          LIMIT 1`,
        [req.auth.roleId, `${module}.${action}`]
      );
      if (rows.length === 0 || rows[0].scope === 'none') {
        throw new ApiError(403, 'FORBIDDEN', 'Không có quyền thực hiện');
      }
      req.permissionScope = rows[0].scope as Scope;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function isSuperAdmin(req: Request): boolean {
  return req.auth?.roleCode === 'super_admin';
}
