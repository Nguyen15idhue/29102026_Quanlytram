INSERT INTO permissions (code, module, action, description) VALUES
  ('companies.view', 'companies', 'view', 'Xem công ty'),
  ('companies.add', 'companies', 'add', 'Thêm công ty'),
  ('companies.edit', 'companies', 'edit', 'Sửa công ty'),
  ('companies.delete', 'companies', 'delete', 'Xóa công ty')
ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action),
  description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
  FROM roles r
  JOIN permissions p ON p.code LIKE 'companies.%'
 WHERE r.code = 'super_admin'
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
   SET rp.scope = CASE
     WHEN p.code = 'roles.view' THEN 'all'
     WHEN p.code = 'caster.view' THEN 'all'
     WHEN p.code LIKE 'caster.%' THEN 'none'
     WHEN p.code LIKE 'settings.%' THEN 'none'
     WHEN p.code = 'system_health.view' THEN 'none'
     WHEN p.action IN ('view', 'add', 'edit', 'delete') THEN 'tenant'
     WHEN p.code IN ('alerts.ack', 'quality.ack', 'connections.delete') THEN 'tenant'
     ELSE rp.scope
   END
 WHERE r.code = 'admin';

UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
   SET rp.scope = CASE
     WHEN p.code IN ('stations.view', 'relay.view') THEN 'tenant'
     WHEN p.code LIKE 'mountpoints.%' THEN 'own'
     WHEN p.code LIKE 'ntrip_accounts.%' THEN 'own'
     WHEN p.code IN ('alerts.view', 'quality.view') THEN 'own'
     ELSE 'none'
   END
 WHERE r.code = 'user';

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id,
       CASE
         WHEN r.code = 'super_admin' THEN 'all'
         WHEN r.code = 'admin' THEN
           CASE
             WHEN p.code = 'roles.view' THEN 'all'
             WHEN p.code = 'caster.view' THEN 'all'
             WHEN p.code LIKE 'caster.%' THEN 'none'
             WHEN p.code LIKE 'settings.%' THEN 'none'
             WHEN p.code = 'system_health.view' THEN 'none'
             WHEN p.action IN ('view', 'add', 'edit', 'delete') THEN 'tenant'
             WHEN p.code IN ('alerts.ack', 'quality.ack', 'connections.delete') THEN 'tenant'
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
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );
