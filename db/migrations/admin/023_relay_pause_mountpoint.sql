ALTER TABLE relay_jobs
  ADD COLUMN paused_by_mountpoint_id BIGINT UNSIGNED NULL AFTER paused_by_station_id,
  ADD KEY idx_relay_jobs_paused_by_mountpoint (paused_by_mountpoint_id);
