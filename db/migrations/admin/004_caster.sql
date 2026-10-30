CREATE TABLE IF NOT EXISTS caster_listeners (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  port INT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  role ENUM('both','source','rover') NOT NULL DEFAULT 'both',
  description VARCHAR(500) NOT NULL DEFAULT '',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_caster_listeners_port (port),
  KEY idx_caster_listeners_enabled (enabled),
  KEY idx_caster_listeners_created_by (created_by),
  CONSTRAINT fk_caster_listeners_created_by
    FOREIGN KEY (created_by) REFERENCES web_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS caster_listener_mountpoints (
  listener_id BIGINT UNSIGNED NOT NULL,
  mountpoint_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (listener_id, mountpoint_id),
  KEY idx_caster_listener_mountpoints_mountpoint (mountpoint_id),
  CONSTRAINT fk_caster_listener_mountpoints_listener
    FOREIGN KEY (listener_id) REFERENCES caster_listeners(id) ON DELETE CASCADE,
  CONSTRAINT fk_caster_listener_mountpoints_mountpoint
    FOREIGN KEY (mountpoint_id) REFERENCES mountpoints(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO caster_listeners (name, port, enabled, role, description)
SELECT 'NTRIP caster 1509', 1509, 1, 'both', 'Listener mặc định cho source và rover'
WHERE NOT EXISTS (SELECT 1 FROM caster_listeners WHERE port = 1509);
