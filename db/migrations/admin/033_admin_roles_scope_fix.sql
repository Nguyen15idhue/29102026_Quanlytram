UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
   SET rp.scope = CASE
     WHEN p.code = 'roles.view' THEN 'all'
     ELSE 'none'
   END
 WHERE r.code = 'admin'
   AND p.code LIKE 'roles.%';

UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
   SET rp.scope = 'none'
 WHERE r.code = 'user'
   AND p.code LIKE 'roles.%';
