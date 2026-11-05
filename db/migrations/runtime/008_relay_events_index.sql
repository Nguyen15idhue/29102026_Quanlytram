-- Prune relay_events theo thời gian cần index bắt đầu bằng ts; index hiện có
-- là (relay_job_id, ts) nên DELETE ... WHERE ts < ? ORDER BY ts, id bị quét bảng.
ALTER TABLE relay_events
  ADD KEY idx_relay_events_ts (ts, id);
