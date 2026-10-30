CREATE TABLE IF NOT EXISTS dictionaries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dict_code VARCHAR(64) NOT NULL,
  dict_key VARCHAR(120) NOT NULL,
  dict_value VARCHAR(160) NOT NULL,
  locale VARCHAR(16) NOT NULL DEFAULT 'vi',
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_dictionaries_code_key_locale (dict_code, dict_key, locale),
  KEY idx_dictionaries_code (dict_code, enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(64) NOT NULL DEFAULT 'station',
  field_key VARCHAR(64) NOT NULL,
  label VARCHAR(160) NOT NULL,
  field_type ENUM('text','number','select','date','boolean') NOT NULL DEFAULT 'text',
  options_json JSON NULL,
  required TINYINT(1) NOT NULL DEFAULT 0,
  searchable TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_custom_field_entity_key (entity_type, field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO dictionaries (dict_code, dict_key, dict_value, locale, sort_order) VALUES
  ('receiver_type', 'chc', 'CHC', 'vi', 10),
  ('receiver_type', 'trimble', 'Trimble', 'vi', 20),
  ('receiver_type', 'leica', 'Leica', 'vi', 30),
  ('receiver_type', 'septentrio', 'Septentrio', 'vi', 40),
  ('receiver_type', 'ublox', 'u-blox', 'vi', 50),
  ('receiver_type', 'south', 'South', 'vi', 60),
  ('receiver_type', 'comnav', 'ComNav', 'vi', 70),
  ('antenna_type', 'chc220gr', 'CHCC220GR', 'vi', 10),
  ('antenna_type', 'advnull', 'ADVNULLANTENNA', 'vi', 20),
  ('antenna_type', 'leiar', 'LEIAR', 'vi', 30),
  ('antenna_type', 'trimble', 'TRM', 'vi', 40),
  ('antenna_type', 'sept', 'SEP', 'vi', 50)
ON DUPLICATE KEY UPDATE dict_value = VALUES(dict_value), sort_order = VALUES(sort_order), enabled = 1;
