CREATE TABLE IF NOT EXISTS service_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  service VARCHAR(32) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  stopped_at DATETIME(3) NULL,
  stop_reason VARCHAR(64) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_service_runs_service_start (service, started_at),
  KEY idx_service_runs_open (service, stopped_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '7')
ON DUPLICATE KEY UPDATE v = VALUES(v);
