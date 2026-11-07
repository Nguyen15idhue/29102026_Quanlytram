-- P18-2 (YC2): admin công ty được sửa listener thuộc công ty mình.
-- Không cấp quyền tạo/xóa; user chỉ xem. Server vẫn chặn đổi port/company.
UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
   SET rp.scope = 'tenant'
 WHERE r.code = 'admin'
   AND p.code = 'caster.edit';

UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
   SET rp.scope = 'none'
 WHERE r.code = 'user'
   AND p.code IN ('caster.add', 'caster.edit', 'caster.delete');
