-- P18-5 (YC1): bỏ prefill port 1509. Cột giữ NOT NULL; ứng dụng phải gửi
-- giá trị rõ ràng. Không đổi dữ liệu cũ.
ALTER TABLE stations
  MODIFY COLUMN port INT NOT NULL;
ALTER TABLE relay_jobs
  MODIFY COLUMN upstream_port INT NOT NULL,
  MODIFY COLUMN downstream_port INT NOT NULL;
