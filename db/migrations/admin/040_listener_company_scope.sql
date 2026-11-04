-- Listener/caster thuộc công ty. 3 port cố định 1508/1509/2101 thuộc WALLY;
-- các port riêng của công ty nằm trong dải 1510-1599 (validate ở API/Go).
ALTER TABLE caster_listeners
  ADD COLUMN company_id BIGINT UNSIGNED NULL AFTER owner_web_user_id,
  ADD KEY idx_caster_listeners_company (company_id),
  ADD CONSTRAINT fk_caster_listeners_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

-- Backfill 3 port Wally nếu công ty Wally đã tồn tại. Fresh DB có thể chưa có
-- Wally; seed/reset sẽ gán lại sau khi tạo công ty.
UPDATE caster_listeners l
JOIN companies c ON c.code = 'WALLY'
SET l.company_id = c.id
WHERE l.port IN (1508, 1509, 2101)
  AND l.company_id IS NULL;

-- Không để mountpoint của công ty này nằm trên listener của công ty khác.
DELETE lm
FROM caster_listener_mountpoints lm
JOIN caster_listeners l ON l.id = lm.listener_id
JOIN mountpoints m ON m.id = lm.mountpoint_id
WHERE l.company_id IS NOT NULL
  AND m.company_id IS NOT NULL
  AND l.company_id <> m.company_id;

-- Dọn ACL chéo công ty (account/listener và account/mountpoint).
DELETE al
FROM account_listener_acl al
JOIN ntrip_accounts a ON a.id = al.account_id
JOIN caster_listeners l ON l.id = al.listener_id
WHERE a.company_id IS NOT NULL
  AND l.company_id IS NOT NULL
  AND a.company_id <> l.company_id;

DELETE am
FROM account_mountpoint_acl am
JOIN ntrip_accounts a ON a.id = am.account_id
JOIN mountpoints m ON m.id = am.mountpoint_id
WHERE a.company_id IS NOT NULL
  AND m.company_id IS NOT NULL
  AND a.company_id <> m.company_id;
