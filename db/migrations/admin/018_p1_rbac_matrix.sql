INSERT INTO permissions (code, module, action, description) VALUES
  ('system_health.view', 'system_health', 'view', 'Xem sức khỏe hệ thống'),
  ('caster.view', 'caster', 'view', 'Xem caster và listener'),
  ('caster.add', 'caster', 'add', 'Thêm listener'),
  ('caster.edit', 'caster', 'edit', 'Sửa listener'),
  ('caster.delete', 'caster', 'delete', 'Xóa listener')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id,
  CASE
    WHEN r.code = 'super_admin' THEN 'all'
    WHEN r.code = 'admin' THEN
      CASE
        WHEN p.code = 'roles.view' THEN 'all'
        WHEN p.code LIKE 'roles.%' THEN 'none'
        WHEN p.code LIKE 'settings.%' THEN 'none'
        WHEN p.code = 'system_health.view' THEN 'none'
        WHEN p.code LIKE 'web_users.%' THEN 'subtree'
        WHEN p.code LIKE 'alerts.%' THEN 'subtree'
        WHEN p.code LIKE 'quality.%' THEN 'subtree'
        WHEN p.code = 'audit.view' THEN 'subtree'
        WHEN p.action IN ('view', 'add', 'edit', 'delete') THEN 'subtree'
        ELSE 'none'
      END
    WHEN r.code = 'user' THEN
      CASE
        WHEN p.code IN ('stations.view', 'relay.view') THEN 'tenant'
        WHEN p.code LIKE 'mountpoints.%' THEN 'own'
        WHEN p.code LIKE 'ntrip_accounts.%' THEN 'own'
        WHEN p.code IN ('alerts.view', 'quality.view') THEN 'own'
        ELSE 'none'
      END
    ELSE 'none'
  END
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('super_admin', 'admin', 'user')
ON DUPLICATE KEY UPDATE scope = VALUES(scope);
