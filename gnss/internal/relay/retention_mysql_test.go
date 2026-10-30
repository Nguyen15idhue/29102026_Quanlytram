package relay

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/go-sql-driver/mysql"
)

func TestPruneOnceMySQL(t *testing.T) {
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
	const jobID = int64(999999)

	cleanup := func() {
		_, _ = db.ExecContext(ctx, "DELETE FROM relay_sessions WHERE relay_job_id = ?", jobID)
		_, _ = db.ExecContext(ctx, "DELETE FROM relay_events WHERE relay_job_id = ?", jobID)
		_, _ = db.ExecContext(ctx, "DELETE FROM relay_hourly WHERE relay_job_id = ?", jobID)
	}
	cleanup()
	defer cleanup()

	if _, err := db.ExecContext(ctx,
		`INSERT INTO relay_sessions
		   (relay_job_id, start_ts, end_ts, duration_sec, result, close_reason, message)
		 VALUES
		   (?, UTC_TIMESTAMP(3) - INTERVAL 2 DAY, UTC_TIMESTAMP(3) - INTERVAL 2 DAY, 10, 'ok', 'network', 'old'),
		   (?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 10, 'ok', 'network', 'new'),
		   (?, UTC_TIMESTAMP(3) - INTERVAL 2 DAY, NULL, 10, 'ok', 'network', 'open')`,
		jobID, jobID, jobID); err != nil {
		t.Fatalf("insert sessions: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO relay_events (relay_job_id, ts, type, message)
		 VALUES (?, UTC_TIMESTAMP(3) - INTERVAL 2 DAY, 'old', 'old'),
		        (?, UTC_TIMESTAMP(3), 'new', 'new')`,
		jobID, jobID); err != nil {
		t.Fatalf("insert events: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO relay_hourly (relay_job_id, hour_start_utc, online_sec)
		 VALUES (?, UTC_TIMESTAMP(3) - INTERVAL 2 DAY, 10),
		        (?, UTC_TIMESTAMP(3), 10)`,
		jobID, jobID); err != nil {
		t.Fatalf("insert hourly: %v", err)
	}

	if err := PruneOnce(ctx, db, RetentionOptions{SessionDays: 1, EventDays: 1, HourlyDays: 1, Batch: 10}); err != nil {
		t.Fatalf("PruneOnce: %v", err)
	}

	var sessions, openSessions, events, hourly int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM relay_sessions WHERE relay_job_id = ? AND message IN ('old','new')",
		jobID).Scan(&sessions); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM relay_sessions WHERE relay_job_id = ? AND message = 'open'",
		jobID).Scan(&openSessions); err != nil {
		t.Fatalf("count open sessions: %v", err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM relay_events WHERE relay_job_id = ?", jobID).Scan(&events); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM relay_hourly WHERE relay_job_id = ?", jobID).Scan(&hourly); err != nil {
		t.Fatalf("count hourly: %v", err)
	}

	if sessions != 1 {
		t.Fatalf("sessions = %d, want 1 new", sessions)
	}
	if openSessions != 1 {
		t.Fatalf("open sessions = %d, want 1", openSessions)
	}
	if events != 1 {
		t.Fatalf("events = %d, want 1 new", events)
	}
	if hourly != 1 {
		t.Fatalf("hourly = %d, want 1 new", hourly)
	}
}
