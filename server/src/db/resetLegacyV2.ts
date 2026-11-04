import { RowDataPacket, createConnection } from 'mysql2/promise';
import { closePool, query, withTransaction } from './pool';
import { closeRuntimePool, runtimeQuery } from './runtimePool';
import { hashPassword } from '../lib/password';
import { config } from '../config';

/**
 * Xoá dữ liệu test, giữ listener 2101/1508/1509 + superadmin, tạo công ty WALLY và
 * tài khoản wally. Mặc định dry-run; chỉ ghi khi --apply (sau khi đã backup).
 */

const RUNTIME_TABLES = [
  'caster_connections',
  'quality_alerts',
  'quality_samples',
  'relay_events',
  'relay_hourly',
  'relay_job_state',
  'relay_sessions',
  'rtcm_message_stats',
  'service_runs',
  'station_source_sessions'
];

const ADMIN_DELETE_ORDER = [
  'quality_alert_acks',
  'alerts',
  'audit_logs',
  'station_probes',
  'station_sources',
  'account_listener_acl',
  'account_mountpoint_acl',
  'ntrip_accounts',
  'caster_listener_mountpoints',
  'mountpoints',
  'stations',
  'relay_jobs',
  'relay_credentials',
  'web_sessions',
  'maintenance_runs',
  'company_backfill_reports'
];

const WALLY = { code: 'WALLY', name: 'Wally', username: 'wally', password: '12345678' };

async function counts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const rows = await query<RowDataPacket[]>(
    `SELECT 'web_users' AS tbl, COUNT(*) AS c FROM web_users
     UNION ALL SELECT 'companies', COUNT(*) FROM companies
     UNION ALL SELECT 'stations', COUNT(*) FROM stations
     UNION ALL SELECT 'mountpoints', COUNT(*) FROM mountpoints
     UNION ALL SELECT 'relay_jobs', COUNT(*) FROM relay_jobs
     UNION ALL SELECT 'ntrip_accounts', COUNT(*) FROM ntrip_accounts
     UNION ALL SELECT 'caster_listeners', COUNT(*) FROM caster_listeners
     UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs`
  );
  for (const row of rows) result[String(row.tbl)] = Number(row.c);
  return result;
}

async function apply(): Promise<void> {
  // cors_app chỉ có SELECT trên cors_runtime (AGENTS §4). Dùng migrator cho
  // thao tác dọn runtime một lần, không đưa quyền ghi runtime vào app.
  const runtime = await createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.migratorUser,
    password: config.mysql.migratorPassword,
    database: config.mysql.runtimeDatabase,
    timezone: 'Z'
  });
  try {
    for (const table of RUNTIME_TABLES) {
      await runtime.query(`DELETE FROM ${table}`);
    }
  } finally {
    await runtime.end();
  }

  await withTransaction(async (conn) => {
    for (const table of ADMIN_DELETE_ORDER) {
      await conn.query(`DELETE FROM ${table}`);
    }
    await conn.query(`DELETE FROM web_users WHERE role_id NOT IN (
      SELECT id FROM roles WHERE code = 'super_admin'
    )`);
    await conn.query('DELETE FROM companies');
    await conn.query('DELETE FROM caster_listeners WHERE port NOT IN (2101, 1508, 1509)');

    const [superRows] = await conn.query<any[]>(
      `SELECT u.id FROM web_users u JOIN roles r ON r.id = u.role_id
        WHERE r.code = 'super_admin' ORDER BY u.id LIMIT 1`
    );
    const superId = Number(superRows[0]?.id ?? 0);
    if (!superId) throw new Error('Không tìm thấy superadmin');

    const [roleRows] = await conn.query<any[]>("SELECT id FROM roles WHERE code = 'admin' LIMIT 1");
    const adminRoleId = Number(roleRows[0]?.id ?? 0);
    if (!adminRoleId) throw new Error('Không tìm thấy role admin');

    const [companyResult] = await conn.query<any>(
      'INSERT INTO companies (code, name, status, notes, created_by) VALUES (?, ?, ?, ?, ?)',
      [WALLY.code, WALLY.name, 'active', 'Chuyển từ hệ thống CORS cũ', superId]
    );
    const companyId = Number(companyResult.insertId);
    const passwordHash = await hashPassword(WALLY.password);
    const [userResult] = await conn.query<any>(
      `INSERT INTO web_users
         (username, password_hash, display_name, email, role_id, parent_user_id, company_id,
          status, must_change_password, created_by)
       VALUES (?, ?, ?, '', ?, ?, ?, 'active', 0, ?)`,
      [WALLY.username, passwordHash, 'Wally Admin', adminRoleId, superId, companyId, superId]
    );
    const wallyId = Number(userResult.insertId);
    await conn.query(
      'UPDATE caster_listeners SET owner_web_user_id = ? WHERE port IN (2101, 1508, 1509)',
      [wallyId]
    );
  });
}

async function main(): Promise<void> {
  const applyMode = process.argv.includes('--apply');
  console.log(`[reset-legacy] chế độ: ${applyMode ? 'APPLY' : 'DRY-RUN'}`);
  const before = await counts();
  console.log('[reset-legacy] trước:', JSON.stringify(before));

  const runtimeCounts: Record<string, number> = {};
  for (const table of RUNTIME_TABLES) {
    const rows = await runtimeQuery<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM ${table}`);
    runtimeCounts[table] = Number(rows[0]?.c ?? 0);
  }
  console.log('[reset-legacy] runtime:', JSON.stringify(runtimeCounts));

  if (!applyMode) {
    console.log('[reset-legacy] dry-run: thêm --apply sau khi đã backup để thực thi');
    return;
  }

  await apply();
  const after = await counts();
  console.log('[reset-legacy] sau:', JSON.stringify(after));
  const company = await query<RowDataPacket[]>(
    'SELECT id, code, name FROM companies WHERE code = ?',
    [WALLY.code]
  );
  const user = await query<RowDataPacket[]>(
    'SELECT id, username, company_id, role_id FROM web_users WHERE username = ?',
    [WALLY.username]
  );
  const listeners = await query<RowDataPacket[]>(
    'SELECT id, port, enabled FROM caster_listeners ORDER BY port'
  );
  console.log('[reset-legacy] Wally:', JSON.stringify({ company: company[0], user: user[0], listeners }));
  const expected = { web_users: 2, companies: 1, stations: 0, mountpoints: 0, relay_jobs: 0, ntrip_accounts: 0, caster_listeners: 3, audit_logs: 0 };
  for (const [key, value] of Object.entries(expected)) {
    if (after[key] !== value) throw new Error(`Sai count ${key}: ${after[key]} != ${value}`);
  }
  console.log('[reset-legacy] hoàn tất');
}

if (require.main === module) {
  main()
    .then(async () => {
      await closePool();
      await closeRuntimePool();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error(`[reset-legacy] ${error.message}`);
      await closePool();
      await closeRuntimePool();
      process.exit(1);
    });
}
