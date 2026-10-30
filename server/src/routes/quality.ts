import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';
import { writeAudit } from '../lib/audit';
import { csvBuffer } from '../lib/csv';
import { asyncHandler, ApiError } from '../lib/http';
import {
  fetchLiveQuality,
  loadAckMap,
  loadOwnerMaps,
  mapAlert,
  mapSample,
  parseWindowMinutes,
  targetName,
  targetOwner,
  type QualityLive,
  type QualitySample
} from '../lib/quality';
import { requireAuth, requirePermission } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { emitQualityAck } from '../realtime/qualityBus';
import { assertRecordScope, ipFrom, pageFrom, scopeIdsFor } from '../rbac/access';
import { inScope } from '../rbac/scope';

export const qualityRouter = Router();
qualityRouter.use(requireAuth);
qualityRouter.use(csrfProtection);

function targetTypeFrom(value: unknown): 'station' | 'relay_job' | '' {
  const text = String(value ?? '');
  if (text === 'station' || text === 'relay_job') return text;
  return '';
}

async function getStation(id: number): Promise<any | null> {
  const rows = await query<RowDataPacket[]>('SELECT * FROM stations WHERE id = ?', [id]);
  return rows[0] ?? null;
}

async function getRelayJob(id: number): Promise<any | null> {
  const rows = await query<RowDataPacket[]>(
    'SELECT * FROM relay_jobs WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  return rows[0] ?? null;
}

async function visibleLive(
  req: any,
  items: QualityLive[]
): Promise<QualityLive[]> {
  if (items.length === 0) return [];
  const maps = await loadOwnerMaps();
  const ids = await scopeIdsFor(req);
  const scope = req.permissionScope!;
  return items.filter((item) =>
    inScope(scope, req.auth!.id, ids, targetOwner(maps, item.targetType, item.targetId))
  );
}

qualityRouter.get(
  '/quality/overview',
  requirePermission('quality', 'view'),
  asyncHandler(async (req, res) => {
    const targetType = targetTypeFrom(req.query.targetType);
    const windowMinutes = parseWindowMinutes(req.query.window, 15);
    const from = new Date(Date.now() - windowMinutes * 60_000);
    const maps = await loadOwnerMaps();
    const ids = await scopeIdsFor(req);
    const scope = req.permissionScope!;

    const where: string[] = ['ts >= ?'];
    const params: unknown[] = [from];
    if (targetType) {
      where.push('target_type = ?');
      params.push(targetType);
    }
    const sampleRows = await runtimeQuery(
      `SELECT * FROM (
         SELECT qs.*, ROW_NUMBER() OVER (
           PARTITION BY target_type, target_id, mountpoint_id, direction
           ORDER BY ts DESC
         ) AS rn
           FROM quality_samples qs
          WHERE ${where.join(' AND ')}
       ) ranked
       WHERE rn = 1
       ORDER BY target_type, target_id, direction`,
      params
    );

    const alertRows = await runtimeQuery(
      `SELECT target_type, target_id, COUNT(*) AS total
         FROM quality_alerts
        WHERE resolved_at IS NULL
        GROUP BY target_type, target_id`
    );
    const alertCount = new Map<string, number>();
    for (const row of alertRows as any[]) {
      alertCount.set(`${row.target_type}:${row.target_id}`, Number(row.total ?? 0));
    }

    const live = await fetchLiveQuality();
    const byKey = new Map<string, any>();
    for (const row of sampleRows as any[]) {
      const sample = mapSample(row);
      const ownerId = targetOwner(maps, sample.targetType, sample.targetId);
      if (!inScope(scope, req.auth!.id, ids, ownerId)) continue;
      byKey.set(
        `${sample.targetType}:${sample.targetId}:${sample.mountpointId}:${sample.direction}`,
        buildOverviewItem(sample.targetType, sample.targetId, sample.mountpointId, sample.direction, sample, maps, alertCount)
      );
    }
    for (const item of live.items) {
      const ownerId = targetOwner(maps, item.targetType, item.targetId);
      if (!inScope(scope, req.auth!.id, ids, ownerId)) continue;
      const key = `${item.targetType}:${item.targetId}:${item.mountpointId}:${item.direction}`;
      byKey.set(
        key,
        buildOverviewItem(item.targetType, item.targetId, item.mountpointId, item.direction, item, maps, alertCount)
      );
    }

    const ownerFilter = req.query.owner ? Number(req.query.owner) : null;
    const items = [...byKey.values()]
      .filter((item) => ownerFilter === null || item.ownerWebUserId === ownerFilter)
      .sort((a, b) => {
        if (a.targetType !== b.targetType) return a.targetType.localeCompare(b.targetType);
        if (a.targetId !== b.targetId) return a.targetId - b.targetId;
        if (a.mountpointId !== b.mountpointId) return a.mountpointId - b.mountpointId;
        return a.direction.localeCompare(b.direction);
      });

    res.json({
      items,
      total: items.length,
      window: windowMinutes,
      live: live.ok,
      ts: live.ts
    });
  })
);

function buildOverviewItem(
  targetType: string,
  targetId: number,
  mountpointId: number,
  direction: string,
  source: QualitySample | QualityLive,
  maps: Awaited<ReturnType<typeof loadOwnerMaps>>,
  alertCount: Map<string, number>
) {
  return {
    name: targetName(maps, targetType, targetId, mountpointId),
    ownerWebUserId: targetOwner(maps, targetType, targetId),
    alertsOpen: alertCount.get(`${targetType}:${targetId}`) ?? 0,
    ...source
  };
}

qualityRouter.get(
  '/quality/alerts',
  requirePermission('quality', 'view'),
  asyncHandler(async (req, res) => {
    const { pageSize, offset } = pageFrom(req);
    const status = String(req.query.status || 'open').trim();
    const level = String(req.query.level || req.query.severity || '').trim();
    const targetType = targetTypeFrom(req.query.targetType);
    const maps = await loadOwnerMaps();
    const ids = await scopeIdsFor(req);
    const scope = req.permissionScope!;

    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (status === 'open') where.push('resolved_at IS NULL');
    if (status === 'resolved') where.push('resolved_at IS NOT NULL');
    if (level) {
      where.push('level = ?');
      params.push(level);
    }
    if (targetType) {
      where.push('target_type = ?');
      params.push(targetType);
    }
    const rows = await runtimeQuery(
      `SELECT * FROM quality_alerts WHERE ${where.join(' AND ')}
       ORDER BY last_seen DESC LIMIT 2000`,
      params
    );
    const visible = (rows as any[]).filter((row) =>
      inScope(
        scope,
        req.auth!.id,
        ids,
        targetOwner(maps, row.target_type, Number(row.target_id))
      )
    );
    const pageRows = visible.slice(offset, offset + pageSize);
    const acks = await loadAckMap(pageRows.map((row) => Number(row.id)));
    res.json({
      items: pageRows.map((row) =>
        mapAlert(
          row,
          targetOwner(maps, row.target_type, Number(row.target_id)),
          acks.get(Number(row.id))
        )
      ),
      total: visible.length,
      pageSize,
      offset
    });
  })
);

const ackSchema = z.object({ note: z.string().max(255).optional().default('') });

qualityRouter.post(
  '/quality/alerts/:id/ack',
  requirePermission('quality', 'ack'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'alert id không hợp lệ');
    }
    const rows = await runtimeQuery('SELECT * FROM quality_alerts WHERE id = ?', [id]);
    const alert = rows[0];
    if (!alert) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy cảnh báo chất lượng');
    const maps = await loadOwnerMaps();
    const ownerId = targetOwner(maps, alert.target_type, Number(alert.target_id));
    await assertRecordScope(req, ownerId);
    const body = ackSchema.parse(req.body ?? {});

    await adminPool.query(
      `INSERT INTO quality_alert_acks (alert_id, web_user_id, acked_at, note)
       VALUES (?, ?, UTC_TIMESTAMP(3), ?)
       ON DUPLICATE KEY UPDATE acked_at = UTC_TIMESTAMP(3), note = VALUES(note)`,
      [id, req.auth!.id, body.note]
    );
    await writeAudit(
      adminPool,
      req.auth!.id,
      'ack',
      'quality_alert',
      id,
      null,
      { note: body.note, targetType: alert.target_type, targetId: Number(alert.target_id) },
      ipFrom(req)
    );
    emitQualityAck({
      alertId: id,
      webUserId: req.auth!.id,
      note: body.note,
      ts: new Date().toISOString()
    });
    const acks = await loadAckMap([id]);
    res.json({
      item: mapAlert(alert, ownerId, acks.get(id)),
      ack: acks.get(id) ?? null
    });
  })
);

qualityRouter.get(
  '/quality/export',
  requirePermission('quality', 'view'),
  asyncHandler(async (req, res) => {
    const targetType = targetTypeFrom(req.query.targetType);
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 24 * 3600_000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'from/to không hợp lệ');
    }
    const maps = await loadOwnerMaps();
    const ids = await scopeIdsFor(req);
    const scope = req.permissionScope!;
    const where = ['ts >= ?', 'ts <= ?'];
    const params: unknown[] = [from, to];
    if (targetType) {
      where.push('target_type = ?');
      params.push(targetType);
    }
    const rows = await runtimeQuery(
      `SELECT * FROM quality_samples WHERE ${where.join(' AND ')}
       ORDER BY ts ASC LIMIT 5000`,
      params
    );
    const visible = (rows as any[]).filter((row) =>
      inScope(
        scope,
        req.auth!.id,
        ids,
        targetOwner(maps, row.target_type, Number(row.target_id))
      )
    );
    const headers = [
      'target_type',
      'target_id',
      'mountpoint_id',
      'direction',
      'ts',
      'score',
      'state',
      'frames',
      'bytes',
      'crc_errors',
      'parse_errors',
      'msm_epochs',
      'satellites',
      'signals',
      'cells',
      'avg_cnr',
      'age_ms',
      'gaps'
    ];
    const data = visible.map((row) => {
      const sample = mapSample(row);
      return [
        sample.targetType,
        sample.targetId,
        sample.mountpointId,
        sample.direction,
        sample.ts,
        sample.score,
        sample.state,
        sample.frames,
        sample.bytes,
        sample.crcErrors,
        sample.parseErrors,
        sample.msmEpochs,
        sample.satellites,
        sample.signals,
        sample.cells,
        sample.avgCnr,
        sample.ageMs,
        sample.gaps
      ];
    });
    await writeAudit(
      adminPool,
      req.auth!.id,
      'export',
      'quality',
      targetType || 'all',
      null,
      { rows: data.length, from: from.toISOString(), to: to.toISOString() },
      ipFrom(req)
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="quality-${targetType || 'all'}-${Date.now()}.csv"`
    );
    res.send(csvBuffer(headers, data));
  })
);

qualityRouter.get(
  '/stations/:id/quality',
  requirePermission('quality', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const station = await getStation(id);
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const windowMinutes = parseWindowMinutes(req.query.window, 15);
    const from = new Date(Date.now() - windowMinutes * 60_000);
    const mountpointId = req.query.mountpointId ? Number(req.query.mountpointId) : null;
    const where = ['target_type = ?', 'target_id = ?', 'direction = ?', 'ts >= ?'];
    const params: unknown[] = ['station', id, 'ingest', from];
    if (mountpointId !== null && Number.isFinite(mountpointId)) {
      where.push('mountpoint_id = ?');
      params.push(mountpointId);
    }
    const rows = await runtimeQuery(
      `SELECT * FROM quality_samples WHERE ${where.join(' AND ')}
       ORDER BY ts ASC LIMIT 1000`,
      params
    );
    const items = (rows as any[]).map(mapSample);
    const live = (await fetchLiveQuality()).items.filter(
      (item) =>
        item.targetType === 'station' &&
        item.targetId === id &&
        (mountpointId === null || item.mountpointId === mountpointId)
    );
    res.json({
      items,
      latest: items[items.length - 1] ?? live[0] ?? null,
      live,
      window: windowMinutes,
      mountpointId
    });
  })
);

qualityRouter.get(
  '/stations/:id/rtcm/messages',
  requirePermission('quality', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const station = await getStation(id);
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 24 * 3600_000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'from/to không hợp lệ');
    }
    const where = [
      'target_type = ?',
      'target_id = ?',
      'direction = ?',
      'hour_start_utc >= ?',
      'hour_start_utc <= ?'
    ];
    const params: unknown[] = ['station', id, 'ingest', from, to];
    if (req.query.mountpointId) {
      where.push('mountpoint_id = ?');
      params.push(Number(req.query.mountpointId));
    }
    const rows = await runtimeQuery(
      `SELECT * FROM rtcm_message_stats WHERE ${where.join(' AND ')}
       ORDER BY hour_start_utc ASC, message_type ASC`,
      params
    );
    res.json({ items: messageRows(rows as any[]), from: from.toISOString(), to: to.toISOString() });
  })
);

qualityRouter.get(
  '/relay-jobs/:id/quality',
  requirePermission('quality', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const job = await getRelayJob(id);
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    await assertRecordScope(req, job.owner_web_user_id);
    const windowMinutes = parseWindowMinutes(req.query.window, 15);
    const from = new Date(Date.now() - windowMinutes * 60_000);
    const direction = String(req.query.direction || '').trim();
    const where = ['target_type = ?', 'target_id = ?', 'ts >= ?'];
    const params: unknown[] = ['relay_job', id, from];
    if (direction === 'upstream' || direction === 'downstream') {
      where.push('direction = ?');
      params.push(direction);
    }
    const rows = await runtimeQuery(
      `SELECT * FROM quality_samples WHERE ${where.join(' AND ')}
       ORDER BY ts ASC LIMIT 2000`,
      params
    );
    const items = (rows as any[]).map(mapSample);
    const live = (await fetchLiveQuality()).items.filter(
      (item) =>
        item.targetType === 'relay_job' &&
        item.targetId === id &&
        (!direction || item.direction === direction)
    );
    const latest = latestByDirection([...items, ...live]);
    res.json({
      items,
      latest,
      live,
      window: windowMinutes,
      direction,
      jobScore: live.find((item) => item.jobScore !== undefined)?.jobScore ?? null,
      parity: live.find((item) => item.parity !== undefined)?.parity ?? null
    });
  })
);

qualityRouter.get(
  '/relay-jobs/:id/rtcm/messages',
  requirePermission('quality', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const job = await getRelayJob(id);
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy relay job');
    await assertRecordScope(req, job.owner_web_user_id);
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 24 * 3600_000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'from/to không hợp lệ');
    }
    const where = ['target_type = ?', 'target_id = ?', 'hour_start_utc >= ?', 'hour_start_utc <= ?'];
    const params: unknown[] = ['relay_job', id, from, to];
    const direction = String(req.query.direction || '').trim();
    if (direction === 'upstream' || direction === 'downstream') {
      where.push('direction = ?');
      params.push(direction);
    }
    const rows = await runtimeQuery(
      `SELECT * FROM rtcm_message_stats WHERE ${where.join(' AND ')}
       ORDER BY hour_start_utc ASC, direction ASC, message_type ASC`,
      params
    );
    res.json({ items: messageRows(rows as any[]), from: from.toISOString(), to: to.toISOString() });
  })
);

function messageRows(rows: any[]) {
  return rows.map((row) => ({
    targetType: row.target_type,
    targetId: Number(row.target_id),
    mountpointId: Number(row.mountpoint_id ?? 0),
    direction: row.direction,
    hourStartUtc: new Date(row.hour_start_utc).toISOString(),
    messageType: Number(row.message_type),
    count: Number(row.count ?? 0),
    bytes: Number(row.bytes ?? 0),
    ratePerMinute: Number(row.count ?? 0) / 60,
    lastSeenAt: new Date(row.last_seen_at).toISOString()
  }));
}

function latestByDirection(items: Array<QualitySample | QualityLive>) {
  const map = new Map<string, QualitySample | QualityLive>();
  for (const item of items) {
    const key = `${item.direction}:${item.mountpointId}`;
    const current = map.get(key);
    if (!current || new Date(item.ts).getTime() > new Date(current.ts).getTime()) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

const probeCreateSchema = z.object({
  mountpointId: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional().default(false),
  probeIntervalSec: z.number().int().min(5).max(3600).optional().default(60),
  credentialId: z.number().int().positive().nullable().optional()
});

const probeUpdateSchema = probeCreateSchema.partial();

function publicProbe(row: any) {
  return {
    id: Number(row.id),
    stationId: Number(row.station_id),
    mountpointId: row.mountpoint_id === null ? null : Number(row.mountpoint_id),
    enabled: Boolean(row.enabled),
    probeIntervalSec: Number(row.probe_interval_sec),
    credentialId: row.credential_id === null ? null : Number(row.credential_id),
    hasCredential: row.credential_id !== null,
    ownerWebUserId: row.owner_web_user_id === null ? null : Number(row.owner_web_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runner: 'deferred'
  };
}

async function getProbe(id: number, stationId?: number): Promise<any | null> {
  const rows = await query<RowDataPacket[]>(
    stationId
      ? 'SELECT * FROM station_probes WHERE id = ? AND station_id = ?'
      : 'SELECT * FROM station_probes WHERE id = ?',
    stationId ? [id, stationId] : [id]
  );
  return rows[0] ?? null;
}

qualityRouter.get(
  '/stations/:id/probes',
  requirePermission('stations', 'view'),
  asyncHandler(async (req, res) => {
    const stationId = Number(req.params.id);
    const station = await getStation(stationId);
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const rows = await query<RowDataPacket[]>(
      'SELECT * FROM station_probes WHERE station_id = ? ORDER BY id',
      [stationId]
    );
    res.json({ items: rows.map(publicProbe) });
  })
);

qualityRouter.post(
  '/stations/:id/probes',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    const stationId = Number(req.params.id);
    const station = await getStation(stationId);
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const body = probeCreateSchema.parse(req.body ?? {});
    if (body.mountpointId) {
      const mountpoint = await query<RowDataPacket[]>(
        'SELECT id FROM mountpoints WHERE id = ? AND station_id = ?',
        [body.mountpointId, stationId]
      );
      if (mountpoint.length === 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mountpoint không thuộc trạm');
      }
    }
    const [result] = await adminPool.query<any>(
      `INSERT INTO station_probes
         (station_id, mountpoint_id, enabled, probe_interval_sec, credential_id, owner_web_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        stationId,
        body.mountpointId ?? null,
        body.enabled,
        body.probeIntervalSec,
        body.credentialId ?? null,
        station.owner_web_user_id,
        req.auth!.id
      ]
    );
    const probe = await getProbe(Number(result.insertId));
    await writeAudit(
      adminPool,
      req.auth!.id,
      'create',
      'station_probe',
      result.insertId,
      null,
      publicProbe(probe),
      ipFrom(req)
    );
    res.status(201).json({ item: publicProbe(probe) });
  })
);

qualityRouter.patch(
  '/station-probes/:id',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getProbe(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy station probe');
    const station = await getStation(Number(before.station_id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    const body = probeUpdateSchema.parse(req.body ?? {});
    await adminPool.query(
      `UPDATE station_probes
          SET mountpoint_id = ?, enabled = ?, probe_interval_sec = ?, credential_id = ?
        WHERE id = ?`,
      [
        body.mountpointId === undefined ? before.mountpoint_id : body.mountpointId,
        body.enabled === undefined ? before.enabled : body.enabled,
        body.probeIntervalSec ?? before.probe_interval_sec,
        body.credentialId === undefined ? before.credential_id : body.credentialId,
        id
      ]
    );
    const after = await getProbe(id);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'update',
      'station_probe',
      id,
      publicProbe(before),
      publicProbe(after),
      ipFrom(req)
    );
    res.json({ item: publicProbe(after) });
  })
);

qualityRouter.delete(
  '/station-probes/:id',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await getProbe(id);
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy station probe');
    const station = await getStation(Number(before.station_id));
    if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
    await assertRecordScope(req, station.owner_web_user_id);
    await adminPool.query('DELETE FROM station_probes WHERE id = ?', [id]);
    await writeAudit(
      adminPool,
      req.auth!.id,
      'delete',
      'station_probe',
      id,
      publicProbe(before),
      null,
      ipFrom(req)
    );
    res.status(204).send();
  })
);

async function setProbeEnabled(req: any, enabled: boolean) {
  const id = Number(req.params.id);
  const before = await getProbe(id);
  if (!before) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy station probe');
  const station = await getStation(Number(before.station_id));
  if (!station) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy trạm');
  await assertRecordScope(req, station.owner_web_user_id);
  await adminPool.query('UPDATE station_probes SET enabled = ? WHERE id = ?', [enabled, id]);
  const after = await getProbe(id);
  await writeAudit(
    adminPool,
    req.auth!.id,
    enabled ? 'enable' : 'disable',
    'station_probe',
    id,
    publicProbe(before),
    publicProbe(after),
    ipFrom(req)
  );
  return publicProbe(after);
}

qualityRouter.post(
  '/station-probes/:id/enable',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setProbeEnabled(req, true) });
  })
);

qualityRouter.post(
  '/station-probes/:id/disable',
  requirePermission('stations', 'edit'),
  asyncHandler(async (req, res) => {
    res.json({ item: await setProbeEnabled(req, false) });
  })
);
