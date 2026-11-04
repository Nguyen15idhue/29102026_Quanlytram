-- Caster listener không còn toàn hệ thống: admin/user chỉ xem listener
-- thuộc company của mình. Quyền tạo/sửa/xóa vẫn chỉ super_admin.
UPDATE role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
SET rp.scope = 'tenant'
WHERE r.code IN ('admin', 'user')
  AND p.code = 'caster.view';
