import { hashPassword } from '../lib/password';
import { createStationResources } from '../lib/stationResources';
import { adminPool } from './pool';
import { config } from '../config';
import { roleMatrix } from '../rbac/matrix';

const permissions = [
  ['web_users.view', 'web_users', 'view'],
  ['web_users.add', 'web_users', 'add'],
  ['web_users.edit', 'web_users', 'edit'],
  ['web_users.delete', 'web_users', 'delete'],
  ['roles.view', 'roles', 'view'],
  ['roles.add', 'roles', 'add'],
  ['roles.edit', 'roles', 'edit'],
  ['roles.delete', 'roles', 'delete'],
  ['stations.view', 'stations', 'view'],
  ['stations.add', 'stations', 'add'],
  ['stations.edit', 'stations', 'edit'],
  ['stations.delete', 'stations', 'delete'],
  ['mountpoints.view', 'mountpoints', 'view'],
  ['mountpoints.add', 'mountpoints', 'add'],
  ['mountpoints.edit', 'mountpoints', 'edit'],
  ['mountpoints.delete', 'mountpoints', 'delete'],
  ['ntrip_accounts.view', 'ntrip_accounts', 'view'],
  ['ntrip_accounts.add', 'ntrip_accounts', 'add'],
  ['ntrip_accounts.edit', 'ntrip_accounts', 'edit'],
  ['ntrip_accounts.delete', 'ntrip_accounts', 'delete'],
  ['relay.view', 'relay', 'view'],
  ['relay.add', 'relay', 'add'],
  ['relay.edit', 'relay', 'edit'],
  ['relay.delete', 'relay', 'delete'],
  ['connections.view', 'connections', 'view'],
  ['connections.delete', 'connections', 'delete'],
  ['settings.view', 'settings', 'view'],
  ['settings.edit', 'settings', 'edit'],
  ['alerts.view', 'alerts', 'view'],
  ['alerts.ack', 'alerts', 'ack'],
  ['quality.view', 'quality', 'view'],
  ['quality.ack', 'quality', 'ack'],
  ['audit.view', 'audit', 'view'],
  ['system_health.view', 'system_health', 'view'],
  ['caster.view', 'caster', 'view'],
  ['caster.add', 'caster', 'add'],
  ['caster.edit', 'caster', 'edit'],
  ['caster.delete', 'caster', 'delete']
] as const;

async function main(): Promise<void> {
  await adminPool.query(
    `INSERT INTO roles (code, name, level, is_system, description) VALUES
       ('super_admin', 'Super Admin', 100, 1, 'Toàn quyền hệ thống'),
       ('admin', 'Admin', 50, 1, 'Quản trị trong subtree'),
       ('user', 'User', 10, 1, 'Chỉ tài khoản của mình')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), level = VALUES(level), is_system = VALUES(is_system),
       description = VALUES(description)`
  );

  for (const [code, module, action] of permissions) {
    await adminPool.query(
      `INSERT INTO permissions (code, module, action, description)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action)`,
      [code, module, action, `${module} ${action}`]
    );
  }

  const [roleRows] = await adminPool.query<any[]>(
    'SELECT id, code FROM roles WHERE code IN (?, ?, ?)',
    ['super_admin', 'admin', 'user']
  );
  const [permissionRows] = await adminPool.query<any[]>(
    'SELECT id, code FROM permissions'
  );

  const resetRbac = process.argv.includes('--reset-rbac');
  if (resetRbac) {
    await adminPool.query(
      'DELETE rp FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code IN (?, ?, ?)',
      ['super_admin', 'admin', 'user']
    );
    console.log('[seed] --reset-rbac: đã xóa quyền của 3 role hệ thống');
  }
  const [[rbacCount]] = await adminPool.query<any[]>(
    'SELECT COUNT(*) AS count FROM role_permissions'
  );
  if (resetRbac || Number(rbacCount.count) === 0) {
    for (const role of roleRows) {
      for (const permission of permissionRows) {
        const scope = roleMatrix(role.code, permission.code);
        if (scope === 'none') continue;
        await adminPool.query(
          'INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, ?)',
          [role.id, permission.id, scope]
        );
      }
    }
  } else {
    console.log('[seed] role_permissions đã có dữ liệu, bỏ qua ghi đè');
  }

  const roleId = async (code: string): Promise<number> => {
    const [rows] = await adminPool.query<any[]>(
      'SELECT id FROM roles WHERE code = ?',
      [code]
    );
    return rows[0].id;
  };

  const seedUser = async (
    username: string,
    password: string,
    displayName: string,
    email: string,
    roleCode: string,
    parentId: number | null,
    createdBy: number | null
  ): Promise<number> => {
    const role = await roleId(roleCode);
    const passwordHash = await hashPassword(password);
    await adminPool.query(
      `INSERT INTO web_users
         (username, password_hash, display_name, email, role_id, parent_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         role_id = VALUES(role_id), parent_user_id = VALUES(parent_user_id),
         display_name = VALUES(display_name), email = VALUES(email), status = 'active'`,
      [username, passwordHash, displayName, email, role, parentId, createdBy]
    );
    const [rows] = await adminPool.query<any[]>(
      'SELECT id FROM web_users WHERE username = ?',
      [username]
    );
    return rows[0].id;
  };

  const superId = await seedUser(
    'superadmin',
    config.seed.superadminPassword,
    'Super Admin',
    'superadmin@example.local',
    'super_admin',
    null,
    null
  );
  const adminId = await seedUser(
    'admin',
    config.seed.adminPassword,
    'Quản trị viên',
    'admin@example.local',
    'admin',
    superId,
    superId
  );
  const user1Id = await seedUser(
    'user1',
    config.seed.userPassword,
    'Người dùng 1',
    'user1@example.local',
    'user',
    adminId,
    adminId
  );
  const user2Id = await seedUser(
    'user2',
    config.seed.userPassword,
    'Người dùng 2',
    'user2@example.local',
    'user',
    adminId,
    adminId
  );

  const [listenerRows] = await adminPool.query<any[]>(
    'SELECT id FROM caster_listeners WHERE port = 1509 LIMIT 1'
  );
  const listenerId = listenerRows[0]?.id ? Number(listenerRows[0].id) : null;

  const seedStation = async (
    name: string,
    ownerId: number,
    createdBy: number
  ): Promise<number> => {
    const [rows] = await adminPool.query<any[]>(
      'SELECT id FROM stations WHERE name = ? LIMIT 1',
      [name]
    );
    if (rows[0]?.id) return Number(rows[0].id);
    const [inserted] = await adminPool.query<any>(
      `INSERT INTO stations
         (name, host, port, connection_type, source_type, enabled,
          owner_web_user_id, created_by)
       VALUES (?, 'example.invalid', 1509, 'ntrip', 'caster_ingest', 1, ?, ?)`,
      [name, ownerId, createdBy]
    );
    const stationId = Number(inserted.insertId);
    if (listenerId) {
      const conn = await adminPool.getConnection();
      try {
        await createStationResources(
          conn,
          stationId,
          {
            name,
            enabled: true,
            source_role: 'ntrip_caster',
            caster_listener_id: listenerId,
            caster_username: `seed_${stationId}`,
            caster_password: config.seed.ntripPassword || '12345678',
            caster_requires_auth: true
          },
          ownerId,
          createdBy
        );
      } finally {
        conn.release();
      }
    }
    return stationId;
  };

  await seedStation('Trạm test Hà Nội 01', adminId, superId);
  await seedStation('Trạm test Hà Nội 02', user1Id, adminId);
  await seedStation('Trạm test Đà Nẵng 01', user2Id, adminId);

  const ntripHash = await hashPassword(config.seed.ntripPassword);
  for (const [username, ownerId, createdBy] of [
    ['test_ntrip_01', adminId, adminId],
    ['test_ntrip_02', user1Id, adminId]
  ] as const) {
    await adminPool.query(
      `INSERT INTO ntrip_accounts (username, password_hash, max_connections, owner_web_user_id, created_by)
       VALUES (?, ?, 2, ?, ?)
       ON DUPLICATE KEY UPDATE owner_web_user_id = VALUES(owner_web_user_id)`,
      [username, ntripHash, ownerId, createdBy]
    );
  }

  console.log('[seed] roles, permissions, users, stations, mountpoints, ntrip accounts ready');
}

main()
  .catch((err) => {
    console.error('[seed] failed', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await adminPool.end();
  });
