ALTER TABLE stations
  ADD COLUMN enabled_at DATETIME(3) NULL AFTER status,
  ADD KEY idx_stations_enabled_at (enabled_at);

ALTER TABLE relay_jobs
  ADD COLUMN enabled_at DATETIME(3) NULL AFTER locked,
  ADD KEY idx_relay_jobs_enabled_at (enabled_at);

UPDATE stations
   SET enabled_at = updated_at
 WHERE enabled = 1 AND status <> 'locked';

UPDATE relay_jobs
   SET enabled_at = updated_at
 WHERE enabled = 1 AND locked = 0;
