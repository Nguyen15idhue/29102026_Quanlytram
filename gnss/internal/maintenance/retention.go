package maintenance

import (
	"context"
	"fmt"
)

type spec struct {
	table   string
	where   func(days int) string
	orderBy string
}

var specs = map[string]spec{
	"relay-sessions": {
		table: "relay_sessions",
		where: func(days int) string {
			return fmt.Sprintf("end_ts IS NOT NULL AND end_ts < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days)
		},
		orderBy: "id",
	},
	"relay-events": {
		table:   "relay_events",
		where:   func(days int) string { return fmt.Sprintf("ts < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days) },
		orderBy: "id",
	},
	"relay-hourly": {
		table:   "relay_hourly",
		where:   func(days int) string { return fmt.Sprintf("hour_start_utc < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days) },
		orderBy: "hour_start_utc",
	},
	"quality-samples": {
		table:   "quality_samples",
		where:   func(days int) string { return fmt.Sprintf("ts < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days) },
		orderBy: "id",
	},
	"quality-alerts": {
		table: "quality_alerts",
		where: func(days int) string {
			return fmt.Sprintf("resolved_at IS NOT NULL AND last_seen < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days)
		},
		orderBy: "id",
	},
	"caster-connections": {
		table: "caster_connections",
		where: func(days int) string {
			return fmt.Sprintf("end_ts IS NOT NULL AND end_ts < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days)
		},
		orderBy: "id",
	},
	"station-sessions": {
		table: "station_source_sessions",
		where: func(days int) string {
			return fmt.Sprintf("end_ts IS NOT NULL AND end_ts < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days)
		},
		orderBy: "id",
	},
	"rtcm-message-stats": {
		table:   "rtcm_message_stats",
		where:   func(days int) string { return fmt.Sprintf("hour_start_utc < UTC_TIMESTAMP(3) - INTERVAL %d DAY", days) },
		orderBy: "hour_start_utc",
	},
}

func (r *Runner) prune(ctx context.Context, job Job, dryRun bool) (int64, error) {
	sp, ok := specs[job.Key]
	if !ok {
		return 0, ErrUnknownJob
	}
	if dryRun {
		var count int64
		query := fmt.Sprintf("SELECT COUNT(*) FROM `%s` WHERE %s", sp.table, sp.where(job.RetentionDays))
		if err := r.db.QueryRowContext(ctx, query).Scan(&count); err != nil {
			return 0, err
		}
		return count, nil
	}
	var total int64
	for {
		query := fmt.Sprintf(
			"DELETE FROM `%s` WHERE %s ORDER BY %s LIMIT ?",
			sp.table, sp.where(job.RetentionDays), sp.orderBy,
		)
		result, err := r.db.ExecContext(ctx, query, job.BatchSize)
		if err != nil {
			return total, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return total, err
		}
		total += affected
		if affected < int64(job.BatchSize) {
			return total, nil
		}
	}
}
