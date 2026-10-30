CREATE TABLE IF NOT EXISTS rtcm_message_stats (
  target_type ENUM('station','relay_job') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  mountpoint_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  direction ENUM('ingest','upstream','downstream') NOT NULL,
  hour_start_utc DATETIME(3) NOT NULL,
  message_type INT NOT NULL,
  `count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_seen_at DATETIME(3) NOT NULL,
  PRIMARY KEY (target_type, target_id, mountpoint_id, direction, hour_start_utc, message_type),
  KEY idx_rtcm_message_stats_hour (hour_start_utc),
  KEY idx_rtcm_message_stats_target (target_type, target_id, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quality_samples (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_type ENUM('station','relay_job') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  mountpoint_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  direction ENUM('ingest','upstream','downstream') NOT NULL,
  ts DATETIME(3) NOT NULL,
  window_sec INT NOT NULL DEFAULT 60,
  score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  state VARCHAR(32) NOT NULL DEFAULT 'unknown',
  frames BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  crc_errors BIGINT UNSIGNED NOT NULL DEFAULT 0,
  parse_errors BIGINT UNSIGNED NOT NULL DEFAULT 0,
  unknown_messages BIGINT UNSIGNED NOT NULL DEFAULT 0,
  msm_epochs BIGINT UNSIGNED NOT NULL DEFAULT 0,
  satellites INT NOT NULL DEFAULT 0,
  signals INT NOT NULL DEFAULT 0,
  cells INT NOT NULL DEFAULT 0,
  avg_cnr DECIMAL(5,2) NULL,
  reported_station_id SMALLINT UNSIGNED NULL,
  arp_x BIGINT NULL,
  arp_y BIGINT NULL,
  arp_z BIGINT NULL,
  arp_delta_m DECIMAL(8,3) NULL,
  antenna VARCHAR(64) NULL,
  age_ms INT NOT NULL DEFAULT 0,
  gaps INT NOT NULL DEFAULT 0,
  cnr_available TINYINT(1) NOT NULL DEFAULT 0,
  details JSON NULL,
  PRIMARY KEY (id),
  KEY idx_quality_samples_target (target_type, target_id, mountpoint_id, direction, ts),
  KEY idx_quality_samples_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quality_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_type ENUM('station','relay_job') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  mountpoint_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  direction ENUM('ingest','upstream','downstream') NOT NULL,
  event_type VARCHAR(64) NOT NULL DEFAULT 'station_alert',
  code VARCHAR(64) NOT NULL,
  level ENUM('critical','major','minor','info') NOT NULL DEFAULT 'minor',
  first_seen DATETIME(3) NOT NULL,
  last_seen DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  details JSON NULL,
  PRIMARY KEY (id),
  KEY idx_quality_alerts_open (resolved_at, last_seen),
  KEY idx_quality_alerts_target (target_type, target_id, mountpoint_id, direction, last_seen),
  KEY idx_quality_alerts_code (code, last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '4')
ON DUPLICATE KEY UPDATE v = VALUES(v);
