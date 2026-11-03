-- Chọn trạm nguồn/đích cho relay: lưu lại lựa chọn để form sửa mở đúng mode.
-- Không đặt FK sang stations/mountpoints: relay là thực thể riêng (AGENTS §9).
ALTER TABLE relay_jobs
  ADD COLUMN upstream_station_id BIGINT UNSIGNED NULL,
  ADD COLUMN downstream_station_id BIGINT UNSIGNED NULL,
  ADD COLUMN upstream_mountpoint_id BIGINT UNSIGNED NULL,
  ADD COLUMN downstream_mountpoint_id BIGINT UNSIGNED NULL,
  ADD KEY idx_relay_jobs_upstream_station (upstream_station_id),
  ADD KEY idx_relay_jobs_downstream_station (downstream_station_id);
