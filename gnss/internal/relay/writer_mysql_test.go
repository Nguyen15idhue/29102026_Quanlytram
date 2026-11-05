package relay

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

func TestBufferedWriterSessionLifecycleMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not set")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open mysql: %v", err)
	}
	defer db.Close()
	ctx := context.Background()
	const jobID = int64(999997)
	cleanup := func() {
		_, _ = db.ExecContext(ctx, "DELETE FROM relay_sessions WHERE relay_job_id = ?", jobID)
		_, _ = db.ExecContext(ctx, "DELETE FROM relay_hourly WHERE relay_job_id = ?", jobID)
	}
	cleanup()
	defer cleanup()

	writer := NewBufferedWriter(db, 64, 10, 10*time.Millisecond)
	runCtx, cancel := context.WithCancel(ctx)
	go writer.Run(runCtx)
	defer func() {
		cancel()
		<-writer.Done()
	}()

	start := time.Date(2026, 11, 4, 21, 33, 53, 123456789, time.UTC)
	end := time.Date(2026, 11, 4, 23, 44, 6, 987654321, time.UTC)
	writer.SessionStart(jobID, start.Truncate(time.Millisecond))
	waitFor(t, 3*time.Second, func() bool {
		var endTS sql.NullTime
		err := db.QueryRowContext(ctx,
			"SELECT end_ts FROM relay_sessions WHERE relay_job_id = ? AND start_ts = ?",
			jobID, start.Truncate(time.Millisecond)).Scan(&endTS)
		return err == nil && !endTS.Valid
	})

	writer.Session(jobID, start, end, "error", "network", "broken pipe")
	waitFor(t, 3*time.Second, func() bool {
		var gotEnd time.Time
		var duration int
		var result, reason string
		err := db.QueryRowContext(ctx,
			`SELECT end_ts, duration_sec, result, close_reason
			   FROM relay_sessions WHERE relay_job_id = ? AND start_ts = ?`,
			jobID, start.Truncate(time.Millisecond)).Scan(&gotEnd, &duration, &result, &reason)
		return err == nil && !gotEnd.IsZero() && duration == 7813 && result == "error" && reason == "network"
	})
	var rows int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM relay_sessions WHERE relay_job_id = ?", jobID).Scan(&rows); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if rows != 1 {
		t.Fatalf("sessions = %d, want 1 (SessionStart phải được update, không tạo row thứ hai)", rows)
	}

	for _, bucket := range splitSessionHours(start, end) {
		writer.Hourly(jobID, bucket.hour, bucket.seconds, 0, 0, 0, 0, 0, 0, 0)
	}
	waitFor(t, 3*time.Second, func() bool {
		var total int
		err := db.QueryRowContext(ctx,
			"SELECT COALESCE(SUM(online_sec),0) FROM relay_hourly WHERE relay_job_id = ?",
			jobID).Scan(&total)
		return err == nil && total == 7813
	})
}
