SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE stations ADD COLUMN company_id BIGINT UNSIGNED NULL, ADD KEY idx_stations_company (company_id)',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'stations' AND column_name = 'company_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE mountpoints ADD COLUMN company_id BIGINT UNSIGNED NULL, ADD KEY idx_mountpoints_company (company_id)',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'mountpoints' AND column_name = 'company_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE ntrip_accounts ADD COLUMN company_id BIGINT UNSIGNED NULL, ADD KEY idx_ntrip_accounts_company (company_id)',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'ntrip_accounts' AND column_name = 'company_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE relay_jobs ADD COLUMN company_id BIGINT UNSIGNED NULL, ADD KEY idx_relay_jobs_company (company_id)',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'relay_jobs' AND column_name = 'company_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE relay_credentials ADD COLUMN company_id BIGINT UNSIGNED NULL, ADD KEY idx_relay_credentials_company (company_id)',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'relay_credentials' AND column_name = 'company_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE station_probes ADD COLUMN company_id BIGINT UNSIGNED NULL, ADD KEY idx_station_probes_company (company_id)',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'station_probes' AND column_name = 'company_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE alerts ADD COLUMN company_id BIGINT UNSIGNED NULL, ADD KEY idx_alerts_company (company_id)',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'alerts' AND column_name = 'company_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE audit_logs ADD COLUMN company_id BIGINT UNSIGNED NULL, ADD KEY idx_audit_company (company_id)',
    'DO 0')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'company_id');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE stations t
  JOIN web_users u ON u.id = t.owner_web_user_id
   SET t.company_id = u.company_id
 WHERE t.company_id IS NULL AND u.company_id IS NOT NULL;

UPDATE mountpoints t
  JOIN web_users u ON u.id = t.owner_web_user_id
   SET t.company_id = u.company_id
 WHERE t.company_id IS NULL AND u.company_id IS NOT NULL;

UPDATE ntrip_accounts t
  JOIN web_users u ON u.id = t.owner_web_user_id
   SET t.company_id = u.company_id
 WHERE t.company_id IS NULL AND u.company_id IS NOT NULL;

UPDATE relay_jobs t
  JOIN web_users u ON u.id = t.owner_web_user_id
   SET t.company_id = u.company_id
 WHERE t.company_id IS NULL AND u.company_id IS NOT NULL;

UPDATE relay_credentials t
  JOIN web_users u ON u.id = t.owner_web_user_id
   SET t.company_id = u.company_id
 WHERE t.company_id IS NULL AND u.company_id IS NOT NULL;

UPDATE station_probes t
  JOIN web_users u ON u.id = t.owner_web_user_id
   SET t.company_id = u.company_id
 WHERE t.company_id IS NULL AND u.company_id IS NOT NULL;

UPDATE alerts t
  JOIN web_users u ON u.id = t.owner_web_user_id
   SET t.company_id = u.company_id
 WHERE t.company_id IS NULL AND u.company_id IS NOT NULL;

UPDATE audit_logs t
  JOIN web_users u ON u.id = t.actor_web_user_id
   SET t.company_id = u.company_id
 WHERE t.company_id IS NULL AND u.company_id IS NOT NULL;

INSERT INTO company_backfill_reports (entity_type, entity_id, reason)
SELECT 'station', CAST(t.id AS CHAR),
       IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
  FROM stations t
 WHERE t.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_backfill_reports b
      WHERE b.entity_type = 'station' AND b.entity_id = CAST(t.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
        AND b.reason = IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
   )
UNION ALL
SELECT 'mountpoint', CAST(t.id AS CHAR),
       IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
  FROM mountpoints t
 WHERE t.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_backfill_reports b
      WHERE b.entity_type = 'mountpoint' AND b.entity_id = CAST(t.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
        AND b.reason = IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
   )
UNION ALL
SELECT 'ntrip_account', CAST(t.id AS CHAR),
       IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
  FROM ntrip_accounts t
 WHERE t.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_backfill_reports b
      WHERE b.entity_type = 'ntrip_account' AND b.entity_id = CAST(t.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
        AND b.reason = IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
   )
UNION ALL
SELECT 'relay_job', CAST(t.id AS CHAR),
       IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
  FROM relay_jobs t
 WHERE t.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_backfill_reports b
      WHERE b.entity_type = 'relay_job' AND b.entity_id = CAST(t.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
        AND b.reason = IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
   )
UNION ALL
SELECT 'relay_credential', CAST(t.id AS CHAR),
       IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
  FROM relay_credentials t
 WHERE t.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_backfill_reports b
      WHERE b.entity_type = 'relay_credential' AND b.entity_id = CAST(t.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
        AND b.reason = IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
   )
UNION ALL
SELECT 'station_probe', CAST(t.id AS CHAR),
       IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
  FROM station_probes t
 WHERE t.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_backfill_reports b
      WHERE b.entity_type = 'station_probe' AND b.entity_id = CAST(t.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
        AND b.reason = IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
   )
UNION ALL
SELECT 'alert', CAST(t.id AS CHAR),
       IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
  FROM alerts t
 WHERE t.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_backfill_reports b
      WHERE b.entity_type = 'alert' AND b.entity_id = CAST(t.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
        AND b.reason = IF(t.owner_web_user_id IS NULL, 'owner_missing', 'owner_without_company')
   );
