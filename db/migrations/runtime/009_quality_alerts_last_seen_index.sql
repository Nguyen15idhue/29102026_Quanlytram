-- Plan 17: quality-alerts xoá tất cả bản ghi cũ hơn retention,
-- không lọc resolved_at; index bắt đầu bằng last_seen để không quét bảng.
ALTER TABLE quality_alerts
  ADD KEY idx_quality_alerts_last_seen (last_seen, id);

INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '9')
ON DUPLICATE KEY UPDATE v = VALUES(v);
