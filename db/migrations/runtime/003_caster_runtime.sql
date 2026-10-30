CREATE TABLE IF NOT EXISTS caster_connections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listener_id BIGINT UNSIGNED NOT NULL,
  mountpoint_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NULL,
  remote_addr VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  start_ts DATETIME(3) NOT NULL,
  end_ts DATETIME(3) NULL,
  bytes_in BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bytes_out BIGINT UNSIGNED NOT NULL DEFAULT 0,
  disconnect_reason VARCHAR(64) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_caster_connections_listener_start (listener_id, start_ts),
  KEY idx_caster_connections_mountpoint_start (mountpoint_id, start_ts),
  KEY idx_caster_connections_open (end_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '3')
ON DUPLICATE KEY UPDATE v = VALUES(v);
