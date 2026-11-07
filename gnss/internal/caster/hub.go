package caster

import (
	"sync"

	"cors/gnss/internal/quality"
	"cors/gnss/internal/rtcm"
)

type hub struct {
	mountpoint *MountpointConfig
	monitor    *rtcm.Monitor
	quality    *quality.Analyzer

	mu      sync.Mutex
	source  *connection
	// externalSourceID đánh dấu source của trạm ntrip_client được bridge từ
	// station source manager vào hub này (single-writer theo stationID).
	externalSourceID int64
	rovers  map[int64]*connection
	taps    map[int64]*stationTap
	nextTap int64
}

func newHub(mountpoint *MountpointConfig, analyzer *quality.Analyzer) *hub {
	return &hub{
		mountpoint: mountpoint,
		monitor:    rtcm.NewMonitor(64 * 1024),
		quality:    analyzer,
		rovers:     make(map[int64]*connection),
		taps:       make(map[int64]*stationTap),
	}
}

func (h *hub) setMountpoint(mountpoint *MountpointConfig) {
	h.mu.Lock()
	h.mountpoint = mountpoint
	h.mu.Unlock()
}

func (h *hub) snapshotMountpoint() *MountpointConfig {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.mountpoint
}

func (h *hub) addSource(c *connection) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.source != nil || h.externalSourceID != 0 || c.isClosed() {
		return false
	}
	h.source = c
	if c.isClosed() {
		h.source = nil
		return false
	}
	return true
}

func (h *hub) hasSource() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.source != nil || h.externalSourceID != 0
}

// currentSource trả source đang giữ mountpoint. Dùng khi trạm mở kết nối mới:
// kết nối cũ có thể đã half-open nhưng chưa hết SourceIdleTimeout.
func (h *hub) currentSource() *connection {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.source
}

func (h *hub) removeSource(c *connection) []*connection {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.source != c {
		return nil
	}
	h.source = nil
	h.closeTapsLocked()
	rovers := make([]*connection, 0, len(h.rovers))
	for _, rover := range h.rovers {
		rovers = append(rovers, rover)
	}
	h.rovers = make(map[int64]*connection)
	return rovers
}

// detachSource chỉ bỏ tham chiếu source, giữ rover lại để chờ source mới
// trong khoảng grace.
func (h *hub) detachSource(c *connection) {
	h.mu.Lock()
	if h.source == c {
		h.source = nil
	}
	h.mu.Unlock()
}

// takeRoversIfNoSource trả toàn bộ rover nếu hiện không còn source.
func (h *hub) takeRoversIfNoSource() []*connection {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.source != nil || h.externalSourceID != 0 {
		return nil
	}
	h.closeTapsLocked()
	if len(h.rovers) == 0 {
		return nil
	}
	rovers := make([]*connection, 0, len(h.rovers))
	for _, rover := range h.rovers {
		rovers = append(rovers, rover)
	}
	h.rovers = make(map[int64]*connection)
	return rovers
}

func (h *hub) addRover(c *connection) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if c.isClosed() {
		return false
	}
	h.rovers[c.id] = c
	if c.isClosed() {
		delete(h.rovers, c.id)
		return false
	}
	return true
}

func (h *hub) removeRover(c *connection) {
	h.mu.Lock()
	if h.rovers[c.id] == c {
		delete(h.rovers, c.id)
	}
	h.mu.Unlock()
}

// openTap tạo subscriber in-process cho relay. Chỉ mở khi source đang giữ
// mountpoint để relay nhận lỗi và backoff giống một lần GET thất bại.
func (h *hub) openTap() (*stationTap, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.source == nil && h.externalSourceID == 0 {
		return nil, errNoSource
	}
	h.nextTap++
	tap := newStationTap(h.nextTap)
	h.taps[tap.id] = tap
	return tap, nil
}

func (h *hub) removeTap(tap *stationTap) {
	h.mu.Lock()
	if h.taps[tap.id] == tap {
		delete(h.taps, tap.id)
	}
	h.mu.Unlock()
	tap.close()
}

func (h *hub) closeTapsLocked() {
	for _, tap := range h.taps {
		tap.close()
	}
	h.taps = make(map[int64]*stationTap)
}

// publishFrom chỉ nhận dữ liệu từ source đang giữ mountpoint. Source cũ có
// thể còn đọc được vài byte sau khi bị thay thế; nếu không kiểm tra, byte cũ
// sẽ xen vào luồng của source mới.
func (h *hub) publishFrom(source *connection, data []byte) {
	copied := append([]byte(nil), data...)

	h.mu.Lock()
	if source == nil || h.source != source {
		h.mu.Unlock()
		return
	}
	mountpoint := h.mountpoint
	rovers := make([]*connection, 0, len(h.rovers))
	for _, rover := range h.rovers {
		rovers = append(rovers, rover)
	}
	taps := make([]*stationTap, 0, len(h.taps))
	for _, tap := range h.taps {
		taps = append(taps, tap)
	}
	h.mu.Unlock()

	h.monitor.Feed(copied)
	if h.quality != nil && mountpoint != nil && mountpoint.StationID > 0 {
		h.quality.Feed(quality.Target{
			Type:         quality.TargetStation,
			ID:           mountpoint.StationID,
			MountpointID: mountpoint.ID,
			Direction:    quality.DirectionIngest,
		}, copied)
	}

	for _, rover := range rovers {
		if !rover.enqueue(copied) {
			rover.closeWithReason("slow_client")
		}
	}
	for _, tap := range taps {
		if !tap.trySend(copied) {
			h.removeTap(tap)
		}
	}
}

func (h *hub) stats() rtcm.Stats {
	return h.monitor.Snapshot()
}

// attachExternal đánh dấu hub đang được bridge bởi station source của trạm.
// Trả false khi hub đã có source thật hoặc đang do trạm khác bridge.
func (h *hub) attachExternal(stationID int64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.source != nil {
		return false
	}
	if h.externalSourceID == 0 {
		h.externalSourceID = stationID
		return true
	}
	return h.externalSourceID == stationID
}

// publishExternal nhận byte từ station source manager. Không feed quality vì
// station source manager đã feed quality ingest cho cùng trạm.
func (h *hub) publishExternal(stationID int64, data []byte) {
	copied := append([]byte(nil), data...)

	h.mu.Lock()
	if stationID == 0 || h.externalSourceID != stationID {
		h.mu.Unlock()
		return
	}
	rovers := make([]*connection, 0, len(h.rovers))
	for _, rover := range h.rovers {
		rovers = append(rovers, rover)
	}
	taps := make([]*stationTap, 0, len(h.taps))
	for _, tap := range h.taps {
		taps = append(taps, tap)
	}
	h.mu.Unlock()

	h.monitor.Feed(copied)

	for _, rover := range rovers {
		if !rover.enqueue(copied) {
			rover.closeWithReason("slow_client")
		}
	}
	for _, tap := range taps {
		if !tap.trySend(copied) {
			h.removeTap(tap)
		}
	}
}

// detachExternal chuyển hub về "no source" khi phiên station source kết thúc.
// Tap bị đóng để relay nhận EOF; rover được trả về cho manager xử lý grace.
func (h *hub) detachExternal(stationID int64) []*connection {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.externalSourceID != stationID {
		return nil
	}
	h.externalSourceID = 0
	h.closeTapsLocked()
	rovers := make([]*connection, 0, len(h.rovers))
	for _, rover := range h.rovers {
		rovers = append(rovers, rover)
	}
	h.rovers = make(map[int64]*connection)
	return rovers
}
