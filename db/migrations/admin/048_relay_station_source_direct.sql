-- "Chọn trạm" phía nguồn: relay đọc trực tiếp luồng của trạm (in-process tap),
-- không đi qua mountpoint/caster. Các job cũ còn lưu endpoint giả 127.0.0.1
-- (port listener + mountpoint) trong upstream_*; chuẩn hoá về rỗng để UI và
-- cấu hình không còn hiển thị/ghi nhầm nguồn là caster.
--
-- upstream_mountpoint_id phải NULL với nguồn chọn trạm: Go chọn tap theo
-- stationID (station_source_tap), không theo mountpoint.
UPDATE relay_jobs
   SET upstream_host = '',
       upstream_port = 0,
       upstream_mount = '',
       upstream_proxy = '',
       upstream_ssl = 0,
       upstream_mountpoint_id = NULL
 WHERE upstream_station_id IS NOT NULL;
