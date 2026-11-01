ALTER TABLE mountpoints
  ADD COLUMN paused_by_station_id BIGINT UNSIGNED NULL AFTER enabled,
  ADD KEY idx_mountpoints_paused_by (paused_by_station_id);

ALTER TABLE relay_jobs
  ADD COLUMN paused_by_station_id BIGINT UNSIGNED NULL AFTER enabled,
  ADD KEY idx_relay_jobs_paused_by (paused_by_station_id);

ALTER TABLE station_probes
  ADD COLUMN paused_by_station_id BIGINT UNSIGNED NULL AFTER enabled,
  ADD KEY idx_station_probes_paused_by (paused_by_station_id);

UPDATE relay_jobs r
  JOIN mountpoints m ON m.name = r.upstream_mount
  JOIN stations s ON s.id = m.station_id
   SET r.enabled = 0,
       r.paused_by_station_id = s.id,
       r.desired_revision = r.desired_revision + 1
 WHERE s.enabled = 0 AND r.enabled = 1 AND r.deleted_at IS NULL;

UPDATE station_probes p
  JOIN stations s ON s.id = p.station_id
   SET p.enabled = 0,
       p.paused_by_station_id = s.id
 WHERE s.enabled = 0 AND p.enabled = 1;

UPDATE mountpoints m
  JOIN stations s ON s.id = m.station_id
   SET m.enabled = 0,
       m.paused_by_station_id = s.id
 WHERE s.enabled = 0 AND m.enabled = 1;
