import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db/pool';
import { callGoInternal } from './internalApi';
import { reconcileAffected, type ReconcileResult } from './reconcile';

export interface StationStreamEffect {
  relayJobIds: number[];
  mountpointIds: number[];
}

async function pauseResources(
  conn: PoolConnection,
  stationId: number
): Promise<StationStreamEffect> {
  const [relayRows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM relay_jobs
      WHERE deleted_at IS NULL AND paused_by_station_id IS NULL
        AND (enabled = 1 OR paused_by_mountpoint_id IS NOT NULL)
        AND (upstream_mount IN (SELECT name FROM mountpoints WHERE station_id = ?)
          OR downstream_mount IN (SELECT name FROM mountpoints WHERE station_id = ?))`,
    [stationId, stationId]
  );
  await conn.query(
    `UPDATE relay_jobs
        SET enabled = 0,
            paused_by_station_id = ?,
            desired_revision = desired_revision + 1
      WHERE deleted_at IS NULL AND paused_by_station_id IS NULL
        AND (enabled = 1 OR paused_by_mountpoint_id IS NOT NULL)
        AND (upstream_mount IN (SELECT name FROM mountpoints WHERE station_id = ?)
          OR downstream_mount IN (SELECT name FROM mountpoints WHERE station_id = ?))`,
    [stationId, stationId, stationId]
  );

  await conn.query(
    `UPDATE station_probes
        SET enabled = 0, paused_by_station_id = ?
      WHERE station_id = ? AND enabled = 1 AND paused_by_station_id IS NULL`,
    [stationId, stationId]
  );

  const [mountpointRows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM mountpoints
      WHERE station_id = ? AND enabled = 1 AND paused_by_station_id IS NULL`,
    [stationId]
  );
  await conn.query(
    `UPDATE mountpoints
        SET enabled = 0, paused_by_station_id = ?
      WHERE station_id = ? AND enabled = 1 AND paused_by_station_id IS NULL`,
    [stationId, stationId]
  );

  return {
    relayJobIds: relayRows.map((row) => Number(row.id)),
    mountpointIds: mountpointRows.map((row) => Number(row.id))
  };
}

async function resumeResources(
  conn: PoolConnection,
  stationId: number
): Promise<StationStreamEffect> {
  const [relayRows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM relay_jobs
      WHERE deleted_at IS NULL AND paused_by_station_id = ?`,
    [stationId]
  );
  await conn.query(
    `UPDATE relay_jobs
        SET enabled = IF(paused_by_mountpoint_id IS NULL, 1, 0),
            paused_by_station_id = NULL,
            desired_revision = desired_revision + 1
      WHERE deleted_at IS NULL AND paused_by_station_id = ?`,
    [stationId]
  );

  await conn.query(
    `UPDATE station_probes
        SET enabled = 1, paused_by_station_id = NULL
      WHERE paused_by_station_id = ?`,
    [stationId]
  );

  const [mountpointRows] = await conn.query<RowDataPacket[]>(
    'SELECT id FROM mountpoints WHERE paused_by_station_id = ?',
    [stationId]
  );
  await conn.query(
    `UPDATE mountpoints
        SET enabled = 1, paused_by_station_id = NULL
      WHERE paused_by_station_id = ?`,
    [stationId]
  );

  return {
    relayJobIds: relayRows.map((row) => Number(row.id)),
    mountpointIds: mountpointRows.map((row) => Number(row.id))
  };
}

export async function setStationStreamingInTransaction(
  conn: PoolConnection,
  stationId: number,
  enabled: boolean
): Promise<StationStreamEffect> {
  return enabled ? resumeResources(conn, stationId) : pauseResources(conn, stationId);
}

export async function notifyStationStreamingChange(
  effect: StationStreamEffect
): Promise<ReconcileResult> {
  const stationSourceReconcile = callGoInternal('/internal/station-source/reconcile', {}).catch(
    (error) => {
      console.warn(
        '[stations] station source reconcile failed',
        error instanceof Error ? error.message : 'unknown'
      );
    }
  );
  const result = await reconcileAffected({
    relayJobIds: effect.relayJobIds,
    mountpointIds: effect.mountpointIds,
    caster: true,
    probe: true
  });
  await stationSourceReconcile;
  if (!result.ok) {
    console.warn('[stations] reconcile failed', result.errors.join('; '));
  }
  return result;
}

export async function setStationStreaming(
  stationId: number,
  enabled: boolean
): Promise<StationStreamEffect> {
  const effect = await withTransaction((conn) =>
    setStationStreamingInTransaction(conn, stationId, enabled)
  );
  await notifyStationStreamingChange(effect);
  return effect;
}
