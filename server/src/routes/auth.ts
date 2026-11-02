import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { adminPool, query } from '../db/pool';
import { asyncHandler, ApiError, clientIp } from '../lib/http';
import { verifyPassword } from '../lib/password';
import { randomToken, sha256 } from '../lib/token';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { permissionsForRole } from '../rbac/permissions';
import { revokeSessionSockets } from '../realtime/socket';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200)
});

function userPayload(row: RowDataPacket) {
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    email: String(row.email),
    parentUserId: row.parent_user_id === null ? null : Number(row.parent_user_id),
    companyId: row.company_id === null || row.company_id === undefined ? null : Number(row.company_id),
    companyName: row.company_name === null || row.company_name === undefined ? null : String(row.company_name),
    companyStatus: row.company_status === null || row.company_status === undefined
      ? null
      : String(row.company_status),
    role: {
      id: Number(row.role_id),
      code: String(row.role_code),
      name: String(row.role_name),
      level: Number(row.role_level)
    }
  };
}

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const rows = await query<RowDataPacket[]>(
      `SELECT u.*, r.code AS role_code, r.name AS role_name, r.level AS role_level,
              c.name AS company_name, c.status AS company_status
         FROM web_users u JOIN roles r ON r.id = u.role_id
         LEFT JOIN companies c ON c.id = u.company_id
        WHERE u.username = ? LIMIT 1`,
      [body.username]
    );
    if (rows.length === 0) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu');
    }
    const user = rows[0];
    if (user.status !== 'active') {
      throw new ApiError(403, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa');
    }
    if (user.company_status === 'disabled') {
      throw new ApiError(403, 'COMPANY_DISABLED', 'Công ty đã bị vô hiệu hóa');
    }
    const valid = await verifyPassword(String(user.password_hash), body.password);
    if (!valid) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu');
    }

    const token = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + config.session.ttlHours * 3600_000);
    await adminPool.query(
      `INSERT INTO web_sessions
         (web_user_id, token_hash, csrf_token, ip, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        sha256(token),
        csrfToken,
        clientIp(req),
        String(req.header('user-agent') || '').slice(0, 255),
        expiresAt
      ]
    );
    await adminPool.query('UPDATE web_users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?', [
      user.id
    ]);
    await adminPool.query('DELETE FROM web_sessions WHERE expires_at < UTC_TIMESTAMP(3)');

    res.cookie(config.session.cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.session.secure,
      path: '/',
      maxAge: config.session.ttlHours * 3600_000
    });

    res.json({
      user: userPayload(user),
      csrfToken,
      permissions: await permissionsForRole(Number(user.role_id))
    });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const rows = await query<RowDataPacket[]>(
      `SELECT u.*, r.code AS role_code, r.name AS role_name, r.level AS role_level,
              c.name AS company_name, c.status AS company_status
         FROM web_users u JOIN roles r ON r.id = u.role_id
         LEFT JOIN companies c ON c.id = u.company_id
        WHERE u.id = ? LIMIT 1`,
      [auth.id]
    );
    if (rows.length === 0) throw new ApiError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập');
    res.json({
      user: userPayload(rows[0]),
      csrfToken: auth.csrfToken,
      permissions: await permissionsForRole(auth.roleId)
    });
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    await adminPool.query('DELETE FROM web_sessions WHERE id = ?', [req.auth!.sessionId]);
    revokeSessionSockets(req.auth!.sessionId);
    res.clearCookie(config.session.cookieName, { path: '/' });
    res.status(204).send();
  })
);
