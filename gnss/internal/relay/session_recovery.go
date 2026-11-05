package relay

import (
	"context"
)

// CloseStaleSessions đóng các session còn end_ts NULL từ lần chạy trước.
// Chỉ gọi lúc startup, trước khi relay manager bắt đầu ghi session mới.
func CloseStaleSessions(ctx context.Context, db execer) (int64, error) {
	result, err := db.ExecContext(ctx, `
		UPDATE relay_sessions
		   SET end_ts = UTC_TIMESTAMP(3),
		       duration_sec = GREATEST(0, TIMESTAMPDIFF(SECOND, start_ts, UTC_TIMESTAMP(3))),
		       result = 'error',
		       close_reason = 'service_restart',
		       message = CASE
		           WHEN message = '' THEN 'stale session recovered on startup'
		           ELSE message
		       END
		 WHERE end_ts IS NULL`)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return affected, nil
}
