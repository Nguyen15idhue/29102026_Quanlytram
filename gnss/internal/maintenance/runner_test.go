package maintenance

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func testRunner() *Runner {
	return &Runner{
		cfg: Config{
			SchedulerEnabled: true,
			RunHourLocal:     3,
			RunMinuteLocal:   0,
			Timezone:         "Asia/Ho_Chi_Minh",
			Jobs: []Job{
				{Key: "relay-sessions", Label: "Phiên relay", Scope: "runtime", Table: "relay_sessions", RetentionDays: 90, BatchSize: 1000, IntervalSec: 3600, Enabled: true},
				{Key: "audit-logs", Label: "Nhật ký audit", Scope: "admin", Table: "audit_logs", RetentionDays: 365, BatchSize: 1000, IntervalSec: 86400, Enabled: true},
			},
		},
		lastRun:   make(map[string]time.Time),
		lastRows:  make(map[string]int64),
		lastError: make(map[string]string),
		running:   make(map[string]bool),
	}
}

func TestValidateJobRanges(t *testing.T) {
	valid := Job{Key: "relay-sessions", Scope: "runtime", RetentionDays: 90, BatchSize: 1000, IntervalSec: 3600}
	if err := validateJob(valid); err != nil {
		t.Fatalf("valid job rejected: %v", err)
	}
	invalid := []Job{
		{Key: "", Scope: "runtime", RetentionDays: 90, BatchSize: 1000, IntervalSec: 3600},
		{Key: "x", Scope: "other", RetentionDays: 90, BatchSize: 1000, IntervalSec: 3600},
		{Key: "x", Scope: "runtime", RetentionDays: 0, BatchSize: 1000, IntervalSec: 3600},
		{Key: "x", Scope: "runtime", RetentionDays: 90, BatchSize: 10, IntervalSec: 3600},
		{Key: "x", Scope: "runtime", RetentionDays: 90, BatchSize: 1000, IntervalSec: 10},
	}
	for _, job := range invalid {
		if err := validateJob(job); err == nil {
			t.Fatalf("invalid job accepted: %+v", job)
		}
	}
}

func TestPruneGuards(t *testing.T) {
	runner := testRunner()
	if _, err := runner.Prune(context.Background(), "missing", true); !errors.Is(err, ErrUnknownJob) {
		t.Fatalf("unknown job err = %v", err)
	}
	if _, err := runner.Prune(context.Background(), "audit-logs", true); !errors.Is(err, ErrNotRuntime) {
		t.Fatalf("admin job err = %v", err)
	}
	runner.running["relay-sessions"] = true
	if _, err := runner.Prune(context.Background(), "relay-sessions", true); !errors.Is(err, ErrRunning) {
		t.Fatalf("running job err = %v", err)
	}
}

func TestSpecsKeepOpenRows(t *testing.T) {
	cases := map[string]string{
		"relay-sessions":     "end_ts IS NOT NULL",
		"caster-connections": "end_ts IS NOT NULL",
		"station-sessions":   "end_ts IS NOT NULL",
		"quality-alerts":     "resolved_at IS NOT NULL",
	}
	for key, guard := range cases {
		spec, ok := specs[key]
		if !ok {
			t.Fatalf("missing spec %s", key)
		}
		if !strings.Contains(spec.where(30), guard) {
			t.Fatalf("spec %s does not guard %q: %s", key, guard, spec.where(30))
		}
	}
}

func TestStatusIncludesJobsAndRuntimeState(t *testing.T) {
	runner := testRunner()
	runner.lastRun["relay-sessions"] = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	runner.lastRows["relay-sessions"] = 12
	runner.running["audit-logs"] = true
	status := runner.Status()
	if len(status.Jobs) != 2 {
		t.Fatalf("jobs = %d, want 2", len(status.Jobs))
	}
	if status.Config.Timezone != "Asia/Ho_Chi_Minh" {
		t.Fatalf("timezone = %q", status.Config.Timezone)
	}
	for _, job := range status.Jobs {
		if job.Key == "relay-sessions" {
			if job.LastRows != 12 || job.LastRunAt == "" {
				t.Fatalf("relay-sessions status = %+v", job)
			}
		}
		if job.Key == "audit-logs" && !job.Running {
			t.Fatalf("audit-logs should be running")
		}
	}
}
