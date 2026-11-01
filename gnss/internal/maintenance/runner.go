package maintenance

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"sync"
	"time"
)

var (
	ErrUnknownJob = errors.New("unknown maintenance job")
	ErrNotRuntime = errors.New("maintenance job is not runtime")
	ErrRunning    = errors.New("maintenance job is already running")
)

type ConfigStatus struct {
	SchedulerEnabled bool   `json:"schedulerEnabled"`
	RunHourLocal     int    `json:"hourLocal"`
	RunMinuteLocal   int    `json:"minuteLocal"`
	Timezone         string `json:"timezone"`
}

type JobStatus struct {
	Key           string `json:"key"`
	Label         string `json:"label"`
	Scope         string `json:"scope"`
	Table         string `json:"table"`
	RetentionDays int    `json:"retentionDays"`
	BatchSize     int    `json:"batchSize"`
	IntervalSec   int    `json:"intervalSec"`
	Enabled       bool   `json:"enabled"`
	Running       bool   `json:"running"`
	LastRunAt     string `json:"lastRunAt,omitempty"`
	LastRows      int64  `json:"lastRows"`
	LastError     string `json:"lastError,omitempty"`
}

type Status struct {
	Time   string       `json:"time"`
	Config ConfigStatus `json:"config"`
	Jobs   []JobStatus  `json:"jobs"`
}

type Runner struct {
	admin *sql.DB
	db    *sql.DB

	mu        sync.RWMutex
	cfg       Config
	lastRun   map[string]time.Time
	lastRows  map[string]int64
	lastError map[string]string
	running   map[string]bool
}

func NewRunner(ctx context.Context, adminDB, runtimeDB *sql.DB) (*Runner, error) {
	cfg, err := LoadConfig(ctx, adminDB)
	if err != nil {
		return nil, err
	}
	return &Runner{
		admin:     adminDB,
		db:        runtimeDB,
		cfg:       cfg,
		lastRun:   make(map[string]time.Time),
		lastRows:  make(map[string]int64),
		lastError: make(map[string]string),
		running:   make(map[string]bool),
	}, nil
}

func (r *Runner) Reload(ctx context.Context) error {
	cfg, err := LoadConfig(ctx, r.admin)
	if err != nil {
		return err
	}
	r.mu.Lock()
	r.cfg = cfg
	r.mu.Unlock()
	return nil
}

func (r *Runner) config() Config {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cfg
}

func (r *Runner) job(key string) (Job, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, job := range r.cfg.Jobs {
		if job.Key == key {
			return job, true
		}
	}
	return Job{}, false
}

func (r *Runner) Status() Status {
	r.mu.RLock()
	defer r.mu.RUnlock()
	status := Status{
		Time: time.Now().UTC().Format(time.RFC3339),
		Config: ConfigStatus{
			SchedulerEnabled: r.cfg.SchedulerEnabled,
			RunHourLocal:     r.cfg.RunHourLocal,
			RunMinuteLocal:   r.cfg.RunMinuteLocal,
			Timezone:         r.cfg.Timezone,
		},
		Jobs: make([]JobStatus, 0, len(r.cfg.Jobs)),
	}
	for _, job := range r.cfg.Jobs {
		item := JobStatus{
			Key:           job.Key,
			Label:         job.Label,
			Scope:         job.Scope,
			Table:         job.Table,
			RetentionDays: job.RetentionDays,
			BatchSize:     job.BatchSize,
			IntervalSec:   job.IntervalSec,
			Enabled:       job.Enabled,
			Running:       r.running[job.Key],
			LastRows:      r.lastRows[job.Key],
			LastError:     r.lastError[job.Key],
		}
		if last, ok := r.lastRun[job.Key]; ok && !last.IsZero() {
			item.LastRunAt = last.Format(time.RFC3339)
		}
		status.Jobs = append(status.Jobs, item)
	}
	return status
}

func (r *Runner) Prune(ctx context.Context, jobKey string, dryRun bool) (int64, error) {
	job, ok := r.job(jobKey)
	if !ok {
		return 0, ErrUnknownJob
	}
	if job.Scope != "runtime" {
		return 0, ErrNotRuntime
	}
	r.mu.Lock()
	if r.running[jobKey] {
		r.mu.Unlock()
		return 0, ErrRunning
	}
	r.running[jobKey] = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.running, jobKey)
		r.mu.Unlock()
	}()

	rows, err := r.prune(ctx, job, dryRun)
	r.mu.Lock()
	r.lastRows[jobKey] = rows
	if err != nil {
		r.lastError[jobKey] = err.Error()
	} else {
		r.lastError[jobKey] = ""
		if !dryRun {
			r.lastRun[jobKey] = time.Now().UTC()
		}
	}
	r.mu.Unlock()
	return rows, err
}

func (r *Runner) Run(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	r.runDue(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.Reload(ctx); err != nil {
				log.Printf("[maintenance] reload config failed: %v", err)
			}
			r.runDue(ctx)
		}
	}
}

func (r *Runner) runDue(ctx context.Context) {
	cfg := r.config()
	now := time.Now().UTC()
	for _, job := range cfg.Jobs {
		if job.Scope != "runtime" || !job.Enabled {
			continue
		}
		r.mu.RLock()
		last := r.lastRun[job.Key]
		running := r.running[job.Key]
		r.mu.RUnlock()
		if running {
			continue
		}
		if !last.IsZero() && now.Sub(last) < time.Duration(job.IntervalSec)*time.Second {
			continue
		}
		job := job
		go func() {
			pruneCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
			defer cancel()
			if _, err := r.Prune(pruneCtx, job.Key, false); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("[maintenance] prune %s failed: %v", job.Key, err)
			}
		}()
	}
}
