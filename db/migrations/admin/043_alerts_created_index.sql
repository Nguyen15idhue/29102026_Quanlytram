-- Plan 17: job acked-alerts dọn tất cả alert admin theo created_at.
ALTER TABLE alerts
  ADD KEY idx_alerts_created (created_at);
