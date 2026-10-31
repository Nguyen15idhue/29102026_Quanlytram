ALTER TABLE station_sources
  ADD COLUMN caster_listener_id BIGINT UNSIGNED NULL AFTER caster_requires_auth,
  ADD COLUMN client_gga_lat DECIMAL(10,7) NULL AFTER client_nmea_interval_sec,
  ADD COLUMN client_gga_lon DECIMAL(10,7) NULL AFTER client_gga_lat,
  ADD KEY idx_station_sources_listener (caster_listener_id),
  ADD CONSTRAINT fk_station_sources_listener
    FOREIGN KEY (caster_listener_id) REFERENCES caster_listeners(id) ON DELETE SET NULL;
