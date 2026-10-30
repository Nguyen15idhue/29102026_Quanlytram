import { Router } from 'express';
import { query } from '../db/pool';
import { asyncHandler } from '../lib/http';
import { requireAuth, requirePermission } from '../middleware/auth';
import { RowDataPacket } from 'mysql2/promise';

export const permissionsRouter = Router();
permissionsRouter.use(requireAuth);

permissionsRouter.get(
  '/',
  requirePermission('roles', 'view'),
  asyncHandler(async (_req, res) => {
    const rows = await query<RowDataPacket[]>('SELECT * FROM permissions ORDER BY module, action');
    res.json({ items: rows });
  })
);
