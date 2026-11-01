import { Router } from 'express';
import { adminPool } from '../db/pool';
import { writeAudit } from '../lib/audit';
import { asyncHandler } from '../lib/http';
import {
  getMapConfig,
  MAP_MODES,
  MapMode,
  mergeMapConfig,
  readRawMapConfig,
  sanitizeMapConfig,
  validateMapConfigInput
} from '../lib/mapConfig';
import { testTileSource } from '../lib/tileProxy';
import { ipFrom } from '../rbac/access';
import { isSuperAdmin, requireAuth, requirePermission } from '../middleware/auth';

export const mapConfigRouter = Router();

mapConfigRouter.use(requireAuth);

mapConfigRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const config = await getMapConfig();
    res.json({ config: sanitizeMapConfig(config) });
  })
);

async function saveConfig(actorId: number, input: unknown) {
  const current = await getMapConfig();
  const merged = mergeMapConfig(current, input as never);
  const validated = validateMapConfigInput(merged);
  await adminPool.query(
    `INSERT INTO settings (setting_key, setting_value, updated_by)
     VALUES (?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    ['map.config', JSON.stringify(validated), actorId]
  );
  return validated;
}

mapConfigRouter.put(
  '/',
  requirePermission('settings', 'edit'),
  asyncHandler(async (req, res) => {
    if (!isSuperAdmin(req)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Chỉ super admin được sửa cấu hình bản đồ' } });
      return;
    }
    const before = await readRawMapConfig();
    const saved = await saveConfig(req.auth!.id, req.body);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update',
      'map_config',
      'map.config',
      before,
      sanitizeMapConfig(saved),
      ipFrom(req)
    );
    res.json({ config: sanitizeMapConfig(saved) });
  })
);

mapConfigRouter.post(
  '/test',
  requirePermission('settings', 'edit'),
  asyncHandler(async (req, res) => {
    if (!isSuperAdmin(req)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Chỉ super admin được kiểm tra cấu hình bản đồ' } });
      return;
    }
    const body = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0
      ? req.body
      : null;
    if (body) {
      const current = await getMapConfig();
      validateMapConfigInput(mergeMapConfig(current, body as never));
    }
    const modes = {} as Record<MapMode, Awaited<ReturnType<typeof testTileSource>>>;
    for (const mode of MAP_MODES) {
      modes[mode] = await testTileSource(mode);
    }
    const ok = MAP_MODES.every((mode) => modes[mode].ok);
    res.json({ ok, modes });
  })
);
