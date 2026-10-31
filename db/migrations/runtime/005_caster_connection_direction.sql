ALTER TABLE caster_connections
  ADD COLUMN direction ENUM('source','rover') NOT NULL DEFAULT 'rover' AFTER account_id,
  ADD KEY idx_caster_connections_direction_start (direction, start_ts);

UPDATE runtime_meta SET v = '5' WHERE k = 'schema_version';
INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '5')
ON DUPLICATE KEY UPDATE v = VALUES(v);
