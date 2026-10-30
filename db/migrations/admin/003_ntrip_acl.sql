CREATE TABLE IF NOT EXISTS account_mountpoint_acl (
  account_id BIGINT UNSIGNED NOT NULL,
  mountpoint_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (account_id, mountpoint_id),
  KEY idx_account_mountpoint_acl_mountpoint (mountpoint_id),
  CONSTRAINT fk_account_mountpoint_acl_account
    FOREIGN KEY (account_id) REFERENCES ntrip_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_account_mountpoint_acl_mountpoint
    FOREIGN KEY (mountpoint_id) REFERENCES mountpoints(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
