#!/usr/bin/env node
/**
 * Kiểm tra ua_prefix cũ còn sót trong cấu hình relay/trạm.
 *
 * Mặc định chỉ đọc (dry-run). Chỉ ghi khi có --apply và biến môi trường
 * ALLOW_DEVICE_PROFILE_FIX=1. Không in mật khẩu/DSN.
 *
 * Cách chạy:
 *   node scripts/check-device-profile-prefixes.mjs
 *   ALLOW_DEVICE_PROFILE_FIX=1 node scripts/check-device-profile-prefixes.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from '../server/node_modules/mysql2/promise.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const apply = process.argv.includes('--apply');
const dryRun = !apply;

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
if (!env.MYSQL_HOST || !env.MYSQL_ADMIN_DATABASE) {
  throw new Error('Thiếu MYSQL_HOST / MYSQL_ADMIN_DATABASE trong .env.local');
}
if (!dryRun && process.env.ALLOW_DEVICE_PROFILE_FIX !== '1') {
  throw new Error('Từ chối ghi: đặt ALLOW_DEVICE_PROFILE_FIX=1 để xác nhận');
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_APP_USER || env.MYSQL_APP_USER || 'cors_app',
  password: process.env.MYSQL_APP_PASSWORD || env.MYSQL_APP_PASSWORD,
  database: process.env.MYSQL_ADMIN_DATABASE || env.MYSQL_ADMIN_DATABASE,
  timezone: 'Z'
});

const legacy = /CORS-MVP/i;
try {
  const [relayRows] = await connection.query(
    `SELECT id, name, ua_mode, ua_prefix
       FROM relay_jobs
      WHERE deleted_at IS NULL AND (ua_prefix LIKE '%CORS-MVP%' OR ua_mode = 'literal')
      ORDER BY id`
  );
  const [stationRows] = await connection.query(
    `SELECT station_id, client_ua_prefix
       FROM station_sources
      WHERE client_ua_prefix LIKE '%CORS-MVP%'
      ORDER BY station_id`
  );

  const relayFindings = relayRows.filter(
    (row) => legacy.test(String(row.ua_prefix ?? '')) || row.ua_mode === 'literal'
  );
  const stationFindings = stationRows.filter((row) => legacy.test(String(row.client_ua_prefix ?? '')));

  console.log(`Relay job cần xem: ${relayFindings.length}`);
  for (const row of relayFindings) {
    console.log(
      `  #${row.id} ${row.name}: ua_mode=${row.ua_mode} ua_prefix=${JSON.stringify(row.ua_prefix ?? '')}` +
        (legacy.test(String(row.ua_prefix ?? '')) ? ' -> nên đổi sang profile hoặc bỏ prefix nội bộ' : '')
    );
  }
  console.log(`Nguồn trạm cần xem: ${stationFindings.length}`);
  for (const row of stationFindings) {
    console.log(`  station #${row.station_id}: client_ua_prefix=${JSON.stringify(row.client_ua_prefix)}`);
  }

  if (dryRun) {
    console.log('Dry-run: không ghi DB. Dùng --apply (kèm ALLOW_DEVICE_PROFILE_FIX=1) để xóa prefix nội bộ.');
  } else {
    const [relayResult] = await connection.query(
      `UPDATE relay_jobs
          SET ua_prefix = '', ua_mode = 'profile'
        WHERE deleted_at IS NULL AND ua_prefix LIKE '%CORS-MVP%'`
    );
    const [stationResult] = await connection.query(
      `UPDATE station_sources SET client_ua_prefix = ''
        WHERE client_ua_prefix LIKE '%CORS-MVP%'`
    );
    console.log(
      `Đã sửa: relay_jobs=${relayResult.affectedRows}, station_sources=${stationResult.affectedRows}`
    );
  }
} finally {
  await connection.end();
}
