import { describe, expect, it } from 'vitest';
import { canAssignRole, canManageRole } from '../src/rbac/scope';
import { roleMatrix } from '../src/rbac/matrix';

describe('roleMatrix company scope (P05-2)', () => {
  it('super admin có toàn quyền', () => {
    expect(roleMatrix('super_admin', 'system_health.view')).toBe('all');
    expect(roleMatrix('super_admin', 'roles.edit')).toBe('all');
    expect(roleMatrix('super_admin', 'companies.edit')).toBe('all');
    expect(roleMatrix('super_admin', 'system_ops.view')).toBe('all');
    expect(roleMatrix('super_admin', 'system_ops.edit')).toBe('all');
  });

  it('admin company-wide, chỉ đọc role, không quản lý listener/công ty', () => {
    expect(roleMatrix('admin', 'roles.view')).toBe('all');
    expect(roleMatrix('admin', 'roles.edit')).toBe('none');
    expect(roleMatrix('admin', 'system_health.view')).toBe('none');
    expect(roleMatrix('admin', 'system_ops.view')).toBe('none');
    expect(roleMatrix('admin', 'system_ops.edit')).toBe('none');
    expect(roleMatrix('admin', 'settings.view')).toBe('none');
    expect(roleMatrix('admin', 'companies.view')).toBe('none');
    expect(roleMatrix('admin', 'companies.edit')).toBe('none');
    expect(roleMatrix('admin', 'caster.view')).toBe('all');
    expect(roleMatrix('admin', 'caster.add')).toBe('none');
    expect(roleMatrix('admin', 'caster.edit')).toBe('none');
    expect(roleMatrix('admin', 'caster.delete')).toBe('none');
    expect(roleMatrix('admin', 'stations.view')).toBe('tenant');
    expect(roleMatrix('admin', 'stations.add')).toBe('tenant');
    expect(roleMatrix('admin', 'mountpoints.edit')).toBe('tenant');
    expect(roleMatrix('admin', 'ntrip_accounts.view')).toBe('tenant');
    expect(roleMatrix('admin', 'web_users.add')).toBe('tenant');
    expect(roleMatrix('admin', 'alerts.view')).toBe('tenant');
    expect(roleMatrix('admin', 'quality.ack')).toBe('tenant');
    expect(roleMatrix('admin', 'audit.view')).toBe('tenant');
  });

  it('user xem tenant, sửa own và không sửa trạm/relay', () => {
    expect(roleMatrix('user', 'stations.view')).toBe('tenant');
    expect(roleMatrix('user', 'relay.view')).toBe('tenant');
    expect(roleMatrix('user', 'stations.edit')).toBe('none');
    expect(roleMatrix('user', 'relay.delete')).toBe('none');
    expect(roleMatrix('user', 'mountpoints.edit')).toBe('own');
    expect(roleMatrix('user', 'ntrip_accounts.add')).toBe('own');
    expect(roleMatrix('user', 'alerts.view')).toBe('own');
    expect(roleMatrix('user', 'audit.view')).toBe('none');
    expect(roleMatrix('user', 'caster.view')).toBe('none');
    expect(roleMatrix('user', 'companies.view')).toBe('none');
    expect(roleMatrix('user', 'system_ops.view')).toBe('none');
    expect(roleMatrix('user', 'system_ops.edit')).toBe('none');
  });
});

describe('peer admin policy (D05-1/D05-2/D05-5)', () => {
  it('admin được tạo peer admin nhưng không sửa/xóa peer admin', () => {
    expect(canAssignRole(50, 50, false)).toBe(true);
    expect(canAssignRole(50, 10, false)).toBe(true);
    expect(canManageRole(50, 50, false)).toBe(false);
    expect(canManageRole(50, 10, false)).toBe(true);
  });

  it('admin không tạo/sửa super_admin', () => {
    expect(canAssignRole(50, 100, false)).toBe(false);
    expect(canManageRole(50, 100, false)).toBe(false);
  });

  it('super_admin quản lý mọi role', () => {
    expect(canAssignRole(100, 100, true)).toBe(true);
    expect(canManageRole(100, 100, true)).toBe(true);
  });
});
