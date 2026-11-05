-- Audit account NTRIP dùng chung giữa các relay job.
-- Chạy read-only:
--   docker exec -i <mysql> sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t' < scripts/audit-ntrip-accounts.sql
-- Cảnh báo khi relay_jobs > max_connections: job mới có thể bị 503
-- "Maximum Connections Reached" dù các job khác đang lỗi.

SELECT a.id,
       a.username,
       a.enabled,
       a.max_connections,
       COUNT(DISTINCT j.id) AS relay_jobs,
       GROUP_CONCAT(DISTINCT j.id ORDER BY j.id) AS job_ids
FROM cors_admin.relay_jobs j
JOIN cors_admin.relay_credentials c ON c.id = j.upstream_credential_id
JOIN cors_admin.ntrip_accounts a ON a.username = c.username
WHERE j.deleted_at IS NULL
  AND j.enabled = 1
  AND j.upstream_host IN ('rtktk.online', '127.0.0.1', 'localhost')
GROUP BY a.id, a.username, a.enabled, a.max_connections
ORDER BY (COUNT(DISTINCT j.id) / GREATEST(a.max_connections, 1)) DESC, relay_jobs DESC;

SELECT a.id,
       a.username,
       a.max_connections,
       a.managed_by_station_id,
       COUNT(DISTINCT j.id) AS relay_jobs
FROM cors_admin.relay_jobs j
JOIN cors_admin.relay_credentials c ON c.id = j.upstream_credential_id
JOIN cors_admin.ntrip_accounts a ON a.username = c.username
WHERE j.deleted_at IS NULL
  AND j.enabled = 1
GROUP BY a.id, a.username, a.max_connections, a.managed_by_station_id
HAVING relay_jobs > a.max_connections
ORDER BY relay_jobs DESC;
