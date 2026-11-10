package quality

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// MySQLStore persists aggregated quality data into cors_runtime. It never
// stores raw RTCM frames or payloads.
type MySQLStore struct {
	db *sql.DB
}

// execer tối thiểu để test được câu lệnh dọn dẹp mà không cần MySQL thật.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func NewMySQLStore(db *sql.DB) *MySQLStore {
	return &MySQLStore{db: db}
}

func (s *MySQLStore) SaveMessageStats(ctx context.Context, rows []MessageStat) error {
	if len(rows) == 0 {
		return nil
	}
	values := make([]string, 0, len(rows))
	args := make([]any, 0, len(rows)*8)
	for _, row := range rows {
		values = append(values, "(?, ?, ?, ?, ?, ?, ?, ?, ?)")
		args = append(args,
			row.Target.Type,
			row.Target.ID,
			row.Target.MountpointID,
			row.Target.Direction,
			row.HourStartUTC.UTC(),
			row.MessageType,
			row.Count,
			row.Bytes,
			row.LastSeenAt.UTC(),
		)
	}
	query := `INSERT INTO rtcm_message_stats
		(target_type, target_id, mountpoint_id, direction, hour_start_utc, message_type, ` + "`count`" + `, bytes, last_seen_at)
		VALUES ` + strings.Join(values, ",") + `
		ON DUPLICATE KEY UPDATE
			` + "`count`" + ` = ` + "`count`" + ` + VALUES(` + "`count`" + `),
			bytes = bytes + VALUES(bytes),
			last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at))`
	_, err := s.db.ExecContext(ctx, query, args...)
	return err
}

func (s *MySQLStore) SaveSamples(ctx context.Context, rows []Sample) error {
	if len(rows) == 0 {
		return nil
	}
	values := make([]string, 0, len(rows))
	args := make([]any, 0, len(rows)*24)
	for _, row := range rows {
		details := []byte(nil)
		if row.Details != nil {
			encoded, err := json.Marshal(row.Details)
			if err != nil {
				return err
			}
			details = encoded
		}
		values = append(values, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
		args = append(args,
			row.Target.Type,
			row.Target.ID,
			row.Target.MountpointID,
			row.Target.Direction,
			row.Ts.UTC(),
			row.WindowSec,
			row.Score,
			row.State,
			row.Frames,
			row.Bytes,
			row.CRCErrors,
			row.ParseErrors,
			row.Unknown,
			row.MSMEpochs,
			row.Satellites,
			row.Signals,
			row.Cells,
			row.AvgCnr,
			uint16Ptr(row.StationID),
			int64Ptr(row.ARPX),
			int64Ptr(row.ARPY),
			int64Ptr(row.ARPZ),
			float64Ptr(row.ARPDeltaM),
			nullString(row.Antenna),
			row.AgeMs,
			row.Gaps,
			row.CNRAvailable,
			details,
		)
	}
	query := `INSERT INTO quality_samples
		(target_type, target_id, mountpoint_id, direction, ts, window_sec, score, state,
		 frames, bytes, crc_errors, parse_errors, unknown_messages, msm_epochs,
		 satellites, signals, cells, avg_cnr, reported_station_id,
		 arp_x, arp_y, arp_z, arp_delta_m, antenna, age_ms, gaps, cnr_available, details)
		VALUES ` + strings.Join(values, ",")
	// The placeholder list above intentionally has 28 entries; keep the runtime
	// row shape in sync with the migration.
	_, err := s.db.ExecContext(ctx, query, args...)
	return err
}

func (s *MySQLStore) UpsertAlert(ctx context.Context, alert AlertRecord) error {
	details := []byte(nil)
	if alert.Details != nil {
		encoded, err := json.Marshal(alert.Details)
		if err != nil {
			return err
		}
		details = encoded
	}
	var id int64
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM quality_alerts
		  WHERE target_type = ? AND target_id = ? AND mountpoint_id = ? AND direction = ?
		    AND code = ? AND resolved_at IS NULL
		  ORDER BY id DESC LIMIT 1`,
		alert.Target.Type, alert.Target.ID, alert.Target.MountpointID, alert.Target.Direction, alert.Code,
	).Scan(&id)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == nil {
		_, err = s.db.ExecContext(ctx,
			`UPDATE quality_alerts
			    SET event_type = ?, level = ?, last_seen = ?, details = ?
			  WHERE id = ?`,
			alert.EventType, alert.Level, alert.LastSeen.UTC(), details, id,
		)
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO quality_alerts
			(target_type, target_id, mountpoint_id, direction, event_type, code, level,
			 first_seen, last_seen, details)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		alert.Target.Type, alert.Target.ID, alert.Target.MountpointID, alert.Target.Direction,
		alert.EventType, alert.Code, alert.Level, alert.FirstSeen.UTC(), alert.LastSeen.UTC(), details,
	)
	return err
}

func (s *MySQLStore) ResolveAlert(ctx context.Context, target Target, code string, resolvedAt time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE quality_alerts
		    SET resolved_at = ?
		  WHERE target_type = ? AND target_id = ? AND mountpoint_id = ? AND direction = ?
		    AND code = ? AND resolved_at IS NULL`,
		resolvedAt.UTC(), target.Type, target.ID, target.MountpointID, target.Direction, code,
	)
	return err
}

// ResolveAllOpen đóng mọi alert chất lượng còn mở khi Go khởi động lại.
// Go mất state trong RAM sau restart: alert nào còn đúng sẽ được analyzer tạo
// lại ngay; alert không còn đúng sẽ không bao giờ được resolve nếu bỏ qua bước
// này (D20-8).
func (s *MySQLStore) ResolveAllOpen(ctx context.Context) (int64, error) {
	return resolveAllOpen(ctx, s.db)
}

func resolveAllOpen(ctx context.Context, db execer) (int64, error) {
	result, err := db.ExecContext(ctx,
		`UPDATE quality_alerts
		    SET resolved_at = UTC_TIMESTAMP(3)
		  WHERE resolved_at IS NULL`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *MySQLStore) Prune(ctx context.Context, sampleBefore time.Time, alertBefore time.Time, batch int) error {	if batch <= 0 {
		batch = 1000
	}
	if _, err := s.db.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM quality_samples WHERE ts < ? ORDER BY id LIMIT %d`, batch),
		sampleBefore.UTC(),
	); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM quality_alerts WHERE last_seen < ? ORDER BY id LIMIT %d`, batch),
		alertBefore.UTC(),
	)
	return err
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func uint16Ptr(value *uint16) any {
	if value == nil {
		return nil
	}
	return *value
}

func int64Ptr(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func float64Ptr(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

type storeOpKind int

const (
	opStats storeOpKind = iota + 1
	opSamples
	opAlert
	opResolve
)

type storeOp struct {
	kind    storeOpKind
	stats   []MessageStat
	samples []Sample
	alert   *AlertRecord
	resolve *ResolveAlert
}

// AsyncStore decouples RTCM parsing from MySQL latency. When the queue is full
// the operation is dropped and counted; relay/caster byte flow is never blocked.
type AsyncStore struct {
	store        Store
	queue        chan storeOp
	storeTimeout time.Duration
	// Plan 20 (D20-5): timeout riêng cho từng loại ghi. Ghi mẫu chất lượng là
	// batch lớn nhất (mọi target) nên cần thời gian lâu hơn alert.
	sampleTimeout time.Duration
	statsTimeout  time.Duration
	alertTimeout  time.Duration

	dropped  atomic.Uint64
	failures atomic.Uint64

	mu      sync.Mutex
	started bool
	done    chan struct{}
}

func NewAsyncStore(store Store, queueSize int) *AsyncStore {
	if queueSize <= 0 {
		queueSize = 4096
	}
	return &AsyncStore{
		store:         store,
		queue:         make(chan storeOp, queueSize),
		storeTimeout:  4 * time.Second,
		sampleTimeout: 15 * time.Second,
		statsTimeout:  10 * time.Second,
		alertTimeout:  5 * time.Second,
		done:          make(chan struct{}),
	}
}

func (a *AsyncStore) enqueue(op storeOp) error {
	select {
	case a.queue <- op:
	default:
		a.dropped.Add(1)
	}
	return nil
}

func (a *AsyncStore) SaveMessageStats(_ context.Context, rows []MessageStat) error {
	if len(rows) == 0 {
		return nil
	}
	return a.enqueue(storeOp{kind: opStats, stats: rows})
}

func (a *AsyncStore) SaveSamples(_ context.Context, rows []Sample) error {
	if len(rows) == 0 {
		return nil
	}
	return a.enqueue(storeOp{kind: opSamples, samples: rows})
}

func (a *AsyncStore) UpsertAlert(_ context.Context, alert AlertRecord) error {
	copied := alert
	return a.enqueue(storeOp{kind: opAlert, alert: &copied})
}

func (a *AsyncStore) ResolveAlert(_ context.Context, target Target, code string, resolvedAt time.Time) error {
	return a.enqueue(storeOp{kind: opResolve, resolve: &ResolveAlert{Target: target, Code: code, ResolvedAt: resolvedAt}})
}

func (a *AsyncStore) Run(ctx context.Context) {
	a.mu.Lock()
	if a.started {
		a.mu.Unlock()
		return
	}
	a.started = true
	a.mu.Unlock()
	defer close(a.done)

	for {
		select {
		case <-ctx.Done():
			for {
				select {
				case op := <-a.queue:
					a.apply(op)
				default:
					return
				}
			}
		case op := <-a.queue:
			a.apply(op)
		}
	}
}

func (a *AsyncStore) timeoutFor(kind storeOpKind) time.Duration {
	var value time.Duration
	switch kind {
	case opSamples:
		value = a.sampleTimeout
	case opStats:
		value = a.statsTimeout
	case opAlert, opResolve:
		value = a.alertTimeout
	}
	if value <= 0 {
		value = a.storeTimeout
	}
	return value
}

func (a *AsyncStore) apply(op storeOp) {
	var err error
	// Retry 1 lần: MySQL có thể bận ngắn hạn; bỏ cả batch mẫu 60 s là mất dữ
	// liệu của toàn bộ trạm nên không được bỏ ngay.
	for attempt := 0; attempt < 2; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), a.timeoutFor(op.kind))
		switch op.kind {
		case opStats:
			err = a.store.SaveMessageStats(ctx, op.stats)
		case opSamples:
			err = a.store.SaveSamples(ctx, op.samples)
		case opAlert:
			err = a.store.UpsertAlert(ctx, *op.alert)
		case opResolve:
			err = a.store.ResolveAlert(ctx, op.resolve.Target, op.resolve.Code, op.resolve.ResolvedAt)
		}
		cancel()
		if err == nil {
			return
		}
		if attempt == 0 {
			time.Sleep(200 * time.Millisecond)
		}
	}
	a.failures.Add(1)
	log.Printf("[quality] store %s failed: %v", op.kind, err)
}

func (k storeOpKind) String() string {
	switch k {
	case opStats:
		return "message_stats"
	case opSamples:
		return "samples"
	case opAlert:
		return "alert"
	case opResolve:
		return "resolve_alert"
	}
	return "unknown"
}

func (a *AsyncStore) Dropped() uint64 {
	return a.dropped.Load()
}

func (a *AsyncStore) Failures() uint64 {
	return a.failures.Load()
}

func (a *AsyncStore) Done() <-chan struct{} {
	return a.done
}
