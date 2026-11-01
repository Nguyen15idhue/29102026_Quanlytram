CREATE TABLE IF NOT EXISTS maintenance_jobs (
  job_key VARCHAR(64) NOT NULL,
  label VARCHAR(120) NOT NULL,
  scope ENUM('admin','runtime') NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  retention_days INT UNSIGNED NOT NULL,
  batch_size INT UNSIGNED NOT NULL DEFAULT 1000,
  interval_sec INT UNSIGNED NOT NULL DEFAULT 3600,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (job_key),
  CONSTRAINT fk_maintenance_jobs_user
    FOREIGN KEY (updated_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS maintenance_settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  scheduler_enabled TINYINT(1) NOT NULL DEFAULT 1,
  run_hour_local TINYINT UNSIGNED NOT NULL DEFAULT 3,
  run_minute_local TINYINT UNSIGNED NOT NULL DEFAULT 0,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_maintenance_settings_user
    FOREIGN KEY (updated_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO maintenance_settings (id) VALUES (1)
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO maintenance_jobs
  (job_key, label, scope, table_name, retention_days, batch_size, interval_sec, enabled)
VALUES
  ('relay-sessions',      'Phiên relay',              'runtime', 'relay_sessions',           90,  1000, 3600,  1),
  ('relay-events',        'Sự kiện relay',            'runtime', 'relay_events',             30,  1000, 3600,  1),
  ('relay-hourly',        'Tổng hợp giờ relay',       'runtime', 'relay_hourly',             90,  1000, 3600,  1),
  ('quality-samples',     'Mẫu chất lượng RTCM',      'runtime', 'quality_samples',          35,  1000, 21600, 1),
  ('quality-alerts',      'Cảnh báo chất lượng',      'runtime', 'quality_alerts',           90,  1000, 21600, 1),
  ('caster-connections',  'Phiên kết nối caster',     'runtime', 'caster_connections',       90,  1000, 3600,  1),
  ('station-sessions',    'Phiên nguồn trạm',         'runtime', 'station_source_sessions',  90,  1000, 3600,  1),
  ('rtcm-message-stats',  'Thống kê loại bản tin',    'runtime', 'rtcm_message_stats',      365,  1000, 21600, 1),
  ('web-sessions',        'Phiên đăng nhập web',      'admin',   'web_sessions',              7,  1000, 3600,  1),
  ('audit-logs',          'Nhật ký audit',            'admin',   'audit_logs',              365,  1000, 86400, 1),
  ('acked-alerts',        'Cảnh báo đã xác nhận',     'admin',   'alerts',                  180,  1000, 86400, 1)
ON DUPLICATE KEY UPDATE job_key = job_key;

CREATE TABLE IF NOT EXISTS maintenance_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_key VARCHAR(64) NOT NULL,
  scope ENUM('admin','runtime') NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  dry_run TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('running','ok','error') NOT NULL DEFAULT 'running',
  rows_deleted BIGINT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  error VARCHAR(500) NOT NULL DEFAULT '',
  triggered_by BIGINT UNSIGNED NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_maintenance_runs_job (job_key, started_at),
  KEY idx_maintenance_runs_started (started_at),
  CONSTRAINT fk_maintenance_runs_user
    FOREIGN KEY (triggered_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO permissions (code, module, action, description) VALUES
  ('system_ops.view', 'system_ops', 'view', 'Xem tối ưu và tự động hóa hệ thống'),
  ('system_ops.edit', 'system_ops', 'edit', 'Chạy bảo trì và dọn dẹp hệ thống')
ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action),
  description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
  FROM roles r
  JOIN permissions p ON p.code IN ('system_ops.view', 'system_ops.edit')
 WHERE r.code = 'super_admin'
ON DUPLICATE KEY UPDATE scope = VALUES(scope);

DELETE rp FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
 WHERE r.code IN ('admin', 'user') AND p.module = 'system_ops';
