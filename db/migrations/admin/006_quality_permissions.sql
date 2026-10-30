CREATE TABLE IF NOT EXISTS station_probes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  mountpoint_id BIGINT UNSIGNED NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  probe_interval_sec INT NOT NULL DEFAULT 60,
  credential_id BIGINT UNSIGNED NULL,
  owner_web_user_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_station_probes_station (station_id),
  KEY idx_station_probes_owner (owner_web_user_id),
  CONSTRAINT fk_station_probes_station
    FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
  CONSTRAINT fk_station_probes_mountpoint
    FOREIGN KEY (mountpoint_id) REFERENCES mountpoints(id) ON DELETE SET NULL,
  CONSTRAINT fk_station_probes_credential
    FOREIGN KEY (credential_id) REFERENCES relay_credentials(id) ON DELETE SET NULL,
  CONSTRAINT fk_station_probes_owner
    FOREIGN KEY (owner_web_user_id) REFERENCES web_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_station_probes_created_by
    FOREIGN KEY (created_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quality_alert_acks (
  alert_id BIGINT UNSIGNED NOT NULL,
  web_user_id BIGINT UNSIGNED NOT NULL,
  acked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  note VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (alert_id, web_user_id),
  KEY idx_quality_alert_acks_user (web_user_id),
  CONSTRAINT fk_quality_alert_acks_user
    FOREIGN KEY (web_user_id) REFERENCES web_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO permissions (code, module, action, description) VALUES
  ('quality.view', 'quality', 'view', 'Xem chất lượng RTCM trạm và relay'),
  ('quality.ack', 'quality', 'ack', 'Xác nhận cảnh báo chất lượng RTCM')
ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action), description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id,
       CASE r.code
         WHEN 'super_admin' THEN 'all'
         WHEN 'admin' THEN 'subtree'
         WHEN 'user' THEN 'own'
       END
  FROM roles r
  JOIN permissions p ON p.code = 'quality.view'
 WHERE r.code IN ('super_admin', 'admin', 'user')
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id,
       CASE r.code
         WHEN 'super_admin' THEN 'all'
         WHEN 'admin' THEN 'subtree'
       END
  FROM roles r
  JOIN permissions p ON p.code = 'quality.ack'
 WHERE r.code IN ('super_admin', 'admin')
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );
