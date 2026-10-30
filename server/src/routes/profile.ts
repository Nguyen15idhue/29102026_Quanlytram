import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { asyncHandler, ApiError } from '../lib/http';
import { hashPassword, verifyPassword } from '../lib/password';
import { emailField } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { ipFrom } from '../rbac/access';

export const profileRouter = Router();
profileRouter.use(requireAuth);
profileRouter.use(csrfProtection);

async function currentUser(id: number): Promise<any | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT u.id, u.username, u.display_name, u.email, u.status, u.created_at, u.last_login_at,
            r.code AS role_code, r.name AS role_name, r.level AS role_level
       FROM web_users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

function publicProfile(row: any) {
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    email: String(row.email ?? ''),
    status: String(row.status),
    role: {
      code: String(row.role_code),
      name: String(row.role_name),
      level: Number(row.role_level)
    },
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
}

profileRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const row = await currentUser(req.auth!.id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản');
    res.json({ item: publicProfile(row) });
  })
);

profileRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        display_name: z.string().min(1).max(120).optional(),
        email: emailField.optional()
      })
      .parse(req.body);
    const before = await currentUser(req.auth!.id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản');
    await adminPool.query('UPDATE web_users SET display_name = ?, email = ? WHERE id = ?', [
      body.display_name ?? before.display_name,
      body.email ?? before.email,
      req.auth!.id
    ]);
    const after = await currentUser(req.auth!.id);
    await writeAudit(adminPool, req.auth!.id, 'update_profile', 'web_user', req.auth!.id, before, after, ipFrom(req));
    res.json({ item: publicProfile(after) });
  })
);

profileRouter.post(
  '/password',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        current_password: z.string().min(1).max(200),
        new_password: z.string().min(8).max(200)
      })
      .parse(req.body);
    const rows = await query<RowDataPacket[]>('SELECT password_hash FROM web_users WHERE id = ?', [req.auth!.id]);
    if (!rows[0] || !(await verifyPassword(String(rows[0].password_hash), body.current_password))) {
      throw new ApiError(400, 'INVALID_PASSWORD', 'Mật khẩu hiện tại không đúng');
    }
    await adminPool.query('UPDATE web_users SET password_hash = ? WHERE id = ?', [
      await hashPassword(body.new_password),
      req.auth!.id
    ]);
    await adminPool.query(
      'DELETE FROM web_sessions WHERE web_user_id = ? AND id <> ?',
      [req.auth!.id, req.auth!.sessionId ?? 0]
    );
    await writeAudit(adminPool, req.auth!.id, 'change_password', 'web_user', req.auth!.id, null, null, ipFrom(req));
    res.json({ ok: true });
  })
);

profileRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, ip, user_agent, created_at, expires_at
         FROM web_sessions WHERE web_user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.auth!.id]
    );
    res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        current: Number(row.id) === Number(req.auth!.sessionId ?? 0),
        ip: String(row.ip ?? ''),
        userAgent: String(row.user_agent ?? ''),
        createdAt: row.created_at,
        expiresAt: row.expires_at
      }))
    });
  })
);
