import { Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { adminPool, query } from '../db/pool';
import { writeAudit } from '../lib/audit';
import {
  getDeviceProfile,
  listDeviceProfiles,
  mapDeviceProfileRow,
  MAX_USER_AGENT_LEN,
  previewDeviceUserAgent,
  type DeviceProfileInput,
  type DeviceRole
} from '../lib/deviceProfile';
import { ApiError, asyncHandler, clientIp } from '../lib/http';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';

export const deviceProfilesRouter = Router();
deviceProfilesRouter.use(requireAuth);
deviceProfilesRouter.use(csrfProtection);

const templateSchema = z.enum([
  'major.minor.patch',
  'major.minor.patch.date',
  'vmajor.minor.patch',
  'major.minor'
]);

const writeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_]+$/, 'code chỉ gồm chữ thường, số và dấu gạch dưới'),
  name: z.string().trim().min(1).max(96),
  vendor: z.string().max(96).optional().default(''),
  versionTemplate: templateSchema,
  ntripVersion: z.enum(['v1', 'v2']).optional().default('v2'),
  httpVersion: z.enum(['HTTP/1.0', 'HTTP/1.1']).optional().default('HTTP/1.1'),
  connection: z.enum(['close', 'keep-alive']).optional().default('close'),
  nmeaIntervalSec: z.number().int().min(1).max(3600).optional().default(10),
  nmeaJitterSec: z.number().int().min(0).max(720).optional().default(2),
  hdopMin: z.number().min(0.1).max(9.9).optional().default(0.8),
  hdopMax: z.number().min(0.1).max(9.9).optional().default(1.2),
  satsMin: z.number().int().min(4).max(99).optional().default(10),
  satsMax: z.number().int().min(4).max(99).optional().default(14),
  sendGsa: z.boolean().optional().default(true),
  sendRmc: z.boolean().optional().default(false),
  initialDelayMs: z.number().int().min(0).max(60000).optional().default(0),
  motion: z.enum(['static', 'rover']).optional().default('static'),
  receiverTypeAlias: z.string().max(96).optional().default(''),
  enabled: z.boolean().optional().default(true)
});

const patchSchema = writeSchema.partial().omit({ code: true });

const previewSchema = z.object({
  profileId: z.number().int().positive().optional(),
  code: z.string().max(64).optional(),
  uaMode: z.enum(['profile', 'literal']).optional().default('profile'),
  uaPrefix: z.string().max(100).optional().default(''),
  role: z.enum(['relay', 'station', 'probe']).optional().default('relay'),
  targetId: z.number().int().min(0).optional().default(0)
});

function normalizeInput(input: z.infer<typeof writeSchema>): DeviceProfileInput {
  if (input.hdopMax < input.hdopMin) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'hdopMax phải lớn hơn hoặc bằng hdopMin');
  }
  if (input.satsMax < input.satsMin) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'satsMax phải lớn hơn hoặc bằng satsMin');
  }
  if (input.nmeaJitterSec > Math.floor(input.nmeaIntervalSec / 5)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'nmeaJitterSec không được vượt quá 1/5 nmeaIntervalSec'
    );
  }
  return { ...input, code: input.code.trim().toLowerCase() };
}

// Trả danh sách profile; enabled=1 loại profile tắt khỏi select của người dùng.
deviceProfilesRouter.get(
  '/',
  requirePermission('device_profiles', 'view'),
  asyncHandler(async (req, res) => {
    const includeDisabled = ['1', 'true'].includes(String(req.query.enabled ?? '').toLowerCase());
    const items = await listDeviceProfiles(includeDisabled);
    res.json({ items });
  })
);

deviceProfilesRouter.post(
  '/preview',
  requirePermission('device_profiles', 'view'),
  asyncHandler(async (req, res) => {
    const body = previewSchema.parse(req.body ?? {});
    if (body.uaMode === 'literal') {
      const literal = body.uaPrefix.trim().slice(0, MAX_USER_AGENT_LEN);
      res.json({
        userAgent: literal,
        mode: 'literal',
        profile: null,
        version: null,
        seed: null
      });
      return;
    }
    const profile = body.profileId
      ? await getDeviceProfile(body.profileId)
      : body.code
        ? (await listDeviceProfiles(true)).find((item) => item.code === body.code) ?? null
        : null;
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy device profile');
    const preview = previewDeviceUserAgent(
      profile,
      body.uaPrefix,
      body.role as DeviceRole,
      body.targetId
    );
    res.json({
      userAgent: preview.userAgent,
      mode: 'profile',
      profile,
      version: preview.version,
      seed: preview.seed
    });
  })
);

deviceProfilesRouter.get(
  '/:id',
  requirePermission('device_profiles', 'view'),
  asyncHandler(async (req, res) => {
    const profile = await getDeviceProfile(Number(req.params.id));
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy device profile');
    res.json({ item: profile });
  })
);

deviceProfilesRouter.post(
  '/',
  requirePermission('device_profiles', 'edit'),
  asyncHandler(async (req, res) => {
    const body = normalizeInput(writeSchema.parse(req.body));
    const [result]: any = await adminPool.query(
      `INSERT INTO device_profiles
         (code, name, vendor, version_template, ntrip_version, http_version, connection,
          nmea_interval_sec, nmea_jitter_sec, hdop_min, hdop_max, sats_min, sats_max,
          send_gsa, send_rmc, initial_delay_ms, motion, receiver_type_alias, enabled, builtin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        body.code,
        body.name,
        body.vendor ?? '',
        body.versionTemplate,
        body.ntripVersion ?? 'v2',
        body.httpVersion ?? 'HTTP/1.1',
        body.connection ?? 'close',
        body.nmeaIntervalSec ?? 10,
        body.nmeaJitterSec ?? 2,
        body.hdopMin ?? 0.8,
        body.hdopMax ?? 1.2,
        body.satsMin ?? 10,
        body.satsMax ?? 14,
        body.sendGsa === false ? 0 : 1,
        body.sendRmc ? 1 : 0,
        body.initialDelayMs ?? 0,
        body.motion ?? 'static',
        body.receiverTypeAlias ?? '',
        body.enabled === false ? 0 : 1
      ]
    );
    const id = Number(result.insertId);
    const [createdRows]: any = await adminPool.query(
      'SELECT * FROM device_profiles WHERE id = ?',
      [id]
    );
    const profile = mapDeviceProfileRow(createdRows[0]);
    await writeAudit(adminPool, req.auth!.id, 'create', 'device_profile', id, null, profile, clientIp(req));
    res.status(201).json({ item: profile });
  })
);

deviceProfilesRouter.patch(
  '/:id',
  requirePermission('device_profiles', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const beforeRows = await query<RowDataPacket[]>('SELECT * FROM device_profiles WHERE id = ?', [id]);
    if (!beforeRows[0]) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy device profile');
    const before = mapDeviceProfileRow(beforeRows[0]);
    const patch = normalizeInput({
      ...writeSchema.parse({
        code: before.code,
        name: before.name,
        vendor: before.vendor,
        versionTemplate: before.versionTemplate,
        ntripVersion: before.ntripVersion,
        httpVersion: before.httpVersion,
        connection: before.connection,
        nmeaIntervalSec: before.nmeaIntervalSec,
        nmeaJitterSec: before.nmeaJitterSec,
        hdopMin: before.hdopMin,
        hdopMax: before.hdopMax,
        satsMin: before.satsMin,
        satsMax: before.satsMax,
        sendGsa: before.sendGsa,
        sendRmc: before.sendRmc,
        initialDelayMs: before.initialDelayMs,
        motion: before.motion,
        receiverTypeAlias: before.receiverTypeAlias,
        enabled: before.enabled,
        ...patchSchema.parse(req.body ?? {})
      })
    });
    await adminPool.query(
      `UPDATE device_profiles SET
         name = ?, vendor = ?, version_template = ?, ntrip_version = ?, http_version = ?,
         connection = ?, nmea_interval_sec = ?, nmea_jitter_sec = ?, hdop_min = ?, hdop_max = ?,
         sats_min = ?, sats_max = ?, send_gsa = ?, send_rmc = ?, initial_delay_ms = ?,
         motion = ?, receiver_type_alias = ?, enabled = ?
       WHERE id = ?`,
      [
        patch.name,
        patch.vendor ?? '',
        patch.versionTemplate,
        patch.ntripVersion ?? 'v2',
        patch.httpVersion ?? 'HTTP/1.1',
        patch.connection ?? 'close',
        patch.nmeaIntervalSec ?? 10,
        patch.nmeaJitterSec ?? 2,
        patch.hdopMin ?? 0.8,
        patch.hdopMax ?? 1.2,
        patch.satsMin ?? 10,
        patch.satsMax ?? 14,
        patch.sendGsa === false ? 0 : 1,
        patch.sendRmc ? 1 : 0,
        patch.initialDelayMs ?? 0,
        patch.motion ?? 'static',
        patch.receiverTypeAlias ?? '',
        patch.enabled === false ? 0 : 1,
        id
      ]
    );
    const after = await getDeviceProfile(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update',
      'device_profile',
      id,
      before,
      after,
      clientIp(req)
    );
    res.json({ item: after });
  })
);

deviceProfilesRouter.delete(
  '/:id',
  requirePermission('device_profiles', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await query<RowDataPacket[]>('SELECT * FROM device_profiles WHERE id = ?', [id]);
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy device profile');
    const before = mapDeviceProfileRow(rows[0]);
    if (before.builtin) {
      throw new ApiError(409, 'BUILTIN_PROFILE', 'Không thể xóa profile mặc định');
    }
    const refs = await query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM relay_jobs WHERE device_profile_id = ?) AS relay_jobs,
         (SELECT COUNT(*) FROM station_sources WHERE client_device_profile_id = ?) AS stations`,
      [id, id]
    );
    if (Number(refs[0]?.relay_jobs ?? 0) > 0 || Number(refs[0]?.stations ?? 0) > 0) {
      throw new ApiError(
        409,
        'PROFILE_IN_USE',
        'Profile đang được relay job hoặc trạm sử dụng; hãy đổi sang profile khác trước'
      );
    }
    await adminPool.query('DELETE FROM device_profiles WHERE id = ?', [id]);
    await writeAudit(adminPool, req.auth!.id, 'delete', 'device_profile', id, before, null, clientIp(req));
    res.json({ ok: true });
  })
);
