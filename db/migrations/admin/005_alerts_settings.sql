CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type VARCHAR(64) NOT NULL,
  severity ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
  target_type ENUM('relay_job','caster','system') NOT NULL DEFAULT 'system',
  target_id BIGINT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  message VARCHAR(500) NOT NULL DEFAULT '',
  status ENUM('open','acked') NOT NULL DEFAULT 'open',
  dedupe_key VARCHAR(190) NOT NULL DEFAULT '',
  owner_web_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  acked_at DATETIME(3) NULL,
  acked_by BIGINT UNSIGNED NULL,
  ack_note VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_alerts_status_created (status, created_at),
  KEY idx_alerts_target (target_type, target_id),
  KEY idx_alerts_dedupe (dedupe_key, created_at),
  KEY idx_alerts_owner (owner_web_user_id),
  CONSTRAINT fk_alerts_owner
    FOREIGN KEY (owner_web_user_id) REFERENCES web_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_alerts_acked_by
    FOREIGN KEY (acked_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSON NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_settings_updated_by
    FOREIGN KEY (updated_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO permissions (code, module, action, description) VALUES
  ('alerts.view', 'alerts', 'view', 'Xem cảnh báo vận hành'),
  ('alerts.ack', 'alerts', 'ack', 'Xác nhận cảnh báo vận hành')
ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action), description = VALUES(description);
