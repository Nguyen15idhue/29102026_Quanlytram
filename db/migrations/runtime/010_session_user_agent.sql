-- P19-6 (Kế hoạch 19): lưu User-Agent thật đã gửi cho từng phiên để đối chiếu
-- khi caster trả 401/403 (D19-21). Chỉ ghi một lần khi mở phiên; không sửa
-- byte RTCM và không tham gia đường truyền.

ALTER TABLE relay_sessions
  ADD COLUMN user_agent VARCHAR(255) NOT NULL DEFAULT '' AFTER message;

ALTER TABLE station_source_sessions
  ADD COLUMN user_agent VARCHAR(255) NOT NULL DEFAULT '' AFTER message;

INSERT INTO runtime_meta (k, v) VALUES ('schema_version', '10')
ON DUPLICATE KEY UPDATE v = VALUES(v);
