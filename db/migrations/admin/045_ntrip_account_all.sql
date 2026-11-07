-- P18-3 (YC3): tài khoản NTRIP dùng Listener/Mountpoint “Tất cả” động.
ALTER TABLE ntrip_accounts
  ADD COLUMN listener_all TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN mountpoint_all TINYINT(1) NOT NULL DEFAULT 0;

-- Backfill: tài khoản cũ không có dòng account_listener_acl giữ hành vi
-- caster hiện tại (ACL rỗng = mọi listener) nên đặt listener_all = 1.
-- Tất cả tài khoản cũ giữ mountpoint_all = 0 (hành vi deny hiện tại).
UPDATE ntrip_accounts a
  LEFT JOIN (
    SELECT DISTINCT account_id FROM account_listener_acl
  ) l ON l.account_id = a.id
   SET a.listener_all = IF(l.account_id IS NULL, 1, 0),
       a.mountpoint_all = 0;
