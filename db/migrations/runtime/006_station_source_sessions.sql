CREATE TABLE IF NOT EXISTS station_source_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  start_ts DATETIME(3) NOT NULL,
  end_ts DATETIME(3) NULL,
  close_reason VARCHAR(64) NOT NULL DEFAULT '',
  message VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_station_source_sessions_station (station_id, start_ts),
  KEY idx_station_source_sessions_open (end_ts, start_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '6')
ON DUPLICATE KEY UPDATE v = VALUES(v);
