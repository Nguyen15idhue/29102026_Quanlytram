package caster

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"

	"cors/gnss/internal/quality"
)

type Options struct {
	BindAddr      string
	PollInterval  time.Duration
	HeaderTimeout time.Duration
	WriteTimeout  time.Duration
	DBTimeout     time.Duration
	ReadBuffer    int
	QueueSize     int
	MaxHeader     int
	Quality       *quality.Analyzer
}

func DefaultOptions() Options {
	return Options{
		BindAddr:      "0.0.0.0",
		PollInterval:  10 * time.Second,
		HeaderTimeout: 10 * time.Second,
		WriteTimeout:  10 * time.Second,
		DBTimeout:     3 * time.Second,
		ReadBuffer:    32 * 1024,
		QueueSize:     64,
		MaxHeader:     16 * 1024,
	}
}

func (o Options) withDefaults() Options {
	defaults := DefaultOptions()
	if o.BindAddr == "" {
		o.BindAddr = defaults.BindAddr
	}
	if o.PollInterval <= 0 {
		o.PollInterval = defaults.PollInterval
	}
	if o.HeaderTimeout <= 0 {
		o.HeaderTimeout = defaults.HeaderTimeout
	}
	if o.WriteTimeout <= 0 {
		o.WriteTimeout = defaults.WriteTimeout
	}
	if o.DBTimeout <= 0 {
		o.DBTimeout = defaults.DBTimeout
	}
	if o.ReadBuffer <= 0 {
		o.ReadBuffer = defaults.ReadBuffer
	}
	if o.QueueSize <= 0 {
		o.QueueSize = defaults.QueueSize
	}
	if o.MaxHeader <= 0 {
		o.MaxHeader = defaults.MaxHeader
	}
	return o
}

var (
	errStopping     = errors.New("caster is stopping")
	errMaxConns     = errors.New("maximum connections reached")
	errSourceExists = errors.New("mountpoint already has a source")
)

type manager struct {
	store   ConfigStore
	runtime RuntimeStore
	opts    Options

	reconcileMu sync.Mutex
	connWG      sync.WaitGroup

	mu            sync.Mutex
	rootCtx       context.Context
	stopping      bool
	accounts      map[string]*AccountConfig
	accountsByID  map[int64]*AccountConfig
	mountpoints   map[int64]*MountpointConfig
	hubs          map[int64]*hub
	listeners     map[int64]*listenerRuntime
	listenerCfgs  map[int64]*ListenerConfig
	listenerError map[int64]string
	conns         map[int64]*connection
	syntheticID   int64
}

func NewManager(store ConfigStore, runtime RuntimeStore, opts Options) *manager {
	return &manager{
		store:         store,
		runtime:       runtime,
		opts:          opts.withDefaults(),
		accounts:      make(map[string]*AccountConfig),
		accountsByID:  make(map[int64]*AccountConfig),
		mountpoints:   make(map[int64]*MountpointConfig),
		hubs:          make(map[int64]*hub),
		listeners:     make(map[int64]*listenerRuntime),
		listenerCfgs:  make(map[int64]*ListenerConfig),
		listenerError: make(map[int64]string),
		conns:         make(map[int64]*connection),
	}
}

func (m *manager) Run(ctx context.Context) {
	m.mu.Lock()
	m.rootCtx = ctx
	m.mu.Unlock()

	if err := m.Reconcile(ctx); err != nil {
		log.Printf("[caster] initial reconcile failed: %v", err)
	}

	ticker := time.NewTicker(m.opts.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := m.Reconcile(ctx); err != nil {
				log.Printf("[caster] reconcile failed: %v", err)
			}
		}
	}
}

func (m *manager) Reconcile(ctx context.Context) error {
	m.reconcileMu.Lock()
	defer m.reconcileMu.Unlock()

	cfg, err := m.store.LoadConfig(ctx)
	if err != nil {
		return err
	}

	m.mu.Lock()
	if m.stopping {
		m.mu.Unlock()
		return nil
	}

	accounts := make(map[string]*AccountConfig, len(cfg.Accounts))
	accountsByID := make(map[int64]*AccountConfig, len(cfg.Accounts))
	for _, account := range cfg.Accounts {
		accounts[account.Username] = account
		accountsByID[account.ID] = account
	}
	m.accounts = accounts
	m.accountsByID = accountsByID

	mountpoints := make(map[int64]*MountpointConfig, len(cfg.Mountpoints))
	hubs := make(map[int64]*hub, len(cfg.Mountpoints))
	for id, mountpoint := range cfg.Mountpoints {
		mountpoints[id] = mountpoint
		if existing := m.hubs[id]; existing != nil {
			existing.setMountpoint(mountpoint)
			hubs[id] = existing
		} else {
			hubs[id] = newHub(mountpoint, m.opts.Quality)
		}
	}
	m.mountpoints = mountpoints
	m.hubs = hubs

	listenerCfgs := make(map[int64]*ListenerConfig, len(cfg.Listeners))
	listenerByID := make(map[int64]*ListenerConfig, len(cfg.Listeners))
	for _, listener := range cfg.Listeners {
		listenerCfgs[listener.ID] = listener
		listenerByID[listener.ID] = listener
	}
	m.listenerCfgs = listenerCfgs

	var toStop []*listenerRuntime
	var toStart []*ListenerConfig
	restartIDs := make(map[int64]bool)
	nextListeners := make(map[int64]*listenerRuntime)

	for id, runtime := range m.listeners {
		desired := listenerByID[id]
		if desired == nil || !desired.Enabled {
			toStop = append(toStop, runtime)
			delete(m.listenerError, id)
			continue
		}
		if runtime.needsRestart(desired) {
			toStop = append(toStop, runtime)
			toStart = append(toStart, desired)
			restartIDs[id] = true
			continue
		}
		runtime.updateConfig(desired)
		nextListeners[id] = runtime
	}
	for id, desired := range listenerByID {
		if !desired.Enabled || nextListeners[id] != nil {
			continue
		}
		startAlready := false
		for _, pending := range toStart {
			if pending.ID == id {
				startAlready = true
				break
			}
		}
		if !startAlready {
			toStart = append(toStart, desired)
		}
	}
	m.listeners = nextListeners

	invalid := m.collectInvalidLocked(listenerByID, restartIDs)
	m.mu.Unlock()

	for _, runtime := range toStop {
		runtime.stop()
	}
	for _, desired := range toStart {
		if err := m.startListener(desired); err != nil {
			log.Printf("[caster] listener %d on port %d failed: %v", desired.ID, desired.Port, err)
			m.mu.Lock()
			m.listenerError[desired.ID] = err.Error()
			m.mu.Unlock()
		}
	}
	for _, conn := range invalid {
		conn.closeWithReason("config_changed")
	}
	return nil
}

func (m *manager) startListener(cfg *ListenerConfig) error {
	if cfg.Port == 2101 || cfg.Port == 8081 {
		return fmt.Errorf("port %d is reserved", cfg.Port)
	}
	address := net.JoinHostPort(m.opts.BindAddr, strconv.Itoa(cfg.Port))
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	runtime := newListenerRuntime(m, cfg, listener)
	m.mu.Lock()
	if m.stopping {
		m.mu.Unlock()
		_ = listener.Close()
		return errStopping
	}
	m.listeners[cfg.ID] = runtime
	delete(m.listenerError, cfg.ID)
	m.mu.Unlock()
	runtime.start()
	return nil
}

func (m *manager) collectInvalidLocked(listenerByID map[int64]*ListenerConfig, restartIDs map[int64]bool) []*connection {
	invalid := make([]*connection, 0)
	for _, conn := range m.conns {
		if restartIDs[conn.listenerID] || m.isInvalidLocked(conn, listenerByID) {
			invalid = append(invalid, conn)
		}
	}
	return invalid
}

func (m *manager) isInvalidLocked(conn *connection, listenerByID map[int64]*ListenerConfig) bool {
	listener := listenerByID[conn.listenerID]
	if listener == nil || !listener.Enabled {
		return true
	}
	if conn.direction == DirectionSource && listener.Role == RoleRover {
		return true
	}
	if conn.direction == DirectionRover && listener.Role == RoleSource {
		return true
	}
	mountpoint := listener.Mountpoints[conn.mountpointID]
	if mountpoint == nil || !mountpoint.Enabled {
		return true
	}
	if conn.accountID == nil {
		return mountpoint.RequiresAuth
	}
	account := m.accountsByID[*conn.accountID]
	if account == nil || !account.Enabled {
		return true
	}
	return !account.ACL[mountpoint.ID]
}

func (m *manager) accountByUsername(username string) *AccountConfig {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.accounts[username]
}

func (m *manager) canRegister(account *AccountConfig) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopping {
		return false
	}
	if account == nil {
		return true
	}
	count := 0
	for _, conn := range m.conns {
		if conn.accountID != nil && *conn.accountID == account.ID {
			count++
		}
	}
	return count < account.MaxConnections
}

func (m *manager) register(conn *connection, account *AccountConfig) error {
	baseCtx := m.optsContext()

	m.mu.Lock()
	if m.stopping {
		m.mu.Unlock()
		return errStopping
	}
	if account != nil {
		count := 0
		for _, existing := range m.conns {
			if existing.accountID != nil && *existing.accountID == account.ID {
				count++
			}
		}
		if count >= account.MaxConnections {
			m.mu.Unlock()
			return errMaxConns
		}
		accountID := account.ID
		conn.accountID = &accountID
		conn.accountUsername = account.Username
	}

	startCtx, cancel := context.WithTimeout(baseCtx, m.opts.DBTimeout)
	startID, err := m.runtime.Start(startCtx, StartInfo{
		ListenerID:   conn.listenerID,
		MountpointID: conn.mountpointID,
		AccountID:    conn.accountID,
		Direction:    conn.direction,
		RemoteAddr:   conn.remoteAddr,
		UserAgent:    conn.userAgent,
		Start:        conn.start,
	})
	cancel()
	if err != nil {
		log.Printf("[caster] runtime start failed: %v", err)
	}
	if startID <= 0 {
		m.syntheticID++
		startID = -m.syntheticID
	}
	conn.id = startID
	m.conns[conn.id] = conn
	m.mu.Unlock()
	return nil
}

func (m *manager) optsContext() context.Context {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rootCtx != nil {
		return m.rootCtx
	}
	return context.Background()
}

func (m *manager) connectionClosed(conn *connection, reason string) {
	m.mu.Lock()
	if m.conns[conn.id] == conn {
		delete(m.conns, conn.id)
	}
	m.mu.Unlock()

	if conn.direction == DirectionSource {
		rovers := conn.hub.removeSource(conn)
		for _, rover := range rovers {
			rover.closeWithReason("source_disconnected")
		}
	} else {
		conn.hub.removeRover(conn)
	}

	if conn.id > 0 {
		info := EndInfo{
			ID:               conn.id,
			End:              time.Now().UTC(),
			BytesIn:          conn.bytesIn.Load(),
			BytesOut:         conn.bytesOut.Load(),
			DisconnectReason: reason,
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), m.opts.DBTimeout)
			defer cancel()
			if err := m.runtime.End(ctx, info); err != nil {
				log.Printf("[caster] runtime end failed for connection %d: %v", info.ID, err)
			}
		}()
	}
}

func (m *manager) Connections() []ConnectionSnapshot {
	m.mu.Lock()
	conns := make([]*connection, 0, len(m.conns))
	for _, conn := range m.conns {
		conns = append(conns, conn)
	}
	m.mu.Unlock()

	sort.Slice(conns, func(i, j int) bool {
		if conns[i].start.Equal(conns[j].start) {
			return conns[i].id > conns[j].id
		}
		return conns[i].start.After(conns[j].start)
	})
	snapshots := make([]ConnectionSnapshot, 0, len(conns))
	for _, conn := range conns {
		snapshots = append(snapshots, conn.snapshot())
	}
	return snapshots
}

func (m *manager) Disconnect(id int64) bool {
	m.mu.Lock()
	conn := m.conns[id]
	m.mu.Unlock()
	if conn == nil {
		return false
	}
	conn.closeWithReason("manual")
	return true
}

func (m *manager) Listeners() []ListenerSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()

	snapshots := make([]ListenerSnapshot, 0, len(m.listenerCfgs))
	for _, cfg := range m.listenerCfgs {
		snapshot := ListenerSnapshot{
			ID:          cfg.ID,
			Name:        cfg.Name,
			Port:        cfg.Port,
			Role:        cfg.Role,
			Enabled:     cfg.Enabled,
			Mountpoints: len(cfg.Mountpoints),
			LastError:   m.listenerError[cfg.ID],
		}
		if runtime := m.listeners[cfg.ID]; runtime != nil {
			snapshot.Running = true
			snapshot.ActualPort = runtime.actualPort()
		}
		snapshots = append(snapshots, snapshot)
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].ID < snapshots[j].ID })
	return snapshots
}

func (m *manager) Shutdown(ctx context.Context) {
	m.mu.Lock()
	m.stopping = true
	listeners := make([]*listenerRuntime, 0, len(m.listeners))
	for _, runtime := range m.listeners {
		listeners = append(listeners, runtime)
	}
	conns := make([]*connection, 0, len(m.conns))
	for _, conn := range m.conns {
		conns = append(conns, conn)
	}
	m.mu.Unlock()

	for _, runtime := range listeners {
		runtime.stop()
	}
	for _, conn := range conns {
		conn.closeWithReason("service_restart")
	}

	m.mu.Lock()
	remaining := len(m.conns)
	m.mu.Unlock()
	deadline := time.Now().Add(2 * time.Second)
	for remaining > 0 && time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return
		case <-time.After(20 * time.Millisecond):
		}
		m.mu.Lock()
		remaining = len(m.conns)
		m.mu.Unlock()
	}

	done := make(chan struct{})
	go func() {
		m.connWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
	}
}

func (m *manager) monitorStats(mountpointID int64) rtcmStats {
	h := m.hubFor(mountpointID)
	if h == nil {
		return rtcmStats{}
	}
	stats := h.stats()
	return rtcmStats{
		Frames:       stats.Frames,
		CRCErrors:    stats.CRCErrors,
		LengthErrors: stats.LengthErrors,
		Dropped:      stats.Dropped,
	}
}

type rtcmStats struct {
	Frames       uint64
	CRCErrors    uint64
	LengthErrors uint64
	Dropped      uint64
}

func (m *manager) hubFor(mountpointID int64) *hub {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.hubs[mountpointID]
}
