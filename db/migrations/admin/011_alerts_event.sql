ALTER TABLE alerts
  ADD COLUMN event_type VARCHAR(64) NOT NULL DEFAULT 'system',
  ADD COLUMN level ENUM('critical','major','minor','info') NOT NULL DEFAULT 'minor',
  ADD COLUMN unread TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN read_at DATETIME(3) NULL;

UPDATE alerts
   SET level = CASE severity
     WHEN 'critical' THEN 'critical'
     WHEN 'warning' THEN 'major'
     ELSE 'info'
   END
 WHERE level = 'minor';
