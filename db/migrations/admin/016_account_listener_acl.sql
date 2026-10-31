ALTER TABLE caster_listeners
  ADD COLUMN owner_web_user_id BIGINT UNSIGNED NULL,
  ADD KEY idx_caster_listeners_owner (owner_web_user_id),
  ADD CONSTRAINT fk_caster_listeners_owner
    FOREIGN KEY (owner_web_user_id) REFERENCES web_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS account_listener_acl (
  account_id BIGINT UNSIGNED NOT NULL,
  listener_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (account_id, listener_id),
  KEY idx_account_listener_acl_listener (listener_id),
  CONSTRAINT fk_account_listener_acl_account
    FOREIGN KEY (account_id) REFERENCES ntrip_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_account_listener_acl_listener
    FOREIGN KEY (listener_id) REFERENCES caster_listeners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
