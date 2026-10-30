import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { permissionsForRole } from '../rbac/permissions';
import { subtreeIds } from '../rbac/scope';
import { loadBaseData, loadOpenAlerts } from '../realtime/data';
import { buildSnapshot, permissionMap } from '../realtime/filter';

export const snapshotRouter = Router();
snapshotRouter.use(requireAuth);

snapshotRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const [permissions, ids, data, alerts] = await Promise.all([
      permissionsForRole(auth.roleId),
      subtreeIds(auth.id),
      loadBaseData(),
      loadOpenAlerts()
    ]);
    res.json({
      item: buildSnapshot(data, alerts, permissionMap(permissions), auth.id, ids)
    });
  })
);
