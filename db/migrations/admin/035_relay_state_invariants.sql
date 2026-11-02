-- Bất biến trạng thái relay: khóa hoặc đã xóa thì không được bật.
-- Backfill dữ liệu cũ trước khi thêm ràng buộc.

UPDATE relay_jobs SET enabled = 0 WHERE locked = 1 AND enabled = 1;
UPDATE relay_jobs SET enabled = 0 WHERE deleted_at IS NOT NULL AND enabled = 1;

ALTER TABLE relay_jobs
  ADD CONSTRAINT chk_relay_locked_disabled CHECK (locked = 0 OR enabled = 0),
  ADD CONSTRAINT chk_relay_deleted_disabled CHECK (deleted_at IS NULL OR enabled = 0);
