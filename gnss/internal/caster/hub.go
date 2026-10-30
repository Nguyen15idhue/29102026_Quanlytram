package caster

import (
	"sync"

	"cors/gnss/internal/rtcm"
)

type hub struct {
	mountpoint *MountpointConfig
	monitor    *rtcm.Monitor

	mu     sync.Mutex
	source *connection
	rovers map[int64]*connection
}

func newHub(mountpoint *MountpointConfig) *hub {
	return &hub{
		mountpoint: mountpoint,
		monitor:    rtcm.NewMonitor(64 * 1024),
		rovers:     make(map[int64]*connection),
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
	if h.source != nil {
		return false
	}
	h.source = c
	return true
}

func (h *hub) hasSource() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.source != nil
}

func (h *hub) removeSource(c *connection) []*connection {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.source != c {
		return nil
	}
	h.source = nil
	rovers := make([]*connection, 0, len(h.rovers))
	for _, rover := range h.rovers {
		rovers = append(rovers, rover)
	}
	h.rovers = make(map[int64]*connection)
	return rovers
}

func (h *hub) addRover(c *connection) {
	h.mu.Lock()
	h.rovers[c.id] = c
	h.mu.Unlock()
}

func (h *hub) removeRover(c *connection) {
	h.mu.Lock()
	if h.rovers[c.id] == c {
		delete(h.rovers, c.id)
	}
	h.mu.Unlock()
}

func (h *hub) publish(data []byte) {
	copied := append([]byte(nil), data...)
	h.monitor.Feed(copied)

	h.mu.Lock()
	rovers := make([]*connection, 0, len(h.rovers))
	for _, rover := range h.rovers {
		rovers = append(rovers, rover)
	}
	h.mu.Unlock()

	for _, rover := range rovers {
		if !rover.enqueue(copied) {
			rover.closeWithReason("slow_client")
		}
	}
}

func (h *hub) stats() rtcm.Stats {
	return h.monitor.Snapshot()
}
