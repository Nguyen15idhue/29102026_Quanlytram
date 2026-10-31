CREATE TABLE IF NOT EXISTS station_sources (
  station_id BIGINT UNSIGNED NOT NULL,
  source_role ENUM('ntrip_client','ntrip_caster') NOT NULL DEFAULT 'ntrip_caster',
  client_host VARCHAR(190) NOT NULL DEFAULT '',
  client_port INT NOT NULL DEFAULT 1509,
  client_mount VARCHAR(128) NOT NULL DEFAULT '',
  client_username VARCHAR(128) NOT NULL DEFAULT '',
  client_password_enc TEXT NULL,
  client_tls TINYINT(1) NOT NULL DEFAULT 0,
  client_send_gga TINYINT(1) NOT NULL DEFAULT 0,
  client_nmea_interval_sec INT NOT NULL DEFAULT 0,
  caster_version ENUM('v1','v2') NOT NULL DEFAULT 'v2',
  caster_username VARCHAR(128) NOT NULL DEFAULT '',
  caster_password_enc TEXT NULL,
  caster_requires_auth TINYINT(1) NOT NULL DEFAULT 1,
  relay_job_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (station_id),
  KEY idx_station_sources_relay (relay_job_id),
  CONSTRAINT fk_station_sources_station
    FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
  CONSTRAINT fk_station_sources_relay
    FOREIGN KEY (relay_job_id) REFERENCES relay_jobs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE stations s
  LEFT JOIN station_sources ss ON ss.station_id = s.id
   SET s.status = CASE
     WHEN s.enabled = 0 THEN 'disabled'
     ELSE 'active'
   END
 WHERE ss.station_id IS NULL OR s.status = 'active';

INSERT IGNORE INTO station_sources
  (station_id, source_role, client_host, client_port, client_mount,
   caster_version, caster_requires_auth)
SELECT id, 'ntrip_caster', host, port, '',
       CASE WHEN ntrip_version = 'v1' THEN 'v1' ELSE 'v2' END,
       CASE WHEN ntrip_mode = 'v1_noauth' THEN 0 ELSE 1 END
  FROM stations;
