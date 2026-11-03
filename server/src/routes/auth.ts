import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { config, sessionCookieName } from '../config';
import { adminPool, query } from '../db/pool';
import { asyncHandler, ApiError, clientIp } from '../lib/http';
import { writeAudit } from '../lib/audit';
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

// Hash Argon2id của một mật khẩu ngẫu nhiên cố định: dùng để tiêu tốn thời gian
// tương đương khi username không tồn tại, tránh lộ tài khoản qua timing.
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$0w51WxdMfHTpCOCLNlHnEw$UBUsXlJyS+IUmplYLuHsF6jvW93S57XXxD0MuciwLsw';

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
    mustChangePassword: Boolean(Number(row.must_change_password)),
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
      await verifyPassword(DUMMY_ARGON2_HASH, body.password);
      await writeAudit(adminPool, null, 'login_failed', 'auth', body.username, null, { reason: 'unknown_user' }, clientIp(req));
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu');
    }
    const user = rows[0];
    if (user.status !== 'active') {
      await verifyPassword(DUMMY_ARGON2_HASH, body.password);
      await writeAudit(adminPool, null, 'login_failed', 'auth', body.username, null, { reason: 'locked' }, clientIp(req));
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu');
    }
    if (user.company_status === 'disabled') {
      await verifyPassword(DUMMY_ARGON2_HASH, body.password);
      await writeAudit(
        adminPool,
        null,
        'login_failed',
        'auth',
        body.username,
        null,
        { reason: 'company_disabled' },
        clientIp(req)
      );
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu');
    }
    const valid = await verifyPassword(String(user.password_hash), body.password);
    if (!valid) {
      await writeAudit(adminPool, null, 'login_failed', 'auth', body.username, null, { reason: 'bad_password' }, clientIp(req));
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu');
    }
    await writeAudit(adminPool, Number(user.id), 'login_success', 'auth', user.id, null, null, clientIp(req));

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

    res.cookie(sessionCookieName(), token, {
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
    await writeAudit(adminPool, req.auth!.id, 'logout', 'auth', req.auth!.id, null, null, clientIp(req));
    res.clearCookie(sessionCookieName(), { path: '/' });
    res.status(204).send();
  })
);
