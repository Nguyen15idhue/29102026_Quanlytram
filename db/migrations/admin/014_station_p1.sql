ALTER TABLE stations
  ADD COLUMN status ENUM('active','disabled','locked') NOT NULL DEFAULT 'active',
  ADD COLUMN coordinate_type ENUM('wgs84','vn2000','itrf') NOT NULL DEFAULT 'wgs84',
  ADD COLUMN province VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN ward VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN address_detail VARCHAR(255) NOT NULL DEFAULT '',
  ADD KEY idx_stations_status (status);
