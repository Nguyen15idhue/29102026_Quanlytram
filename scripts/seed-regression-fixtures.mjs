import fs from 'node:fs';
import path from 'node:path';
import mysql from '../server/node_modules/mysql2/promise.js';

const root = path.resolve(process.cwd());
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
}
if (!env.MYSQL_ROOT_PASSWORD) throw new Error('MYSQL_ROOT_PASSWORD missing');

const conn = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3307,
  user: 'root',
  password: env.MYSQL_ROOT_PASSWORD,
  database: 'cors_admin',
  charset: 'utf8mb4',
  multipleStatements: true
});

const sql = `
INSERT INTO stations
  (id, name, host, port, connection_type, source_type, ntrip_version, ntrip_mode,
   lat, lon, notes, station_type, enabled, status, coordinate_type, province, ward,
   address_detail, receiver_type, receiver_sn, receiver_firmware, antenna_type,
   antenna_sn, antenna_height, elevation_mask, contractor, region, address, device_id,
   network_type, network_mode, protocol, owner_web_user_id, created_by)
VALUES
  (1, 'Trạm test Hà Nội 01', 'example.invalid', 1509, 'ntrip', 'caster_ingest', 'v2', 'v2_auth',
   NULL, NULL, 'Trạm test Hà Nội 01', 'reference', 1, 'active', 'wgs84', 'Hà Nội', 'Ba Đình',
   '', 'Trimble', 'SN001', '1.0', 'Trimble Zephyr', 'ANT001', 0, 10, '', 'Hà Nội', 'Hà Nội', 'DEV001',
   'wifi', 'router', 'ntrip', 3, 1),
  (79, 'SLA Mộc Châu', 'rtktk.online', 1509, 'ntrip', 'relay_caster', 'v2', 'v2_auth',
   NULL, NULL, 'Trạm thật SLA Mộc Châu', 'reference', 1, 'active', 'wgs84', 'Sơn La', 'Mộc Châu',
   '', 'Trimble', 'SN079', '1.0', 'Trimble Zephyr', 'ANT079', 0, 10, '', 'Sơn La', 'Mộc Châu', 'DEV079',
   'wifi', 'router', 'ntrip', 1, 1),
  (80, 'THA Hậu Lộc', 'rtktk.online', 1509, 'ntrip', 'relay_caster', 'v2', 'v2_auth',
   NULL, NULL, 'Trạm thật THA Hậu Lộc', 'reference', 1, 'active', 'wgs84', 'Thanh Hóa', 'Hậu Lộc',
   '', 'Trimble', 'SN080', '1.0', 'Trimble Zephyr', 'ANT080', 0, 10, '', 'Thanh Hóa', 'Hậu Lộc', 'DEV080',
   'wifi', 'router', 'ntrip', 1, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), notes = VALUES(notes), enabled = VALUES(enabled), status = VALUES(status),
  source_type = VALUES(source_type), province = VALUES(province), ward = VALUES(ward),
  owner_web_user_id = VALUES(owner_web_user_id);

INSERT INTO mountpoints (name, station_id, enabled, paused_by_station_id, service_type,
  position_mode, satellite_systems, caster_interval, code_protocol, code_type, description,
  owner_web_user_id, created_by)
VALUES
  ('TEST_HNI_01', 1, 1, NULL, 'rtcm', 'normal', '', 0, '', '', 'Regression fixture', 1, 1),
  ('SLA_MocChau', 79, 1, NULL, 'rtcm', 'normal', '', 0, '', '', 'Regression fixture', 1, 1),
  ('THA_HauLoc', 80, 1, NULL, 'rtcm', 'normal', '', 0, '', '', 'Regression fixture', 1, 1)
ON DUPLICATE KEY UPDATE
  station_id = VALUES(station_id), enabled = 1, paused_by_station_id = NULL;

INSERT INTO station_sources
  (station_id, source_role, client_host, client_port, client_mount,
   caster_version, caster_username, caster_requires_auth, caster_listener_id, relay_job_id)
VALUES
  (1, 'ntrip_caster', 'example.invalid', 1509, '', 'v2', 'test_hni', 1, 1, NULL),
  (79, 'ntrip_caster', 'rtktk.online', 1509, '', 'v2', 'sla_mocchau', 1, 1, 92),
  (80, 'ntrip_caster', 'rtktk.online', 1509, '', 'v2', 'tha_hauloc', 1, 1, 93)
ON DUPLICATE KEY UPDATE
  source_role = VALUES(source_role), caster_version = VALUES(caster_version),
  caster_username = VALUES(caster_username), caster_requires_auth = VALUES(caster_requires_auth),
  caster_listener_id = VALUES(caster_listener_id), relay_job_id = VALUES(relay_job_id);

INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id)
SELECT 1, id FROM mountpoints WHERE name IN ('TEST_HNI_01', 'SLA_MocChau', 'THA_HauLoc');
`;

await conn.query(sql);
const [rows] = await conn.query('SELECT id, name FROM stations WHERE id IN (1,79,80) ORDER BY id');
console.log(JSON.stringify({ ok: true, stations: rows }, null, 2));
await conn.end();
