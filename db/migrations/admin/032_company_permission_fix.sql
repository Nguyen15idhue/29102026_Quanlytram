UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
   SET rp.scope = 'none'
 WHERE r.code = 'admin'
   AND p.code LIKE 'companies.%';

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
  FROM roles r
  JOIN permissions p ON p.code LIKE 'companies.%'
 WHERE r.code = 'super_admin'
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );
