import fs from 'node:fs';
import path from 'node:path';
import { RowDataPacket } from 'mysql2/promise';
import { adminPool, query, withTransaction } from './pool';
import { writeAudit } from '../lib/audit';

interface LegacyStation {
  code: string;
  name: string;
  station_type: string;
  enabled: boolean;
  host: string;
  port: number;
  connection_type: string;
  source_type: string;
  ntrip_version: string;
  ntrip_mode: string;
  region: string;
  address: string;
  contractor: string;
  receiver_type: string;
  receiver_sn: string;
  receiver_firmware: string;
  antenna_type: string;
  antenna_sn: string;
  antenna_height: number | null;
  elevation_mask: number | null;
  device_id: string;
  network_type: string;
  network_mode: string;
  protocol: string;
  notes: string;
}

interface LegacyMountpoint {
  mountpoint: string;
  station_code: string;
  caster_ports: number[];
  relay_ports: number[];
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      result.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  result.push(value);
  return result;
}

function parsePorts(value: string): number[] {
  return String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(__dirname, '../../../db/data'));
}

function loadInputs(): { stations: LegacyStation[]; mountpoints: LegacyMountpoint[] } {
  const dir = dataDir();
  const parsed = JSON.parse(
    fs.readFileSync(path.join(dir, 'caster_stations.json'), 'utf8')
  ) as { stations: LegacyStation[] };
  const lines = fs
    .readFileSync(path.join(dir, 'caster_mountpoints.csv'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const header = parseCsvLine(lines[0]);
  const columns = new Map(
    header.map((name, index) => [name.replace(/^\uFEFF/, ''), index])
  );
  const mountpoints: LegacyMountpoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const get = (name: string) => cells[columns.get(name) ?? -1] ?? '';
    mountpoints.push({
      mountpoint: get('mountpoint'),
      station_code: get('station_code'),
      caster_ports: parsePorts(get('caster_ports')),
      relay_ports: parsePorts(get('relay_ports'))
    });
  }
  return { stations: parsed.stations, mountpoints };
}

async function loadExisting(): Promise<{
  stations: Map<string, RowDataPacket>;
  mountpoints: Map<string, RowDataPacket>;
  listeners: Map<number, RowDataPacket>;
}> {
  const stationRows = await query<RowDataPacket[]>('SELECT * FROM stations');
  const mountpointRows = await query<RowDataPacket[]>('SELECT * FROM mountpoints');
  const listenerRows = await query<RowDataPacket[]>('SELECT * FROM caster_listeners');
  return {
    stations: new Map(stationRows.map((row) => [String(row.name).toLowerCase(), row])),
    mountpoints: new Map(
      mountpointRows.map((row) => [String(row.name).toLowerCase(), row])
    ),
    listeners: new Map(listenerRows.map((row) => [Number(row.port), row]))
  };
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const input = loadInputs();
  const existing = await loadExisting();
  const missingStations = input.stations.filter(
    (station) => !existing.stations.has(station.name.toLowerCase())
  );
  const missingMountpoints = input.mountpoints.filter(
    (mountpoint) => !existing.mountpoints.has(mountpoint.mountpoint.toLowerCase())
  );
  const codeToName = new Map(
    input.stations.map((station) => [station.code.toLowerCase(), station.name])
  );
  const casterPorts = [...new Set(input.mountpoints.flatMap((item) => item.caster_ports))];
  const missingListeners = casterPorts.filter((port) => !existing.listeners.has(port));
  const summary = {
    dryRun: !commit,
    inputStations: input.stations.length,
    inputMountpoints: input.mountpoints.length,
    existingStations: existing.stations.size,
    existingMountpoints: existing.mountpoints.size,
    newStations: missingStations.length,
    newMountpoints: missingMountpoints.length,
    missingListeners,
    casterPorts,
    relayOnly: input.mountpoints.filter(
      (item) => item.caster_ports.length === 0 && item.relay_ports.length > 0
    ).length
  };

  if (!commit) {
    console.log(JSON.stringify(summary, null, 2));
    await adminPool.end();
    return;
  }

  const result = await withTransaction(async (conn) => {
    const stationIds = new Map<string, number>();
    for (const [key, row] of existing.stations) stationIds.set(key, Number(row.id));
    let stationsCreated = 0;
    let mountpointsCreated = 0;
    let mountpointsBound = 0;
    let mountpointsUpdated = 0;
    let listenersCreated = 0;
    let mappingsAdded = 0;

    for (const station of input.stations) {
      const key = station.name.toLowerCase();
      if (stationIds.has(key)) continue;
      const [inserted] = await conn.query<any>(
        `INSERT INTO stations
           (name, station_type, enabled, host, port, connection_type, source_type,
            ntrip_version, ntrip_mode, lat, lon, region, address, contractor,
            receiver_type, receiver_sn, receiver_firmware, antenna_type, antenna_sn,
            antenna_height, elevation_mask, device_id, network_type, network_mode,
            protocol, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          station.name,
          station.station_type || 'reference',
          Boolean(station.enabled),
          station.host,
          station.port,
          station.connection_type || 'ntrip',
          station.source_type || 'manual',
          station.ntrip_version || 'v1',
          station.ntrip_mode || 'v1_auth',
          station.region || '',
          station.address || '',
          station.contractor || '',
          station.receiver_type || '',
          station.receiver_sn || '',
          station.receiver_firmware || '',
          station.antenna_type || '',
          station.antenna_sn || '',
          station.antenna_height ?? null,
          station.elevation_mask ?? null,
          station.device_id || '',
          station.network_type || '',
          station.network_mode || '',
          station.protocol || 'ntrip',
          station.notes || ''
        ]
      );
      stationIds.set(key, Number(inserted.insertId));
      stationsCreated += 1;
    }

    const mountpointIds = new Map<string, number>();
    for (const [key, row] of existing.mountpoints) mountpointIds.set(key, Number(row.id));
    for (const mountpoint of input.mountpoints) {
      const key = mountpoint.mountpoint.toLowerCase();
      const stationName = codeToName.get(mountpoint.station_code.toLowerCase());
      const stationId = stationName ? stationIds.get(stationName.toLowerCase()) : undefined;
      if (!stationId) continue;
      const existingRow = existing.mountpoints.get(key);
      if (existingRow) {
        if (existingRow.station_id === null) {
          await conn.query('UPDATE mountpoints SET station_id = ? WHERE id = ?', [
            stationId,
            Number(existingRow.id)
          ]);
          mountpointsBound += 1;
        }
        continue;
      }
      const [inserted] = await conn.query<any>(
        `INSERT INTO mountpoints
           (name, station_id, enabled, service_type, position_mode,
            satellite_systems, caster_interval, code_protocol, code_type,
            description, owner_web_user_id, created_by)
         VALUES (?, ?, 1, 'rtcm', 'normal', '', 0, '', '', ?, NULL, NULL)`,
        [mountpoint.mountpoint, stationId, 'Import hệ cũ']
      );
      mountpointIds.set(key, Number(inserted.insertId));
      mountpointsCreated += 1;
    }

    const listenerIds = new Map<number, number>();
    for (const [port, row] of existing.listeners) listenerIds.set(port, Number(row.id));
    for (const port of casterPorts) {
      if (listenerIds.has(port)) continue;
      const [inserted] = await conn.query<any>(
        `INSERT INTO caster_listeners (name, port, enabled, role, description, created_by)
         VALUES (?, ?, 1, 'both', 'Listener import hệ cũ', NULL)`,
        [`NTRIP caster ${port}`, port]
      );
      listenerIds.set(port, Number(inserted.insertId));
      listenersCreated += 1;
    }

    for (const mountpoint of input.mountpoints) {
      const mountpointId = mountpointIds.get(mountpoint.mountpoint.toLowerCase());
      if (!mountpointId) continue;
      for (const port of mountpoint.caster_ports) {
        const listenerId = listenerIds.get(port);
        if (!listenerId) continue;
        const [result] = await conn.query<any>(
          'INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id) VALUES (?, ?)',
          [listenerId, mountpointId]
        );
        if (Number(result.affectedRows ?? 0) > 0) mappingsAdded += 1;
      }
    }

    await conn.query(
      "UPDATE stations SET status = 'disabled' WHERE enabled = 0 AND status = 'active'"
    );
    await conn.query(
      `UPDATE mountpoints m
         JOIN stations s ON s.id = m.station_id
          SET m.enabled = 0, m.paused_by_station_id = s.id
        WHERE s.enabled = 0 AND m.enabled = 1`
    );
    await conn.query(
      `UPDATE station_probes p
         JOIN stations s ON s.id = p.station_id
          SET p.enabled = 0, p.paused_by_station_id = s.id
        WHERE s.enabled = 0 AND p.enabled = 1`
    );
    await conn.query(
      `UPDATE relay_jobs r
         JOIN mountpoints m ON m.name = r.upstream_mount
         JOIN stations s ON s.id = m.station_id
          SET r.enabled = 0, r.paused_by_station_id = s.id,
              r.desired_revision = r.desired_revision + 1
        WHERE s.enabled = 0 AND r.enabled = 1 AND r.deleted_at IS NULL`
    );

    return {
      stationsCreated,
      mountpointsCreated,
      mountpointsBound,
      mountpointsUpdated,
      listenersCreated,
      mappingsAdded
    };
  });

  await writeAudit(
    adminPool,
    null,
    'import',
    'legacy_caster',
    'batch',
    null,
    { ...summary, ...result },
    '127.0.0.1'
  );
  console.log(JSON.stringify({ ...summary, ...result, dryRun: false }, null, 2));
  await adminPool.end();
}

main().catch(async (error) => {
  console.error('[legacy-import]', error instanceof Error ? error.message : error);
  await adminPool.end();
  process.exit(1);
});
