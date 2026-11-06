package caster

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"

	"cors/gnss/internal/quality"
)

type Options struct {
	BindAddr            string
	PollInterval        time.Duration
	HeaderTimeout       time.Duration
	WriteTimeout        time.Duration
	SourceIdleTimeout   time.Duration
	RoverIdleTimeout    time.Duration
	SourceGrace         time.Duration
	DBTimeout           time.Duration
	ReadBuffer          int
	QueueSize           int
	MaxHeader           int
	MaxConnections      int
	MaxConnectionsPerIP int
	AllowedPorts        map[int]bool
	TLSCert             string
	TLSKey              string
	Quality             *quality.Analyzer
}

func DefaultOptions() Options {
	return Options{
		BindAddr:            "0.0.0.0",
		PollInterval:        10 * time.Second,
		HeaderTimeout:       10 * time.Second,
		WriteTimeout:        10 * time.Second,
		SourceIdleTimeout:   60 * time.Second,
		RoverIdleTimeout:    5 * time.Minute,
		SourceGrace:         10 * time.Second,
		DBTimeout:           3 * time.Second,
		ReadBuffer:          32 * 1024,
		QueueSize:           64,
		MaxHeader:           16 * 1024,
		MaxConnections:      500,
		MaxConnectionsPerIP: 200,
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
	if o.SourceIdleTimeout <= 0 {
		o.SourceIdleTimeout = defaults.SourceIdleTimeout
	}
	if o.SourceIdleTimeout < 5*time.Second {
		o.SourceIdleTimeout = 5 * time.Second
	}
	if o.RoverIdleTimeout <= 0 {
		o.RoverIdleTimeout = defaults.RoverIdleTimeout
	}
	if o.SourceGrace < 0 {
		o.SourceGrace = 0
	}
	if o.SourceGrace == 0 && defaults.SourceGrace > 0 {
		o.SourceGrace = defaults.SourceGrace
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
	errStopping      = errors.New("caster is stopping")
	errMaxConns      = errors.New("maximum connections reached")
	errSourceExists  = errors.New("mountpoint already has a source")
	errInvalidConfig = errors.New("configuration is no longer valid")
	errAuthRequired  = errors.New("authentication required")
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
	pending       map[int64]int
	pendingIP     map[string]int
	pendingTotal  int
	syntheticID   int64

	authFailures     map[string]*authFailure
	authGlobalCount  int
	authGlobalUntil  time.Time
	authGlobalWindow time.Time
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
		pending:       make(map[int64]int),
		pendingIP:     make(map[string]int),
		authFailures:  make(map[string]*authFailure),
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
	excess := m.excessConnectionsLocked()
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
	for _, conn := range excess {
		if !conn.isClosed() {
			conn.closeWithReason("max_connections")
		}
	}
	return nil
}

func (m *manager) startListener(cfg *ListenerConfig) error {
	if cfg.Port == 8081 {
		return fmt.Errorf("port %d is reserved", cfg.Port)
	}
	if len(m.opts.AllowedPorts) > 0 && !m.opts.AllowedPorts[cfg.Port] {
		return fmt.Errorf("port %d is not allowed", cfg.Port)
	}
	address := net.JoinHostPort(m.opts.BindAddr, strconv.Itoa(cfg.Port))
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	if m.opts.TLSCert != "" && m.opts.TLSKey != "" {
		cert, certErr := tls.LoadX509KeyPair(m.opts.TLSCert, m.opts.TLSKey)
		if certErr != nil {
			_ = listener.Close()
			return fmt.Errorf("load TLS cert: %w", certErr)
		}
		listener = tls.NewListener(listener, &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		})
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
		// Nguồn không xác thực: chỉ cho phép chiều publish khi mountpoint của
		// trạm được cấu hình caster_requires_auth=0. Chiều đọc luôn cần account.
		return !(conn.direction == DirectionSource && mountpoint.SourceNoAuth)
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
	remoteIP := remoteHost(conn.remoteAddr)
	if !m.reserveSlotLocked(remoteIP) {
		m.mu.Unlock()
		return errMaxConns
	}
	// Bất biến: connection rover bắt buộc có account đã xác thực. Không cho
	// phép tạo connection vô danh kể cả khi luồng gọi bị sai.
	if conn.direction == DirectionRover && account == nil {
		m.releaseSlotLocked(remoteIP)
		m.mu.Unlock()
		return errAuthRequired
	}
	if account != nil {
		count := m.accountConnsLocked(account.ID) + m.pending[account.ID]
		if count >= account.MaxConnections {
			m.releaseSlotLocked(remoteIP)
			m.mu.Unlock()
			return errMaxConns
		}
		m.pending[account.ID]++
		accountID := account.ID
		conn.accountID = &accountID
		conn.accountUsername = account.Username
	}
	if m.isInvalidLocked(conn, m.listenerCfgs) {
		if account != nil {
			m.releasePendingLocked(account.ID)
		}
		m.releaseSlotLocked(remoteIP)
		m.mu.Unlock()
		return errInvalidConfig
	}
	m.mu.Unlock()

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
		m.mu.Lock()
		m.syntheticID++
		startID = -m.syntheticID
		m.mu.Unlock()
	}
	conn.id = startID

	m.mu.Lock()
	if account != nil {
		m.releasePendingLocked(account.ID)
	}
	m.releaseSlotLocked(remoteIP)
	if m.stopping {
		m.mu.Unlock()
		if startID > 0 {
			endInfo := EndInfo{
				ID:               startID,
				End:              time.Now().UTC(),
				DisconnectReason: "service_stopping",
			}
			go func() {
				endCtx, endCancel := context.WithTimeout(context.Background(), m.opts.DBTimeout)
				defer endCancel()
				if endErr := m.runtime.End(endCtx, endInfo); endErr != nil {
					log.Printf("[caster] runtime end failed for connection %d: %v", endInfo.ID, endErr)
				}
			}()
		}
		return errStopping
	}
	m.conns[conn.id] = conn
	m.mu.Unlock()
	return nil
}

func (m *manager) accountConnsLocked(accountID int64) int {
	count := 0
	for _, existing := range m.conns {
		if existing.accountID != nil && *existing.accountID == accountID {
			count++
		}
	}
	return count
}

func remoteHost(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

func (m *manager) reserveSlotLocked(ip string) bool {
	total := len(m.conns) + m.pendingTotal
	if m.opts.MaxConnections > 0 && total >= m.opts.MaxConnections {
		return false
	}
	if m.opts.MaxConnectionsPerIP > 0 && m.ipConnsLocked(ip)+m.pendingIP[ip] >= m.opts.MaxConnectionsPerIP {
		return false
	}
	m.pendingTotal++
	m.pendingIP[ip]++
	return true
}

func (m *manager) releaseSlotLocked(ip string) {
	if m.pendingTotal > 0 {
		m.pendingTotal--
	}
	if m.pendingIP[ip] <= 1 {
		delete(m.pendingIP, ip)
		return
	}
	m.pendingIP[ip]--
}

func (m *manager) ipConnsLocked(ip string) int {
	count := 0
	for _, existing := range m.conns {
		if remoteHost(existing.remoteAddr) == ip {
			count++
		}
	}
	return count
}

func (m *manager) releasePendingLocked(accountID int64) {
	if m.pending[accountID] <= 1 {
		delete(m.pending, accountID)
		return
	}
	m.pending[accountID]--
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
		conn.hub.detachSource(conn)
		if m.opts.SourceGrace <= 0 {
			for _, rover := range conn.hub.takeRoversIfNoSource() {
				rover.closeWithReason("source_disconnected")
			}
		} else {
			grace := m.opts.SourceGrace
			time.AfterFunc(grace, func() {
				if conn.hub.hasSource() {
					return
				}
				for _, rover := range conn.hub.takeRoversIfNoSource() {
					rover.closeWithReason("source_disconnected")
				}
			})
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

func (m *manager) DisconnectAccount(accountID int64, reason string) int {
	m.mu.Lock()
	conns := make([]*connection, 0)
	for _, conn := range m.conns {
		if conn.accountID != nil && *conn.accountID == accountID {
			conns = append(conns, conn)
		}
	}
	m.mu.Unlock()
	for _, conn := range conns {
		conn.closeWithReason(reason)
	}
	return len(conns)
}

func (m *manager) DisconnectMountpoint(mountpointID int64, reason string) int {
	m.mu.Lock()
	conns := make([]*connection, 0)
	for _, conn := range m.conns {
		if conn.mountpointID == mountpointID {
			conns = append(conns, conn)
		}
	}
	m.mu.Unlock()
	for _, conn := range conns {
		conn.closeWithReason(reason)
	}
	return len(conns)
}

func (m *manager) DisconnectListener(listenerID int64, reason string) int {
	m.mu.Lock()
	conns := make([]*connection, 0)
	for _, conn := range m.conns {
		if conn.listenerID == listenerID {
			conns = append(conns, conn)
		}
	}
	m.mu.Unlock()
	for _, conn := range conns {
		conn.closeWithReason(reason)
	}
	return len(conns)
}

func (m *manager) excessConnectionsLocked() []*connection {
	byAccount := make(map[int64][]*connection)
	for _, conn := range m.conns {
		if conn.accountID == nil {
			continue
		}
		byAccount[*conn.accountID] = append(byAccount[*conn.accountID], conn)
	}
	excess := make([]*connection, 0)
	for accountID, conns := range byAccount {
		account := m.accountsByID[accountID]
		if account == nil || len(conns) <= account.MaxConnections {
			continue
		}
		sort.Slice(conns, func(i, j int) bool {
			return conns[i].start.Before(conns[j].start)
		})
		for index := account.MaxConnections; index < len(conns); index++ {
			excess = append(excess, conns[index])
		}
	}
	return excess
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

type stationTapReader struct {
	hub *hub
	tap *stationTap
}

func (r *stationTapReader) Read(p []byte) (int, error) {
	return r.tap.Read(p)
}

func (r *stationTapReader) Close() error {
	r.hub.removeTap(r.tap)
	return nil
}

// OpenStationTap mở luồng đọc trực tiếp byte source của mountpoint nội bộ.
// Dùng cho relay chọn trạm nguồn: không cần NTRIP account và không đi qua
// listener TCP của caster.
func (m *manager) OpenStationTap(mountpointID int64) (io.ReadCloser, error) {
	h := m.hubFor(mountpointID)
	if h == nil {
		return nil, errNoSource
	}
	tap, err := h.openTap()
	if err != nil {
		return nil, err
	}
	return &stationTapReader{hub: h, tap: tap}, nil
}
