CREATE TABLE IF NOT EXISTS relay_job_state (
  relay_job_id BIGINT UNSIGNED NOT NULL,
  runtime_state ENUM('disabled','pending','connecting','streaming','backoff','error','stopped')
    NOT NULL DEFAULT 'pending',
  applied_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  last_applied_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (relay_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS relay_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  relay_job_id BIGINT UNSIGNED NOT NULL,
  start_ts DATETIME(3) NOT NULL,
  end_ts DATETIME(3) NULL,
  duration_sec INT NULL,
  result VARCHAR(32) NOT NULL DEFAULT '',
  close_reason ENUM('config_changed','disabled','deleted','service_restart','auth_failed','timeout','network','manual')
    NOT NULL DEFAULT 'network',
  message VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_relay_sessions_job_start (relay_job_id, start_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS relay_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  relay_job_id BIGINT UNSIGNED NOT NULL,
  ts DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  type VARCHAR(64) NOT NULL,
  message VARCHAR(500) NOT NULL DEFAULT '',
  duration_sec INT NULL,
  PRIMARY KEY (id),
  KEY idx_relay_events_job_ts (relay_job_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS relay_hourly (
  relay_job_id BIGINT UNSIGNED NOT NULL,
  hour_start_utc DATETIME(3) NOT NULL,
  online_sec INT NOT NULL DEFAULT 0,
  sessions INT NOT NULL DEFAULT 0,
  errors INT NOT NULL DEFAULT 0,
  timeouts INT NOT NULL DEFAULT 0,
  auth_errors INT NOT NULL DEFAULT 0,
  proxy_errors INT NOT NULL DEFAULT 0,
  nmea_errors INT NOT NULL DEFAULT 0,
  retries INT NOT NULL DEFAULT 0,
  PRIMARY KEY (relay_job_id, hour_start_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '2')
ON DUPLICATE KEY UPDATE v = VALUES(v);
