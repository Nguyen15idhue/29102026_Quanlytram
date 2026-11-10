-- Plan 20 (P20-1): index phục vụ truy vấn "mẫu chất lượng mới nhất".
-- Bảng quality_samples chỉ ghi ~87 dòng/phút (mỗi target 1 dòng/60 s) nên thêm
-- index không ảnh hưởng đường byte RTCM. Không đổi cột, không đổi dữ liệu.
--
-- 1) idx_quality_samples_latest: (target_type, target_id, ts)
--    -> lấy mẫu mới nhất của một target bằng 1 lần seek index.
-- 2) idx_quality_samples_target_dir_ts: (target_type, target_id, direction, ts)
--    -> lọc theo hướng + khoảng thời gian (trang hoạt động relay, uptime).
-- 3) idx_relay_sessions_open: (relay_job_id, end_ts)
--    -> tập phiên đang mở, tránh quét 250k dòng mỗi lần mở danh sách trạm.
-- 4) idx_quality_alerts_open: (resolved_at, last_seen)
--    -> đếm alert chưa resolve và nạp alert mới nhất.
--
-- Migration idempotent: cơ sở dữ liệu đã được thử index thủ công (local) vẫn
-- chạy được, không lỗi "Duplicate key name".

SET @has_latest := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'quality_samples'
     AND index_name = 'idx_quality_samples_latest'
);
SET @sql := IF(@has_latest = 0,
  'ALTER TABLE quality_samples ADD KEY idx_quality_samples_latest (target_type, target_id, ts)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_dir_ts := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'quality_samples'
     AND index_name = 'idx_quality_samples_target_dir_ts'
);
SET @sql := IF(@has_dir_ts = 0,
  'ALTER TABLE quality_samples ADD KEY idx_quality_samples_target_dir_ts (target_type, target_id, direction, ts)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_sessions := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'relay_sessions'
     AND index_name = 'idx_relay_sessions_open'
);
SET @sql := IF(@has_sessions = 0,
  'ALTER TABLE relay_sessions ADD KEY idx_relay_sessions_open (relay_job_id, end_ts)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_alerts := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'quality_alerts'
     AND index_name = 'idx_quality_alerts_open'
);
SET @sql := IF(@has_alerts = 0,
  'ALTER TABLE quality_alerts ADD KEY idx_quality_alerts_open (resolved_at, last_seen)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '11')
ON DUPLICATE KEY UPDATE v = VALUES(v);
