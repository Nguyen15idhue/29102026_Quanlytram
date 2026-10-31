ALTER TABLE stations
  ADD COLUMN source_type ENUM('relay_caster','caster_ingest','probe_client','manual') NOT NULL DEFAULT 'manual',
  ADD COLUMN ntrip_version ENUM('v1','v2') NOT NULL DEFAULT 'v1',
  ADD COLUMN ntrip_mode ENUM('v1_noauth','v1_auth','v2_auth','ntrip_client') NOT NULL DEFAULT 'v1_noauth';

UPDATE stations s
  JOIN mountpoints m ON m.station_id = s.id
  JOIN relay_jobs r ON r.upstream_mount = m.name AND r.upstream_host = s.host AND r.deleted_at IS NULL
  LEFT JOIN relay_credentials uc ON uc.id = r.upstream_credential_id
   SET s.source_type = 'relay_caster',
       s.ntrip_version = r.upstream_ntrip_version,
       s.ntrip_mode = CASE
         WHEN r.upstream_ntrip_version = 'v1' AND uc.id IS NULL THEN 'v1_noauth'
         WHEN r.upstream_ntrip_version = 'v1' THEN 'v1_auth'
         ELSE 'v2_auth'
       END;
