-- SEC-F15: tile proxy yêu cầu quyền `map.view` nhưng permission này chưa được
-- seed/migration tạo ra, nên mọi tài khoản đều bị 403 khi tải tile mới (bản đồ
-- chỉ còn tile cache sẵn trong trình duyệt).
INSERT INTO permissions (code, module, action, description) VALUES
  ('map.view', 'map', 'view', 'Xem nền bản đồ vận hành')
ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action),
  description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
  FROM roles r
  JOIN permissions p ON p.code = 'map.view'
 WHERE r.code = 'super_admin'
ON DUPLICATE KEY UPDATE scope = VALUES(scope);

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'tenant'
  FROM roles r
  JOIN permissions p ON p.code = 'map.view'
 WHERE r.code = 'admin'
ON DUPLICATE KEY UPDATE scope = VALUES(scope);

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'tenant'
  FROM roles r
  JOIN permissions p ON p.code = 'map.view'
 WHERE r.code = 'user'
ON DUPLICATE KEY UPDATE scope = VALUES(scope);
