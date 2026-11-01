ALTER TABLE relay_jobs
  ADD COLUMN locked TINYINT(1) NOT NULL DEFAULT 0 AFTER enabled,
  ADD KEY idx_relay_jobs_locked (locked);
