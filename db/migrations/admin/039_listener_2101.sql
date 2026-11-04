-- Listener 2101 trở thành listener mặc định mới (thay 1509 cho form tạo trạm).
-- Giữ 1508/1509 để tương thích với cấu hình cũ.
INSERT INTO caster_listeners (name, port, enabled, role, description)
SELECT 'NTRIP caster 2101', 2101, 1, 'both', 'Listener mặc định cho source và rover'
WHERE NOT EXISTS (SELECT 1 FROM caster_listeners WHERE port = 2101);

-- Kế thừa owner và mountpoint của listener 1509 để 2101 dùng được ngay.
UPDATE caster_listeners l2101
JOIN caster_listeners l1509 ON l1509.port = 1509
SET l2101.owner_web_user_id = l1509.owner_web_user_id
WHERE l2101.port = 2101
  AND l2101.owner_web_user_id IS NULL;

INSERT IGNORE INTO caster_listener_mountpoints (listener_id, mountpoint_id)
SELECT l2101.id, lm.mountpoint_id
FROM caster_listeners l2101
JOIN caster_listeners l1509 ON l1509.port = 1509
JOIN caster_listener_mountpoints lm ON lm.listener_id = l1509.id
WHERE l2101.port = 2101;
