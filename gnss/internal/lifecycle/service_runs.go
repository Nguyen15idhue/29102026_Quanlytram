package lifecycle

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"sync"
	"time"
)

const (
	DefaultInterval = 15 * time.Second
	DefaultGap      = 45 * time.Second
)

// Manager ghi nhận vòng đời service vào cors_runtime.service_runs để timeline
// phân biệt khoảng "service dừng" với "nguồn mất kết nối". Không chặn luồng
// RTCM: mọi lỗi DB chỉ log và tiếp tục.
type Manager struct {
	db       *sql.DB
	service  string
	interval time.Duration
	gap      time.Duration

	mu           sync.Mutex
	started      bool
	lastErrorLog time.Time
}

func New(db *sql.DB, service string, interval time.Duration) *Manager {
	if interval <= 0 {
		interval = DefaultInterval
	}
	return &Manager{
		db:       db,
		service:  service,
		interval: interval,
		gap:      DefaultGap,
	}
}

func (m *Manager) Run(ctx context.Context) {
	m.mu.Lock()
	m.started = true
	m.mu.Unlock()

	if err := m.start(ctx); err != nil {
		m.logError("start", err)
	}

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := m.beat(ctx); err != nil {
				m.logError("heartbeat", err)
			}
		}
	}
}

func (m *Manager) start(ctx context.Context) error {
	if _, err := m.db.ExecContext(ctx, `
		UPDATE service_runs
		   SET stopped_at = last_seen_at,
		       stop_reason = CASE WHEN stop_reason = '' THEN 'service_restart' ELSE stop_reason END
		 WHERE service = ? AND stopped_at IS NULL`, m.service); err != nil {
		return err
	}
	if _, err := m.db.ExecContext(ctx, `
		INSERT INTO service_runs (service, started_at, last_seen_at)
		VALUES (?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, m.service); err != nil {
		return err
	}
	log.Printf("[lifecycle] %s started", m.service)
	return nil
}

func (m *Manager) beat(ctx context.Context) error {
	var (
		id       int64
		lastSeen time.Time
	)
	err := m.db.QueryRowContext(ctx, `
		SELECT id, last_seen_at FROM service_runs
		 WHERE service = ? AND stopped_at IS NULL
		 ORDER BY id DESC LIMIT 1`, m.service).Scan(&id, &lastSeen)
	if errors.Is(err, sql.ErrNoRows) {
		return m.start(ctx)
	}
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	if now.Sub(lastSeen) > m.gap {
		if _, err := m.db.ExecContext(ctx, `
			UPDATE service_runs
			   SET stopped_at = last_seen_at, stop_reason = 'heartbeat_gap'
			 WHERE id = ? AND stopped_at IS NULL`, id); err != nil {
			return err
		}
		if _, err := m.db.ExecContext(ctx, `
			INSERT INTO service_runs (service, started_at, last_seen_at)
			VALUES (?, ?, ?)`, m.service, now, now); err != nil {
			return err
		}
		log.Printf("[lifecycle] %s heartbeat gap: downtime until %s",
			m.service, now.Format(time.RFC3339))
		return nil
	}

	_, err = m.db.ExecContext(ctx,
		`UPDATE service_runs SET last_seen_at = ? WHERE id = ?`, now, id)
	return err
}

// Stop ghi nhận thời điểm dừng thật khi service tắt chủ động. Gọi với context
// còn hạn trước khi hủy runCtx.
func (m *Manager) Stop(ctx context.Context, reason string) error {
	m.mu.Lock()
	started := m.started
	m.mu.Unlock()
	if !started {
		return nil
	}
	now := time.Now().UTC()
	if _, err := m.db.ExecContext(ctx, `
		UPDATE service_runs
		   SET stopped_at = ?, last_seen_at = ?, stop_reason = ?
		 WHERE service = ? AND stopped_at IS NULL`,
		now, now, reason, m.service); err != nil {
		return err
	}
	log.Printf("[lifecycle] %s stopped (%s)", m.service, reason)
	return nil
}

func (m *Manager) logError(operation string, err error) {
	if err == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if time.Since(m.lastErrorLog) < 30*time.Second {
		return
	}
	m.lastErrorLog = time.Now()
	log.Printf("[lifecycle] %s %s failed: %v", m.service, operation, err)
}
