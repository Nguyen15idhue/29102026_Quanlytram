import { describe, expect, it } from 'vitest';
import { roleMatrix } from '../src/rbac/matrix';

describe('roleMatrix P1.2', () => {
  it('super admin có toàn quyền', () => {
    expect(roleMatrix('super_admin', 'system_health.view')).toBe('all');
    expect(roleMatrix('super_admin', 'roles.edit')).toBe('all');
  });

  it('admin chỉ đọc role, không xem sức khỏe/settings', () => {
    expect(roleMatrix('admin', 'roles.view')).toBe('all');
    expect(roleMatrix('admin', 'roles.edit')).toBe('none');
    expect(roleMatrix('admin', 'system_health.view')).toBe('none');
    expect(roleMatrix('admin', 'settings.view')).toBe('none');
    expect(roleMatrix('admin', 'caster.edit')).toBe('subtree');
    expect(roleMatrix('admin', 'stations.view')).toBe('subtree');
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
  });
});
