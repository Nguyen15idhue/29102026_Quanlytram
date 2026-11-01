package probe

import (
	"context"
	"errors"
	"io"
	"log"
	"sync"
	"time"

	"cors/gnss/internal/nmea"
	"cors/gnss/internal/ntrip"
	"cors/gnss/internal/quality"
)

type Options struct {
	PollInterval time.Duration
	DialTimeout  time.Duration
	ReadBuffer   int
	NMEAInterval time.Duration
	RetryMin     time.Duration
	RetryMax     time.Duration
	Quality      *quality.Analyzer
}

func DefaultOptions() Options {
	return Options{
		PollInterval: 10 * time.Second,
		DialTimeout:  15 * time.Second,
		ReadBuffer:   32 * 1024,
		NMEAInterval: 10 * time.Second,
		RetryMin:     time.Second,
		RetryMax:     30 * time.Second,
	}
}

func (o Options) withDefaults() Options {
	defaults := DefaultOptions()
	if o.PollInterval <= 0 {
		o.PollInterval = defaults.PollInterval
	}
	if o.DialTimeout <= 0 {
		o.DialTimeout = defaults.DialTimeout
	}
	if o.ReadBuffer <= 0 {
		o.ReadBuffer = defaults.ReadBuffer
	}
	if o.NMEAInterval <= 0 {
		o.NMEAInterval = defaults.NMEAInterval
	}
	if o.RetryMin <= 0 {
		o.RetryMin = defaults.RetryMin
	}
	if o.RetryMax <= 0 {
		o.RetryMax = defaults.RetryMax
	}
	if o.RetryMax < o.RetryMin {
		o.RetryMax = o.RetryMin
	}
	return o
}

type Manager struct {
	store Store
	opts  Options

	mu       sync.Mutex
	rootCtx  context.Context
	sessions map[int64]context.CancelFunc
	wg       sync.WaitGroup
}

func NewManager(store Store, opts Options) *Manager {
	return &Manager{
		store:    store,
		opts:     opts.withDefaults(),
		sessions: make(map[int64]context.CancelFunc),
	}
}

func (m *Manager) Reconcile(ctx context.Context) {
	m.reconcile(ctx)
}

func (m *Manager) Run(ctx context.Context) {
	m.mu.Lock()
	m.rootCtx = ctx
	m.mu.Unlock()

	m.reconcile(ctx)
	ticker := time.NewTicker(m.opts.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.reconcile(ctx)
		}
	}
}

func (m *Manager) Shutdown(ctx context.Context) {
	m.mu.Lock()
	for id, cancel := range m.sessions {
		cancel()
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	done := make(chan struct{})
	go func() {
		m.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

func (m *Manager) reconcile(ctx context.Context) {
	loadCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	configs, err := m.store.LoadAll(loadCtx)
	if err != nil {
		log.Printf("[probe] load config failed: %v", err)
		return
	}

	desired := make(map[int64]*Config, len(configs))
	for _, cfg := range configs {
		if cfg.Mount == "" || cfg.Host == "" || cfg.Port <= 0 {
			log.Printf("[probe] skip probe %d: missing host/port/mount", cfg.ID)
			continue
		}
		desired[cfg.ID] = cfg
	}

	m.mu.Lock()
	for id, cancel := range m.sessions {
		if desired[id] == nil {
			cancel()
			delete(m.sessions, id)
		}
	}
	for id, cfg := range desired {
		if m.sessions[id] != nil {
			continue
		}
		probeCtx, cancel := context.WithCancel(m.rootCtx)
		m.sessions[id] = cancel
		m.wg.Add(1)
		go func(cfg *Config) {
			defer m.wg.Done()
			m.runSession(probeCtx, cfg)
		}(cfg)
	}
	m.mu.Unlock()
}

func (m *Manager) runSession(ctx context.Context, cfg *Config) {
	backoff := m.opts.RetryMin
	for {
		if ctx.Err() != nil {
			return
		}
		err := m.connectAndRead(ctx, cfg)
		if ctx.Err() != nil {
			return
		}
		if err != nil && !errors.Is(err, io.EOF) {
			log.Printf("[probe] station %s mount %s: %v", cfg.StationRef, cfg.Mount, err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > m.opts.RetryMax {
			backoff = m.opts.RetryMax
		}
	}
}

func (m *Manager) connectAndRead(ctx context.Context, cfg *Config) error {
	endpoint := ntrip.Endpoint{
		Host:      cfg.Host,
		Port:      cfg.Port,
		Mount:     cfg.Mount,
		Username:  cfg.Username,
		Password:  cfg.Password,
		Version:   "v2",
		UserAgent: "CORS-MVP-probe",
	}
	response, err := ntrip.Get(ctx, endpoint, m.opts.DialTimeout)
	if err != nil {
		return err
	}
	defer response.Close()

	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			_ = response.Close()
		case <-stop:
		}
	}()
	if cfg.Lat != nil && cfg.Lon != nil && response.Conn != nil {
		interval := cfg.Interval
		if interval <= 0 {
			interval = m.opts.NMEAInterval
		}
		go func() {
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case at := <-ticker.C:
					if err := response.Conn.SetWriteDeadline(time.Now().Add(2 * time.Second)); err != nil {
						return
					}
					_, writeErr := response.Conn.Write(nmea.Join(*cfg.Lat, *cfg.Lon, at))
					_ = response.Conn.SetWriteDeadline(time.Time{})
					if writeErr != nil {
						return
					}
				}
			}
		}()
	}

	buffer := make([]byte, m.opts.ReadBuffer)
	for {
		n, readErr := response.Body.Read(buffer)
		if n > 0 && m.opts.Quality != nil {
			sample := append([]byte(nil), buffer[:n]...)
			m.opts.Quality.Feed(quality.Target{
				Type:         quality.TargetStation,
				ID:           cfg.StationID,
				MountpointID: cfg.MountpointID,
				Direction:    quality.DirectionIngest,
			}, sample)
		}
		if readErr != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return readErr
		}
	}
}
