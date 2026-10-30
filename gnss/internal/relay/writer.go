package relay

import (
	"context"
	"database/sql"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

type RuntimeWriter interface {
	State(jobID int64, state string, appliedRevision int64, lastError string)
	Session(jobID int64, start, end time.Time, result, closeReason, message string)
	Event(jobID int64, eventType, message string, durationSec int)
	Hourly(jobID int64, hour time.Time, onlineSec, sessions, errors, timeouts, authErrors, proxyErrors, nmeaErrors, retries int)
}

type opKind int

const (
	opState opKind = iota
	opSession
	opEvent
	opHourly
)

type writeOp struct {
	kind            opKind
	jobID           int64
	state           string
	appliedRevision int64
	lastError       string

	start       time.Time
	end         time.Time
	result      string
	closeReason string
	message     string

	eventType   string
	durationSec int

	hour        time.Time
	onlineSec   int
	sessions    int
	errors      int
	timeouts    int
	authErrors  int
	proxyErrors int
	nmeaErrors  int
	retries     int
}

type BufferedWriter struct {
	db           *sql.DB
	enqueueCh    chan writeOp
	queue        int
	batch        int
	interval     time.Duration
	flushFn      func(context.Context, []writeOp) error
	dropped      atomic.Uint64
	done         chan struct{}
	lastErrorLog time.Time
}

func NewBufferedWriter(db *sql.DB, queueSize, batchSize int, interval time.Duration) *BufferedWriter {
	if queueSize <= 0 {
		queueSize = 10000
	}
	if batchSize <= 0 {
		batchSize = 100
	}
	if interval <= 0 {
		interval = time.Second
	}
	w := &BufferedWriter{
		db:        db,
		enqueueCh: make(chan writeOp, queueSize),
		queue:     queueSize,
		batch:     batchSize,
		interval:  interval,
		done:      make(chan struct{}),
	}
	w.flushFn = w.flushMySQL
	return w
}

func newBufferedWriterWithFlush(queueSize int, flush func(context.Context, []writeOp) error) *BufferedWriter {
	w := NewBufferedWriter(nil, queueSize, 1, time.Millisecond)
	w.flushFn = flush
	return w
}

func (w *BufferedWriter) State(jobID int64, state string, appliedRevision int64, lastError string) {
	w.enqueue(writeOp{
		kind:            opState,
		jobID:           jobID,
		state:           state,
		appliedRevision: appliedRevision,
		lastError:       lastError,
	})
}

func (w *BufferedWriter) Session(jobID int64, start, end time.Time, result, closeReason, message string) {
	w.enqueue(writeOp{
		kind:        opSession,
		jobID:       jobID,
		start:       start,
		end:         end,
		result:      result,
		closeReason: closeReason,
		message:     message,
	})
}

func (w *BufferedWriter) Event(jobID int64, eventType, message string, durationSec int) {
	w.enqueue(writeOp{
		kind:        opEvent,
		jobID:       jobID,
		eventType:   eventType,
		message:     message,
		durationSec: durationSec,
	})
}

func (w *BufferedWriter) Hourly(jobID int64, hour time.Time, onlineSec, sessions, errors, timeouts, authErrors, proxyErrors, nmeaErrors, retries int) {
	w.enqueue(writeOp{
		kind:        opHourly,
		jobID:       jobID,
		hour:        hour,
		onlineSec:   onlineSec,
		sessions:    sessions,
		errors:      errors,
		timeouts:    timeouts,
		authErrors:  authErrors,
		proxyErrors: proxyErrors,
		nmeaErrors:  nmeaErrors,
		retries:     retries,
	})
}

func (w *BufferedWriter) Dropped() uint64 {
	return w.dropped.Load()
}

func (w *BufferedWriter) Done() <-chan struct{} {
	return w.done
}

func (w *BufferedWriter) enqueue(op writeOp) {
	select {
	case w.enqueueCh <- op:
		return
	default:
	}
	select {
	case <-w.enqueueCh:
		w.dropped.Add(1)
	default:
	}
	select {
	case w.enqueueCh <- op:
	default:
		w.dropped.Add(1)
	}
}

func (w *BufferedWriter) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	defer close(w.done)

	pending := make([]writeOp, 0, w.batch)
	for {
		select {
		case <-ctx.Done():
			for {
				select {
				case op := <-w.enqueueCh:
					pending = append(pending, op)
				default:
					flushCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
					if !w.flushOnce(flushCtx, pending) {
						w.dropped.Add(uint64(len(pending)))
					}
					cancel()
					return
				}
			}
		case op := <-w.enqueueCh:
			pending = append(pending, op)
			if len(pending) >= w.batch {
				pending = w.settle(ctx, pending)
			}
		case <-ticker.C:
			if len(pending) > 0 {
				pending = w.settle(ctx, pending)
			}
		}
	}
}

func (w *BufferedWriter) settle(ctx context.Context, pending []writeOp) []writeOp {
	if len(pending) == 0 {
		return pending
	}
	if w.flushOnce(ctx, pending) {
		return pending[:0]
	}
	if len(pending) > w.queue {
		drop := len(pending) - w.queue
		pending = append(pending[:0], pending[drop:]...)
		w.dropped.Add(uint64(drop))
	}
	return pending
}

func (w *BufferedWriter) flushOnce(ctx context.Context, pending []writeOp) bool {
	if len(pending) == 0 {
		return true
	}
	flushCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	err := w.flushFn(flushCtx, pending)
	cancel()
	if err == nil {
		return true
	}
	if time.Since(w.lastErrorLog) > 5*time.Second {
		log.Printf("[relay] runtime writer flush failed: %v (dropped=%d)", err, w.dropped.Load())
		w.lastErrorLog = time.Now()
	}
	return false
}

func (w *BufferedWriter) flushMySQL(ctx context.Context, ops []writeOp) error {
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, op := range ops {
		switch op.kind {
		case opState:
			_, err = tx.ExecContext(ctx, `
				INSERT INTO relay_job_state
				  (relay_job_id, runtime_state, applied_revision, last_error, last_applied_at, updated_at)
				VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
				ON DUPLICATE KEY UPDATE
				  runtime_state = VALUES(runtime_state),
				  applied_revision = VALUES(applied_revision),
				  last_error = VALUES(last_error),
				  last_applied_at = VALUES(last_applied_at),
				  updated_at = UTC_TIMESTAMP(3)`,
				op.jobID, op.state, op.appliedRevision, nullIfEmpty(op.lastError))
		case opSession:
			duration := int(op.end.Sub(op.start).Seconds())
			if duration < 0 {
				duration = 0
			}
			_, err = tx.ExecContext(ctx, `
				INSERT INTO relay_sessions
				  (relay_job_id, start_ts, end_ts, duration_sec, result, close_reason, message)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
				op.jobID, op.start.UTC(), op.end.UTC(), duration, op.result, op.closeReason, op.message)
		case opEvent:
			_, err = tx.ExecContext(ctx, `
				INSERT INTO relay_events (relay_job_id, ts, type, message, duration_sec)
				VALUES (?, UTC_TIMESTAMP(3), ?, ?, ?)`,
				op.jobID, op.eventType, op.message, nullIfZero(op.durationSec))
		case opHourly:
			_, err = tx.ExecContext(ctx, `
				INSERT INTO relay_hourly
				  (relay_job_id, hour_start_utc, online_sec, sessions, errors, timeouts,
				   auth_errors, proxy_errors, nmea_errors, retries)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON DUPLICATE KEY UPDATE
				  online_sec = online_sec + VALUES(online_sec),
				  sessions = sessions + VALUES(sessions),
				  errors = errors + VALUES(errors),
				  timeouts = timeouts + VALUES(timeouts),
				  auth_errors = auth_errors + VALUES(auth_errors),
				  proxy_errors = proxy_errors + VALUES(proxy_errors),
				  nmea_errors = nmea_errors + VALUES(nmea_errors),
				  retries = retries + VALUES(retries)`,
				op.jobID, op.hour.UTC().Truncate(time.Hour), op.onlineSec, op.sessions,
				op.errors, op.timeouts, op.authErrors, op.proxyErrors, op.nmeaErrors, op.retries)
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullIfZero(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

type MemoryWriter struct {
	mu       sync.Mutex
	states   []writeOp
	sessions []writeOp
	events   []writeOp
	hourly   []writeOp
}

func (m *MemoryWriter) State(jobID int64, state string, appliedRevision int64, lastError string) {
	m.mu.Lock()
	m.states = append(m.states, writeOp{jobID: jobID, state: state, appliedRevision: appliedRevision, lastError: lastError})
	m.mu.Unlock()
}

func (m *MemoryWriter) Session(jobID int64, start, end time.Time, result, closeReason, message string) {
	m.mu.Lock()
	m.sessions = append(m.sessions, writeOp{jobID: jobID, start: start, end: end, result: result, closeReason: closeReason, message: message})
	m.mu.Unlock()
}

func (m *MemoryWriter) Event(jobID int64, eventType, message string, durationSec int) {
	m.mu.Lock()
	m.events = append(m.events, writeOp{jobID: jobID, eventType: eventType, message: message, durationSec: durationSec})
	m.mu.Unlock()
}

func (m *MemoryWriter) Hourly(jobID int64, hour time.Time, onlineSec, sessions, errors, timeouts, authErrors, proxyErrors, nmeaErrors, retries int) {
	m.mu.Lock()
	m.hourly = append(m.hourly, writeOp{jobID: jobID, hour: hour, onlineSec: onlineSec, sessions: sessions, errors: errors})
	m.mu.Unlock()
}

func (m *MemoryWriter) StateWrites() []writeOp {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]writeOp{}, m.states...)
}

func (m *MemoryWriter) SessionWrites() []writeOp {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]writeOp{}, m.sessions...)
}

func (m *MemoryWriter) EventWrites() []writeOp {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]writeOp{}, m.events...)
}

func (m *MemoryWriter) HourlyWrites() []writeOp {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]writeOp{}, m.hourly...)
}
