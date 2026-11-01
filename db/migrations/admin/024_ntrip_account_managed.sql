ALTER TABLE ntrip_accounts
  ADD COLUMN managed_by_station_id BIGINT UNSIGNED NULL AFTER owner_web_user_id,
  ADD UNIQUE KEY uq_ntrip_accounts_managed_station (managed_by_station_id),
  ADD CONSTRAINT fk_ntrip_accounts_managed_station
    FOREIGN KEY (managed_by_station_id) REFERENCES stations(id) ON DELETE CASCADE;
