package relay

import (
	"sync"
	"time"
)

type Metrics struct {
	mu              sync.Mutex
	bytesUp         uint64
	bytesDown       uint64
	frames          uint64
	crcErrors       uint64
	monitorDrops    uint64
	sessions        uint64
	retries         uint64
	lastDataAt      time.Time
	lastUpAt        time.Time
	lastDownAt      time.Time
	state           string
	appliedRevision int64
	lastError       string
}

type MetricsSnapshot struct {
	JobID           int64  `json:"jobId"`
	State           string `json:"state"`
	AppliedRevision int64  `json:"appliedRevision"`
	BytesUp         uint64 `json:"bytesUp"`
	BytesDown       uint64 `json:"bytesDown"`
	Frames          uint64 `json:"frames"`
	CRCErrors       uint64 `json:"crcErrors"`
	MonitorDrops    uint64 `json:"monitorDrops"`
	Sessions        uint64 `json:"sessions"`
	Retries         uint64 `json:"retries"`
	LastDataAt      string `json:"lastDataAt,omitempty"`
	LastUpAt        string `json:"lastUpAt,omitempty"`
	LastDownAt      string `json:"lastDownAt,omitempty"`
	LastError       string `json:"lastError,omitempty"`
}

func (m *Metrics) AddUp(n int) {
	m.mu.Lock()
	m.bytesUp += uint64(n)
	now := time.Now().UTC()
	m.lastDataAt = now
	m.lastUpAt = now
	m.mu.Unlock()
}

func (m *Metrics) AddDown(n int) {
	m.mu.Lock()
	m.bytesDown += uint64(n)
	m.lastDownAt = time.Now().UTC()
	m.mu.Unlock()
}

func (m *Metrics) AddMonitorDrop() {
	m.mu.Lock()
	m.monitorDrops++
	m.mu.Unlock()
}

func (m *Metrics) SetFrames(frames, crcErrors uint64) {
	m.mu.Lock()
	m.frames = frames
	m.crcErrors = crcErrors
	m.mu.Unlock()
}

func (m *Metrics) SessionStarted() {
	m.mu.Lock()
	m.sessions++
	m.mu.Unlock()
}

func (m *Metrics) Retry() {
	m.mu.Lock()
	m.retries++
	m.mu.Unlock()
}

func (m *Metrics) SetState(state string, appliedRevision int64, lastError string) {
	m.mu.Lock()
	m.state = state
	m.appliedRevision = appliedRevision
	m.lastError = lastError
	m.mu.Unlock()
}

func (m *Metrics) Snapshot(jobID int64) MetricsSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	snapshot := MetricsSnapshot{
		JobID:           jobID,
		State:           m.state,
		AppliedRevision: m.appliedRevision,
		BytesUp:         m.bytesUp,
		BytesDown:       m.bytesDown,
		Frames:          m.frames,
		CRCErrors:       m.crcErrors,
		MonitorDrops:    m.monitorDrops,
		Sessions:        m.sessions,
		Retries:         m.retries,
		LastError:       m.lastError,
	}
	if !m.lastDataAt.IsZero() {
		snapshot.LastDataAt = m.lastDataAt.Format(time.RFC3339Nano)
	}
	if !m.lastUpAt.IsZero() {
		snapshot.LastUpAt = m.lastUpAt.Format(time.RFC3339Nano)
	}
	if !m.lastDownAt.IsZero() {
		snapshot.LastDownAt = m.lastDownAt.Format(time.RFC3339Nano)
	}
	return snapshot
}
