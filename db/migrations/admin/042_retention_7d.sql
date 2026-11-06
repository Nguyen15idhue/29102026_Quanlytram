-- Plan 17: retention chi tiết 7 ngày cho dữ liệu runtime/admin.
-- relay-hourly giữ 90 ngày (aggregate nhỏ, phục vụ chart 30 ngày).
-- audit-logs giữ 365 ngày (compliance).
UPDATE maintenance_jobs
   SET retention_days = 7
 WHERE job_key IN (
   'quality-samples',
   'quality-alerts',
   'relay-events',
   'relay-sessions',
   'caster-connections',
   'station-sessions',
   'rtcm-message-stats',
   'acked-alerts'
 );

-- acked-alerts giữ key cũ để không phá API/UI, nhưng đổi nghĩa:
-- xoá tất cả alert admin cũ hơn 7 ngày, không quan tâm open/acked.
UPDATE maintenance_jobs
   SET label = 'Tất cả cảnh báo'
 WHERE job_key = 'acked-alerts';
