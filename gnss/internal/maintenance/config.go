package maintenance

import (
	"context"
	"database/sql"
	"fmt"
)

const MinAdminSchemaVersion = 34

type Job struct {
	Key           string
	Label         string
	Scope         string
	Table         string
	RetentionDays int
	BatchSize     int
	IntervalSec   int
	Enabled       bool
}

type Config struct {
	Jobs             []Job
	SchedulerEnabled bool
	RunHourLocal     int
	RunMinuteLocal   int
	Timezone         string
}

func validateJob(job Job) error {
	if job.Key == "" {
		return fmt.Errorf("maintenance job key is empty")
	}
	if job.Scope != "runtime" && job.Scope != "admin" {
		return fmt.Errorf("maintenance job %s has invalid scope %q", job.Key, job.Scope)
	}
	if job.RetentionDays < 1 || job.RetentionDays > 3650 {
		return fmt.Errorf("maintenance job %s retention_days out of range", job.Key)
	}
	if job.BatchSize < 100 || job.BatchSize > 50000 {
		return fmt.Errorf("maintenance job %s batch_size out of range", job.Key)
	}
	if job.IntervalSec < 300 || job.IntervalSec > 86400 {
		return fmt.Errorf("maintenance job %s interval_sec out of range", job.Key)
	}
	return nil
}

func LoadConfig(ctx context.Context, db *sql.DB) (Config, error) {
	cfg := Config{
		SchedulerEnabled: true,
		RunHourLocal:     3,
		RunMinuteLocal:   0,
		Timezone:         "Asia/Ho_Chi_Minh",
	}
	row := db.QueryRowContext(ctx,
		`SELECT scheduler_enabled, run_hour_local, run_minute_local, timezone
		   FROM maintenance_settings WHERE id = 1 LIMIT 1`)
	var enabled int
	if err := row.Scan(&enabled, &cfg.RunHourLocal, &cfg.RunMinuteLocal, &cfg.Timezone); err != nil {
		if err != sql.ErrNoRows {
			return Config{}, err
		}
	} else {
		cfg.SchedulerEnabled = enabled == 1
	}
	if cfg.RunHourLocal < 0 || cfg.RunHourLocal > 23 {
		return Config{}, fmt.Errorf("maintenance run_hour_local out of range")
	}
	if cfg.RunMinuteLocal < 0 || cfg.RunMinuteLocal > 59 {
		return Config{}, fmt.Errorf("maintenance run_minute_local out of range")
	}

	rows, err := db.QueryContext(ctx,
		`SELECT job_key, label, scope, table_name, retention_days, batch_size,
		        interval_sec, enabled
		   FROM maintenance_jobs
		  ORDER BY FIELD(scope, 'runtime', 'admin'), job_key`)
	if err != nil {
		return Config{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var job Job
		var enabledFlag int
		if err := rows.Scan(
			&job.Key, &job.Label, &job.Scope, &job.Table, &job.RetentionDays,
			&job.BatchSize, &job.IntervalSec, &enabledFlag,
		); err != nil {
			return Config{}, err
		}
		job.Enabled = enabledFlag == 1
		if err := validateJob(job); err != nil {
			return Config{}, err
		}
		cfg.Jobs = append(cfg.Jobs, job)
	}
	if err := rows.Err(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}
