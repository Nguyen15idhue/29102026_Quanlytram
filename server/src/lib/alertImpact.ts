import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { runtimeQuery } from '../db/runtimePool';

export interface ImpactDescriptor {
  key: string;
  targetType: string;
  targetId: number | null;
  mountpointId?: number | null;
}

export interface AlertImpact {
  station: { id: number; code: string; name: string } | null;
  mountpoints: Array<{ id: number; name: string }>;
  relays: Array<{
    id: number;
    name: string;
    desiredRevision: number;
    appliedRevision: number | null;
    runtimeState: string;
    lastError: string | null;
  }>;
  listeners: Array<{ id: number; name: string; port: number }>;
  onlineAccounts: Array<{ id: number; username: string }>;
  onlineConnections: number;
  note: string | null;
}

export async function buildAlertImpacts(
  descriptors: ImpactDescriptor[]
): Promise<Map<string, AlertImpact>> {
  if (descriptors.length === 0) return new Map<string, AlertImpact>();

  const [mountpointRows, relayRows, stateRows, connectionRows, listenerRows] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT m.id, m.name, m.station_id, s.code AS station_code, s.name AS station_name
         FROM mountpoints m LEFT JOIN stations s ON s.id = m.station_id`
    ),
    query<RowDataPacket[]>(
      `SELECT id, name, desired_revision, upstream_mount
         FROM relay_jobs WHERE deleted_at IS NULL`
    ),
    runtimeQuery<RowDataPacket[]>(
      `SELECT relay_job_id, applied_revision, runtime_state, last_error FROM relay_job_state`
    ),
    runtimeQuery<RowDataPacket[]>(
      `SELECT id, mountpoint_id, account_id FROM caster_connections WHERE end_ts IS NULL`
    ),
    query<RowDataPacket[]>(
      `SELECT lm.mountpoint_id, l.id, l.name, l.port
         FROM caster_listener_mountpoints lm
         JOIN caster_listeners l ON l.id = lm.listener_id`
    )
  ]);

  const accountIds = [
    ...new Set(
      connectionRows
        .map((row) => row.account_id)
        .filter((id): id is number => id !== null && id !== undefined)
        .map(Number)
    )
  ];
  const accountRows = accountIds.length
    ? await query<RowDataPacket[]>(
        `SELECT id, username FROM ntrip_accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`,
        accountIds
      )
    : [];
  const accountNames = new Map<number, string>();
  for (const row of accountRows) accountNames.set(Number(row.id), String(row.username));

  const stationById = new Map<number, { id: number; code: string; name: string }>();
  const mountpointById = new Map<
    number,
    { id: number; name: string; station: { id: number; code: string; name: string } | null }
  >();
  for (const row of mountpointRows) {
    const station =
      row.station_id === null
        ? null
        : {
            id: Number(row.station_id),
            code: String(row.station_code ?? ''),
            name: String(row.station_name ?? '')
          };
    if (station) stationById.set(station.id, station);
    mountpointById.set(Number(row.id), {
      id: Number(row.id),
      name: String(row.name),
      station
    });
  }

  const stateByRelay = new Map<number, any>();
  for (const row of stateRows) stateByRelay.set(Number(row.relay_job_id), row);
  const relaysByMount = new Map<string, any[]>();
  const relayById = new Map<number, any>();
  for (const row of relayRows) {
    const item = {
      id: Number(row.id),
      name: String(row.name),
      desiredRevision: Number(row.desired_revision ?? 0),
      mount: String(row.upstream_mount)
    };
    relayById.set(item.id, item);
    const key = item.mount.toLowerCase();
    const list = relaysByMount.get(key) ?? [];
    list.push(item);
    relaysByMount.set(key, list);
  }

  const connectionsByMount = new Map<number, any[]>();
  for (const row of connectionRows) {
    const mpId = Number(row.mountpoint_id);
    const list = connectionsByMount.get(mpId) ?? [];
    list.push(row);
    connectionsByMount.set(mpId, list);
  }
  const listenersByMount = new Map<number, any[]>();
  for (const row of listenerRows) {
    const mpId = Number(row.mountpoint_id);
    const list = listenersByMount.get(mpId) ?? [];
    list.push({
      id: Number(row.id),
      name: String(row.name),
      port: Number(row.port)
    });
    listenersByMount.set(mpId, list);
  }

  const impacts = new Map<string, AlertImpact>();
  for (const descriptor of descriptors) {
    let affectedMountpoints: any[] = [];
    let note: string | null = null;
    let targetStationId: number | null = null;
    const targetId = descriptor.targetId === null ? null : Number(descriptor.targetId);

    if (descriptor.targetType === 'relay_job' && targetId !== null) {
      const relay = relayById.get(targetId);
      const mp = relay ? mountpointRows.find((row) => String(row.name).toLowerCase() === relay.mount.toLowerCase()) : null;
      if (mp) affectedMountpoints = [mp];
    } else if (descriptor.targetType === 'station' && targetId !== null) {
      targetStationId = targetId;
      affectedMountpoints = mountpointRows.filter((row) => Number(row.station_id) === targetId);
    } else if (descriptor.targetType === 'mountpoint' && targetId !== null) {
      const mp = mountpointById.get(targetId);
      if (mp) affectedMountpoints = mountpointRows.filter((row) => Number(row.id) === targetId);
    } else if (descriptor.targetType === 'caster') {
      affectedMountpoints = mountpointRows;
      note = 'Sự cố caster toàn cục';
    } else {
      note = 'Không xác định được đối tượng ảnh hưởng';
    }

    if (descriptor.mountpointId) {
      const specific = mountpointRows.filter(
        (row) => Number(row.id) === Number(descriptor.mountpointId)
      );
      if (specific.length > 0) affectedMountpoints = specific;
    }

    if (targetStationId === null && affectedMountpoints.length > 0) {
      targetStationId =
        affectedMountpoints[0].station_id === null
          ? null
          : Number(affectedMountpoints[0].station_id);
    }

    const mpIds = affectedMountpoints.map((row) => Number(row.id));
    const relays = affectedMountpoints.flatMap((mp) =>
      (relaysByMount.get(String(mp.name).toLowerCase()) ?? []).map((relay) => {
        const state = stateByRelay.get(relay.id);
        return {
          id: relay.id,
          name: relay.name,
          desiredRevision: relay.desiredRevision,
          appliedRevision: state ? Number(state.applied_revision ?? 0) : null,
          runtimeState: state ? String(state.runtime_state) : 'unknown',
          lastError: state?.last_error ?? null
        };
      })
    );
    const connections = affectedMountpoints.flatMap((row) => connectionsByMount.get(Number(row.id)) ?? []);
    const onlineAccounts = [
      ...new Map(
        connections
          .filter((row) => row.account_id !== null)
          .map((row) => [
            Number(row.account_id),
            {
              id: Number(row.account_id),
              username: accountNames.get(Number(row.account_id)) ?? `#${row.account_id}`
            }
          ])
      ).values()
    ];
    const listeners = affectedMountpoints.flatMap(
      (row) => listenersByMount.get(Number(row.id)) ?? []
    );

    impacts.set(descriptor.key, {
      station: targetStationId !== null ? stationById.get(targetStationId) ?? null : null,
      mountpoints: affectedMountpoints.map((row) => ({
        id: Number(row.id),
        name: String(row.name)
      })),
      relays,
      listeners,
      onlineAccounts,
      onlineConnections: connections.length,
      note
    });
  }
  return impacts;
}
