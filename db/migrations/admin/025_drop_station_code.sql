ALTER TABLE stations
  DROP INDEX uq_stations_code,
  DROP COLUMN code;
