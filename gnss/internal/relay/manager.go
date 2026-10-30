package relay

import (
	"context"
	"log"
	"sort"
	"sync"
	"time"

	"cors/gnss/internal/ntrip"
)

type TestEndpoint struct {
	OK     bool   `json:"ok"`
	Proto  string `json:"proto,omitempty"`
	Code   int    `json:"code,omitempty"`
	Status string `json:"status,omitempty"`
}

type TestResult struct {
	OK         bool          `json:"ok"`
	Stage      string        `json:"stage,omitempty"`
	Upstream   *TestEndpoint `json:"upstream,omitempty"`
	Downstream *TestEndpoint `json:"downstream,omitempty"`
	LatencyMs  int64         `json:"latencyMs"`
	Error      string        `json:"error,omitempty"`
}

type Manager struct {
	store  ConfigStore
	writer RuntimeWriter
	opts   Options

	mu       sync.Mutex
	rootCtx  context.Context
	jobs     map[int64]*Job
	configs  map[int64]*JobConfig
	stopping bool
}

func NewManager(store ConfigStore, writer RuntimeWriter, opts Options) *Manager {
	return &Manager{
		store:   store,
		writer:  writer,
		opts:    opts.withDefaults(),
		jobs:    make(map[int64]*Job),
		configs: make(map[int64]*JobConfig),
	}
}

func (m *Manager) Run(ctx context.Context) {
	m.mu.Lock()
	m.rootCtx = ctx
	m.mu.Unlock()

	if err := m.Reconcile(ctx, nil); err != nil {
		log.Printf("[relay] initial reconcile failed: %v", err)
	}

	poll := time.NewTicker(m.opts.PollInterval)
	defer poll.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-poll.C:
			if err := m.Reconcile(ctx, nil); err != nil {
				log.Printf("[relay] reconcile failed: %v", err)
			}
		}
	}
}

func (m *Manager) Reconcile(ctx context.Context, ids []int64) error {
	m.mu.Lock()
	if m.stopping {
		m.mu.Unlock()
		return nil
	}
	rootCtx := m.rootCtx
	m.mu.Unlock()

	if rootCtx == nil {
		rootCtx = context.Background()
	}

	configs, err := m.store.LoadAll(ctx)
	if err != nil {
		return err
	}

	byID := make(map[int64]*JobConfig, len(configs))
	for _, cfg := range configs {
		byID[cfg.ID] = cfg
	}

	edges := make([]Edge, 0, len(configs))
	pairs := make(map[string][]int64)
	for _, cfg := range configs {
		if !cfg.Enabled {
			continue
		}
		edges = append(edges, Edge{
			JobID:         cfg.ID,
			UpstreamKey:   cfg.Upstream.Key,
			DownstreamKey: cfg.Downstream.Key,
		})
		pair := cfg.Upstream.Key + "\x00" + cfg.Downstream.Key
		pairs[pair] = append(pairs[pair], cfg.ID)
	}
	duplicates := make(map[int64]bool)
	for _, jobIDs := range pairs {
		if len(jobIDs) > 1 {
			for _, id := range jobIDs {
				duplicates[id] = true
			}
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopping {
		return nil
	}
	previousConfigs := m.configs
	m.configs = byID

	targets := make(map[int64]bool)
	if len(ids) == 0 {
		for id := range byID {
			targets[id] = true
		}
		for id := range m.jobs {
			targets[id] = true
		}
	} else {
		for _, id := range ids {
			targets[id] = true
		}
	}

	for id := range targets {
		cfg, exists := byID[id]
		if !exists {
			m.stopJob(id, "deleted")
			revision := int64(0)
			if previousConfigs[id] != nil {
				revision = previousConfigs[id].DesiredRevision
			}
			m.writer.State(id, "stopped", revision, "deleted")
			continue
		}

		job := m.jobs[id]
		if job != nil {
			select {
			case <-job.done:
				delete(m.jobs, id)
				job = nil
			default:
			}
		}

		if !cfg.Enabled {
			if job != nil {
				job.stop("disabled")
			}
			m.writer.State(id, "disabled", cfg.DesiredRevision, "")
			continue
		}

		if duplicates[id] || JobHasCycle(Edge{
			JobID:         cfg.ID,
			UpstreamKey:   cfg.Upstream.Key,
			DownstreamKey: cfg.Downstream.Key,
		}, edges) {
			if job != nil {
				job.stop("config_changed")
			}
			m.writer.State(id, "error", cfg.DesiredRevision, "loop or duplicate endpoint detected")
			continue
		}

		if job != nil && job.cfg.DesiredRevision == cfg.DesiredRevision {
			continue
		}
		if job != nil {
			job.stop("config_changed")
			select {
			case <-job.done:
			case <-time.After(2 * time.Second):
			}
		}

		newJobInstance := newJob(cfg, m.opts, m.writer)
		m.jobs[id] = newJobInstance
		newJobInstance.start(rootCtx)
	}

	return nil
}

func (m *Manager) stopJob(id int64, reason string) {
	if job := m.jobs[id]; job != nil {
		job.stop(reason)
		delete(m.jobs, id)
	}
}

func (m *Manager) Test(ctx context.Context, id int64) TestResult {
	start := time.Now()
	result := TestResult{}
	cfg, err := m.store.LoadJob(ctx, id)
	if err != nil {
		result.Error = err.Error()
		result.Stage = "config"
		return result
	}
	if cfg == nil {
		result.Error = "relay job not found"
		result.Stage = "config"
		return result
	}

	userAgent := cfg.UAPrefix
	if userAgent == "" {
		userAgent = "CORS-MVP"
	}
	userAgent += "-relay-test"

	upstream, err := ntrip.Get(ctx, toNtripEndpoint(cfg.Upstream, userAgent), m.opts.DialTimeout)
	if err != nil {
		result.Error = err.Error()
		result.Stage = "upstream"
		result.LatencyMs = time.Since(start).Milliseconds()
		return result
	}
	result.Upstream = &TestEndpoint{OK: true, Proto: upstream.Proto, Code: upstream.Code, Status: upstream.Status}
	upstream.Close()

	downstream, err := ntrip.Source(ctx, toNtripEndpoint(cfg.Downstream, userAgent), cfg.DownstreamMode, m.opts.DialTimeout)
	if err != nil {
		result.Error = err.Error()
		result.Stage = "downstream"
		result.LatencyMs = time.Since(start).Milliseconds()
		return result
	}
	result.Downstream = &TestEndpoint{OK: true, Proto: downstream.Proto, Code: downstream.Code, Status: downstream.Status}
	downstream.Close()

	result.OK = true
	result.LatencyMs = time.Since(start).Milliseconds()
	return result
}

func (m *Manager) Snapshot() []MetricsSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	snapshots := make([]MetricsSnapshot, 0, len(m.jobs))
	for id, job := range m.jobs {
		snapshots = append(snapshots, job.metrics.Snapshot(id))
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].JobID < snapshots[j].JobID })
	return snapshots
}

func (m *Manager) Shutdown(ctx context.Context) {
	m.mu.Lock()
	m.stopping = true
	jobs := make([]*Job, 0, len(m.jobs))
	for _, job := range m.jobs {
		jobs = append(jobs, job)
	}
	m.mu.Unlock()

	for _, job := range jobs {
		job.stop("service_restart")
	}
	for _, job := range jobs {
		select {
		case <-job.done:
		case <-ctx.Done():
			return
		}
	}
}
