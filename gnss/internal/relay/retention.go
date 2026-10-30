package relay

import (
	"context"
	"database/sql"
	"log"
	"time"
)

type RetentionOptions struct {
	SessionDays int
	EventDays   int
	HourlyDays  int
	Batch       int
	Interval    time.Duration
}

func DefaultRetentionOptions() RetentionOptions {
	return RetentionOptions{
		SessionDays: 90,
		EventDays:   30,
		HourlyDays:  90,
		Batch:       1000,
		Interval:    time.Hour,
	}
}

func (o RetentionOptions) withDefaults() RetentionOptions {
	defaults := DefaultRetentionOptions()
	if o.SessionDays <= 0 {
		o.SessionDays = defaults.SessionDays
	}
	if o.EventDays <= 0 {
		o.EventDays = defaults.EventDays
	}
	if o.HourlyDays <= 0 {
		o.HourlyDays = defaults.HourlyDays
	}
	if o.Batch <= 0 {
		o.Batch = defaults.Batch
	}
	if o.Interval <= 0 {
		o.Interval = defaults.Interval
	}
	return o
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func RunRetention(ctx context.Context, db *sql.DB, options RetentionOptions) {
	options = options.withDefaults()
	ticker := time.NewTicker(options.Interval)
	defer ticker.Stop()

	for {
		if err := PruneOnce(ctx, db, options); err != nil && ctx.Err() == nil {
			log.Printf("[relay] retention prune failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func PruneOnce(ctx context.Context, db execer, options RetentionOptions) error {
	options = options.withDefaults()
	if _, err := pruneSessions(ctx, db, options.SessionDays, options.Batch); err != nil {
		return err
	}
	if _, err := pruneEvents(ctx, db, options.EventDays, options.Batch); err != nil {
		return err
	}
	if _, err := pruneHourly(ctx, db, options.HourlyDays, options.Batch); err != nil {
		return err
	}
	return nil
}

func pruneSessions(ctx context.Context, db execer, days, batch int) (int64, error) {
	return pruneLoop(ctx, db,
		`DELETE FROM relay_sessions
		  WHERE end_ts IS NOT NULL
		    AND end_ts < UTC_TIMESTAMP(3) - INTERVAL ? DAY
		  ORDER BY id
		  LIMIT ?`,
		days, batch)
}

func pruneEvents(ctx context.Context, db execer, days, batch int) (int64, error) {
	return pruneLoop(ctx, db,
		`DELETE FROM relay_events
		  WHERE ts < UTC_TIMESTAMP(3) - INTERVAL ? DAY
		  ORDER BY id
		  LIMIT ?`,
		days, batch)
}

func pruneHourly(ctx context.Context, db execer, days, batch int) (int64, error) {
	return pruneLoop(ctx, db,
		`DELETE FROM relay_hourly
		  WHERE hour_start_utc < UTC_TIMESTAMP(3) - INTERVAL ? DAY
		  ORDER BY hour_start_utc
		  LIMIT ?`,
		days, batch)
}

func pruneLoop(ctx context.Context, db execer, query string, days, batch int) (int64, error) {
	var total int64
	for {
		result, err := db.ExecContext(ctx, query, days, batch)
		if err != nil {
			return total, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return total, err
		}
		total += affected
		if affected < int64(batch) {
			return total, nil
		}
	}
}
