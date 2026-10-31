import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { getSystemHealth } from '../lib/systemHealth';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';

export const systemRouter = Router();
systemRouter.use(requireAuth);
systemRouter.use(csrfProtection);

systemRouter.get(
  '/health',
  requirePermission('system_health', 'view'),
  asyncHandler(async (_req, res) => {
    res.json(await getSystemHealth());
  })
);
