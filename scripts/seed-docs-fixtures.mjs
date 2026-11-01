import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from '../server/node_modules/mysql2/promise.js';

const require = createRequire(import.meta.url);
const { hash, Algorithm } = require('../server/node_modules/@node-rs/argon2');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dryRun = !process.argv.includes('--apply');

function readEnv() {
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) throw new Error('Thiếu file .env.local');
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const env = readEnv();
if (!env.MYSQL_ROOT_PASSWORD) throw new Error('Thiếu MYSQL_ROOT_PASSWORD trong .env.local');
if (!env.SEED_ADMIN_PASSWORD || !env.SEED_USER_PASSWORD || !env.SEED_NTRIP_PASSWORD) {
  throw new Error('Thiếu SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD / SEED_NTRIP_PASSWORD trong .env.local');
}
if (!dryRun && process.env.ALLOW_DOCS_SEED !== '1') {
  throw new Error('Từ chối ghi dữ liệu: đặt ALLOW_DOCS_SEED=1 để xác nhận');
}

const PREFIX = 'DOCS';
const COMPANY_CODE = 'DOCS_DEMO';
const COMPANY_NAME = 'DOCS Demo';

const counters = new Map();
function count(kind) {
  counters.set(kind, (counters.get(kind) ?? 0) + 1);
}

async function hashPassword(password) {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
}

const conn = await mysql.createConnection({
  host: '127.0.0.1',
  port: Number(process.env.DOCS_MYSQL_PORT || 3307),
  user: 'root',
  password: env.MYSQL_ROOT_PASSWORD,
  database: env.MYSQL_ADMIN_DATABASE || 'cors_admin',
  charset: 'utf8mb4'
});

async function ensureCompany() {
  const [rows] = await conn.query('SELECT id FROM companies WHERE code = ?', [COMPANY_CODE]);
  if (rows.length) return rows[0].id;
  count('company');
  if (dryRun) return -1;
  const [result] = await conn.query(
    'INSERT INTO companies (code, name, status, notes, created_by) VALUES (?, ?, ?, ?, ?)',
    [COMPANY_CODE, COMPANY_NAME, 'active', 'Dữ liệu minh họa trang hướng dẫn', 1]
  );
  return result.insertId;
}

async function ensureUser({ username, displayName, email, roleId, companyId, parentId, password }) {
  const [rows] = await conn.query('SELECT id FROM web_users WHERE username = ?', [username]);
  if (rows.length) return rows[0].id;
  count('user');
  if (dryRun) return -1;
  const passwordHash = await hashPassword(password);
  const [result] = await conn.query(
    `INSERT INTO web_users (username, password_hash, display_name, email, role_id, parent_user_id, company_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1)`,
    [username, passwordHash, displayName, email, roleId, parentId, companyId]
  );
  return result.insertId;
}

async function ensureStation(station) {
  const [rows] = await conn.query('SELECT id FROM stations WHERE name = ? AND company_id = ?', [
    station.name,
    station.companyId
  ]);
  if (rows.length) return rows[0].id;
  count('station');
  if (dryRun) return -1;
  const [result] = await conn.query(
    `INSERT INTO stations
      (name, host, port, connection_type, lat, lon, notes, owner_web_user_id, created_by,
       station_type, enabled, receiver_type, receiver_sn, receiver_firmware, antenna_type,
       antenna_sn, antenna_height, elevation_mask, contractor, region, address, device_id,
       network_type, network_mode, protocol, source_type, ntrip_version, ntrip_mode, status,
       coordinate_type, province, ward, address_detail, company_id)
     VALUES (?, ?, ?, 'ntrip', ?, ?, ?, ?, 1, 'reference', ?, 'DOCS Receiver', ?, '1.0.0',
             'DOCS Antenna', ?, 0, 10, 'DOCS', ?, ?, ?, 'wifi', 'router', 'ntrip',
             'caster_ingest', 'v2', 'v2_auth', ?, 'wgs84', ?, ?, '', ?)`,
    [
      station.name,
      'example.invalid',
      1509,
      station.lat,
      station.lon,
      `${station.name} — dữ liệu minh họa`,
      station.ownerId,
      station.enabled ? 1 : 0,
      `SN-${station.slug}`,
      `ANT-${station.slug}`,
      station.region,
      station.region,
      `DEV-${station.slug}`,
      station.status,
      station.province,
      station.ward,
      station.companyId
    ]
  );
  return result.insertId;
}

async function ensureMountpoint(mountpoint) {
  const [rows] = await conn.query('SELECT id FROM mountpoints WHERE name = ?', [mountpoint.name]);
  if (rows.length) return rows[0].id;
  count('mountpoint');
  if (dryRun) return -1;
  const [result] = await conn.query(
    `INSERT INTO mountpoints
      (name, station_id, enabled, paused_by_station_id, requires_auth, owner_web_user_id, created_by,
       service_type, position_mode, satellite_systems, caster_interval, code_protocol, code_type,
       description, auth_mode, company_id)
     VALUES (?, ?, ?, NULL, 1, ?, 1, 'rtcm', 'normal', '', 0, '', '', ?, 'ntrip_account', ?)`,
    [
      mountpoint.name,
      mountpoint.stationId,
      mountpoint.enabled ? 1 : 0,
      mountpoint.ownerId,
      `${mountpoint.name} — mountpoint minh họa`,
      mountpoint.companyId
    ]
  );
  return result.insertId;
}

async function ensureListener(listener) {
  const [rows] = await conn.query('SELECT id FROM caster_listeners WHERE name = ?', [listener.name]);
  if (rows.length) return rows[0].id;
  count('listener');
  if (dryRun) return -1;
  const [result] = await conn.query(
    `INSERT INTO caster_listeners (name, port, enabled, role, description, created_by, owner_web_user_id)
     VALUES (?, ?, 0, ?, ?, 1, ?)`,
    [listener.name, listener.port, listener.role, `${listener.name} — listener minh họa`, listener.ownerId]
  );
  return result.insertId;
}

async function ensureAccount(account) {
  const [rows] = await conn.query('SELECT id FROM ntrip_accounts WHERE username = ?', [account.username]);
  if (rows.length) return rows[0].id;
  count('ntrip_account');
  if (dryRun) return -1;
  const passwordHash = await hashPassword(env.SEED_NTRIP_PASSWORD);
  const [result] = await conn.query(
    `INSERT INTO ntrip_accounts
      (username, password_hash, enabled, max_connections, owner_web_user_id, created_by, company,
       contact_name, email, phone, available_area, auth_method, notes, company_id)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'basic', ?, ?)`,
    [
      account.username,
      passwordHash,
      account.enabled ? 1 : 0,
      account.maxConnections,
      account.ownerId,
      COMPANY_NAME,
      account.contactName,
      account.email,
      '0000000000',
      account.area,
      `${account.username} — tài khoản minh họa`,
      account.companyId
    ]
  );
  return result.insertId;
}

async function ensureRelayJob(job) {
  const [rows] = await conn.query('SELECT id FROM relay_jobs WHERE name = ? AND deleted_at IS NULL', [
    job.name
  ]);
  if (rows.length) return rows[0].id;
  count('relay_job');
  if (dryRun) return -1;
  const [result] = await conn.query(
    `INSERT INTO relay_jobs
      (name, enabled, locked, upstream_host, upstream_port, upstream_mount, upstream_ntrip_version,
       downstream_host, downstream_port, downstream_mount, downstream_ntrip_version, downstream_mode,
       lat, lon, ua_prefix, nmea_interval_sec, origin, desired_revision, upstream_key, downstream_key,
       owner_web_user_id, created_by, company_id)
     VALUES (?, 0, 0, ?, 1509, ?, 'v2', ?, 1509, ?, 'v2', 'auto', ?, ?, 'CORS-DOCS', 30, 'manual', 1, ?, ?, ?, 1, ?)`,
    [
      job.name,
      job.upstreamHost,
      job.upstreamMount,
      job.downstreamHost,
      job.downstreamMount,
      job.lat,
      job.lon,
      `${job.upstreamHost}:${job.upstreamMount}`.toLowerCase(),
      `${job.downstreamHost}:${job.downstreamMount}`.toLowerCase(),
      job.ownerId,
      job.companyId
    ]
  );
  return result.insertId;
}

async function ensureAlert(alert) {
  const [rows] = await conn.query('SELECT id FROM alerts WHERE dedupe_key = ?', [alert.dedupeKey]);
  if (rows.length) return rows[0].id;
  count('alert');
  if (dryRun) return -1;
  const [result] = await conn.query(
    `INSERT INTO alerts
      (type, severity, target_type, target_id, title, message, status, dedupe_key, owner_web_user_id,
       ack_note, event_type, level, unread, company_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 1, ?)`,
    [
      alert.type,
      alert.severity,
      alert.targetType,
      alert.targetId,
      alert.title,
      alert.message,
      alert.status,
      alert.dedupeKey,
      alert.ownerId,
      alert.type,
      alert.level,
      alert.companyId
    ]
  );
  return result.insertId;
}

const companyId = await ensureCompany();
const adminId = await ensureUser({
  username: 'docs.admin',
  displayName: 'Quản trị DOCS',
  email: 'docs.admin@example.local',
  roleId: 2,
  companyId,
  parentId: 1,
  password: env.SEED_ADMIN_PASSWORD
});
const userId = await ensureUser({
  username: 'docs.user',
  displayName: 'Người dùng DOCS',
  email: 'docs.user@example.local',
  roleId: 3,
  companyId,
  parentId: adminId > 0 ? adminId : null,
  password: env.SEED_USER_PASSWORD
});

const stations = [
  {
    name: 'DOCS-Trạm Hà Nội',
    slug: 'HN',
    lat: 21.0285,
    lon: 105.8542,
    province: 'Hà Nội',
    ward: 'Ba Đình',
    region: 'Hà Nội',
    enabled: true,
    status: 'active'
  },
  {
    name: 'DOCS-Trạm Đà Nẵng',
    slug: 'DN',
    lat: 16.0544,
    lon: 108.2022,
    province: 'Đà Nẵng',
    ward: 'Hải Châu',
    region: 'Đà Nẵng',
    enabled: true,
    status: 'active'
  },
  {
    name: 'DOCS-Trạm Hồ Chí Minh',
    slug: 'HCM',
    lat: 10.7769,
    lon: 106.7009,
    province: 'Hồ Chí Minh',
    ward: 'Quận 1',
    region: 'Hồ Chí Minh',
    enabled: false,
    status: 'disabled'
  }
].map((item) => ({ ...item, companyId, ownerId: adminId }));

const stationIds = [];
for (const station of stations) stationIds.push(await ensureStation(station));

const mountpoints = [
  { name: 'DOCS_HN_RTCM', stationId: stationIds[0], enabled: true },
  { name: 'DOCS_DN_RTCM', stationId: stationIds[1], enabled: true },
  { name: 'DOCS_HCM_RTCM', stationId: stationIds[2], enabled: false },
  { name: 'DOCS_HN_TEST', stationId: stationIds[0], enabled: false }
].map((item) => ({ ...item, companyId, ownerId: adminId }));

for (const mountpoint of mountpoints) await ensureMountpoint(mountpoint);

const listeners = [
  { name: 'DOCS Caster Hà Nội', port: 15151, role: 'both' },
  { name: 'DOCS Caster Đà Nẵng', port: 15152, role: 'source' }
].map((item) => ({ ...item, ownerId: adminId }));

for (const listener of listeners) await ensureListener(listener);

const accounts = [
  { username: 'docs_rover_01', enabled: true, maxConnections: 5, contactName: 'Rover DOCS 01', email: 'rover01@example.local', area: 'Hà Nội' },
  { username: 'docs_rover_02', enabled: false, maxConnections: 2, contactName: 'Rover DOCS 02', email: 'rover02@example.local', area: 'Đà Nẵng' }
].map((item) => ({ ...item, companyId, ownerId: adminId }));

for (const account of accounts) await ensureAccount(account);

const relayJobs = [
  {
    name: 'DOCS-Relay Hà Nội',
    upstreamHost: 'example.invalid',
    upstreamMount: 'DOCS_HN_RTCM',
    downstreamHost: 'caster.example.invalid',
    downstreamMount: 'DOCS_OUT_HN',
    lat: 21.0285,
    lon: 105.8542
  },
  {
    name: 'DOCS-Relay Đà Nẵng',
    upstreamHost: 'example.invalid',
    upstreamMount: 'DOCS_DN_RTCM',
    downstreamHost: 'caster.example.invalid',
    downstreamMount: 'DOCS_OUT_DN',
    lat: 16.0544,
    lon: 108.2022
  }
].map((item) => ({ ...item, companyId, ownerId: adminId }));

const relayIds = [];
for (const job of relayJobs) relayIds.push(await ensureRelayJob(job));

const alerts = [
  {
    type: 'relay_down',
    severity: 'critical',
    targetType: 'relay_job',
    targetId: relayIds[0],
    title: 'Relay mất kết nối nguồn',
    message: 'Relay DOCS-Relay Hà Nội không nhận được dữ liệu trong 60 giây.',
    status: 'open',
    dedupeKey: 'DOCS-ALERT-RELAY-HN',
    level: 'critical'
  },
  {
    type: 'quality_low',
    severity: 'warning',
    targetType: 'relay_job',
    targetId: relayIds[1],
    title: 'Chất lượng tín hiệu giảm',
    message: 'Điểm chất lượng của DOCS-Relay Đà Nẵng dưới ngưỡng 60.',
    status: 'acked',
    dedupeKey: 'DOCS-ALERT-QUALITY-DN',
    level: 'major'
  },
  {
    type: 'station_offline',
    severity: 'info',
    targetType: 'caster',
    targetId: 0,
    title: 'Trạm đang tắt theo kế hoạch',
    message: 'Trạm DOCS-Trạm Hồ Chí Minh đang tắt để bảo trì.',
    status: 'acked',
    dedupeKey: 'DOCS-ALERT-STATION-HCM',
    level: 'minor'
  }
].map((item) => ({ ...item, companyId, ownerId: adminId }));

for (const alert of alerts) await ensureAlert(alert);

await conn.end();

console.log(`Chế độ: ${dryRun ? 'DRY-RUN (không ghi)' : 'GHI DỮ LIỆU'}`);
console.log(`Công ty: ${COMPANY_NAME} · người dùng: docs.admin, docs.user`);
console.log('Số bản ghi sẽ tạo mới (nếu chưa tồn tại):');
for (const [kind, total] of counters) console.log(`  ${kind}: ${total}`);
if (counters.size === 0) console.log('  (không có) — dữ liệu đã đủ, chạy lại an toàn.');
if (dryRun) console.log('Chạy lại với ALLOW_DOCS_SEED=1 và --apply để ghi thật.');
