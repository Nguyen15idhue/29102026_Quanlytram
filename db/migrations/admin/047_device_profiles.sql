-- P19-1 (Kế hoạch 19): device profile ngụy trang User-Agent + thông số NMEA.
-- Port baseline từ relay cũ (relayrtcm/backup/main.go L78-106); không đọc/ghi
-- bất kỳ file nào trong relayrtcm/backup.
--
-- Lưu ý: bảng chỉ lưu cấu hình. Version UA không lưu DB — sinh tất định từ
-- (profile.code, target_id, role) ở Go/Node (D19-3, D19-19).

CREATE TABLE IF NOT EXISTS device_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(96) NOT NULL,
  vendor VARCHAR(96) NOT NULL DEFAULT '',
  version_template ENUM('major.minor.patch','major.minor.patch.date',
                        'vmajor.minor.patch','major.minor') NOT NULL,
  ntrip_version ENUM('v1','v2') NOT NULL DEFAULT 'v2',
  http_version ENUM('HTTP/1.0','HTTP/1.1') NOT NULL DEFAULT 'HTTP/1.1',
  connection ENUM('close','keep-alive') NOT NULL DEFAULT 'close',
  nmea_interval_sec INT NOT NULL DEFAULT 10,
  nmea_jitter_sec INT NOT NULL DEFAULT 2,
  hdop_min DECIMAL(3,1) NOT NULL DEFAULT 0.8,
  hdop_max DECIMAL(3,1) NOT NULL DEFAULT 1.2,
  sats_min TINYINT UNSIGNED NOT NULL DEFAULT 10,
  sats_max TINYINT UNSIGNED NOT NULL DEFAULT 14,
  send_gsa TINYINT(1) NOT NULL DEFAULT 1,
  send_rmc TINYINT(1) NOT NULL DEFAULT 0,
  initial_delay_ms INT NOT NULL DEFAULT 0,
  motion ENUM('static','rover') NOT NULL DEFAULT 'static',
  receiver_type_alias VARCHAR(96) NOT NULL DEFAULT '',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  builtin TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_profiles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 12 profile baseline. ON DUPLICATE KEY UPDATE không ghi đè chỉnh sửa của admin:
-- migration chỉ chạy một lần, nhưng vẫn an toàn nếu file được chạy lại tay.
INSERT INTO device_profiles
  (code, name, vendor, version_template, ntrip_version, http_version, connection,
   nmea_interval_sec, nmea_jitter_sec, hdop_min, hdop_max, sats_min, sats_max,
   send_gsa, send_rmc, initial_delay_ms, motion, receiver_type_alias, enabled, builtin)
VALUES
  ('gnss_internet_radio', 'GNSSInternetRadio', 'GNSSInternetRadio', 'major.minor.patch',       'v2', 'HTTP/1.1', 'close',      10, 2, 0.8, 1.2, 10, 14, 1, 0,    0, 'static', 'GNSSInternetRadio', 1, 1),
  ('efix_efield',         'EFIX eField',       'EFIX',              'major.minor.patch.date',  'v2', 'HTTP/1.1', 'close',      12, 3, 0.7, 1.0, 12, 16, 1, 1, 1000, 'static', 'EFIX',              1, 1),
  ('chc_landstar',        'CHC LandStar',      'CHC Navigation',    'major.minor.patch.date',  'v2', 'HTTP/1.1', 'close',      11, 2, 0.9, 1.3,  9, 13, 0, 1,    0, 'static', 'CHC',               1, 1),
  ('chc_i83',             'CHC i83',           'CHC Navigation',    'major.minor.patch',       'v2', 'HTTP/1.1', 'close',      15, 4, 0.8, 1.4, 10, 15, 1, 0, 2000, 'static', 'CHC',               1, 1),
  ('comnav_t300',         'COMNAV T300',       'ComNav Technology', 'major.minor.patch',       'v2', 'HTTP/1.1', 'close',       9, 1, 0.7, 1.1, 11, 15, 0, 0, 1000, 'static', 'COMNAV',            1, 1),
  ('trimble_da2',         'Trimble DA2',       'Trimble',           'major.minor',             'v1', 'HTTP/1.1', 'keep-alive', 10, 2, 0.6, 0.9, 12, 18, 1, 1,    0, 'rover',  'Trimble',           1, 1),
  ('hitarget_v90',        'Hi-Target V90',     'Hi-Target',         'major.minor.patch',       'v2', 'HTTP/1.1', 'close',      13, 3, 0.8, 1.2, 10, 14, 0, 1, 1000, 'static', 'Hi-Target',         1, 1),
  ('south_s82t',          'South S82T',        'South Surveying',   'major.minor.patch',       'v2', 'HTTP/1.1', 'close',      11, 2, 0.9, 1.3,  9, 13, 1, 0,    0, 'static', 'South',             1, 1),
  ('stonex_s900a',        'Stonex S900A',      'Stonex',            'major.minor.patch',       'v2', 'HTTP/1.1', 'close',      14, 3, 0.8, 1.4, 10, 14, 0, 0, 2000, 'static', 'Stonex',            1, 1),
  ('unistrong_g970',      'UniStrong G970',    'UniStrong',         'major.minor.patch',       'v2', 'HTTP/1.1', 'close',      10, 2, 0.7, 1.1, 11, 15, 1, 1, 1000, 'static', 'UniStrong',         1, 1),
  ('emlid_reachrs2',      'Emlid ReachRS2',    'Emlid',             'vmajor.minor.patch',      'v2', 'HTTP/1.1', 'close',      12, 2, 0.8, 1.1, 11, 14, 0, 0, 1000, 'static', 'Emlid',             1, 1),
  ('leica_gs18',          'Leica GS18',        'Leica Geosystems',  'major.minor.patch',       'v2', 'HTTP/1.1', 'keep-alive', 11, 3, 0.6, 0.9, 13, 18, 1, 1,    0, 'rover',  'Leica',             1, 1)
ON DUPLICATE KEY UPDATE code = code;

-- Gán profile cho relay job. NULL = dùng profile mặc định trong settings.
ALTER TABLE relay_jobs
  ADD COLUMN device_profile_id BIGINT UNSIGNED NULL AFTER ua_prefix,
  ADD COLUMN ua_mode ENUM('profile','literal') NOT NULL DEFAULT 'profile' AFTER device_profile_id,
  ADD COLUMN motion_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER ua_mode,
  ADD KEY idx_relay_jobs_device_profile (device_profile_id),
  ADD CONSTRAINT fk_relay_jobs_device_profile
    FOREIGN KEY (device_profile_id) REFERENCES device_profiles(id) ON DELETE SET NULL;

-- Station source (trạm NTRIP client) dùng profile riêng theo trạm (D19-12).
ALTER TABLE station_sources
  ADD COLUMN client_device_profile_id BIGINT UNSIGNED NULL AFTER client_nmea_interval_sec,
  ADD COLUMN client_ua_prefix VARCHAR(100) NOT NULL DEFAULT '' AFTER client_device_profile_id,
  ADD KEY idx_station_sources_device_profile (client_device_profile_id),
  ADD CONSTRAINT fk_station_sources_device_profile
    FOREIGN KEY (client_device_profile_id) REFERENCES device_profiles(id) ON DELETE SET NULL;

-- Cấu hình toàn cục (D19-11): probe dùng một profile cố định, không xoay.
INSERT INTO settings (setting_key, setting_value) VALUES
  ('device_profile.default', JSON_OBJECT('code', 'gnss_internet_radio')),
  ('device_profile.probe', JSON_OBJECT('code', 'gnss_internet_radio')),
  ('device_profile.motion_allowlist', JSON_OBJECT('codes', JSON_ARRAY('leica_gs18', 'trimble_da2')))
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO permissions (code, module, action, description) VALUES
  ('device_profiles.view', 'device_profiles', 'view', 'Xem device profile ngụy trang User-Agent'),
  ('device_profiles.edit', 'device_profiles', 'edit', 'Sửa device profile ngụy trang User-Agent')
ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action), description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id,
       CASE r.code
         WHEN 'super_admin' THEN 'all'
         WHEN 'admin' THEN 'subtree'
         WHEN 'user' THEN 'own'
       END
  FROM roles r
  JOIN permissions p ON p.code = 'device_profiles.view'
 WHERE r.code IN ('super_admin', 'admin', 'user')
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
  FROM roles r
  JOIN permissions p ON p.code = 'device_profiles.edit'
 WHERE r.code = 'super_admin'
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );
