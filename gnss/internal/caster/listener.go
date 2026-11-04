package caster

import (
	"bufio"
	"errors"
	"log"
	"net"
	"sort"
	"strings"
	"sync"
	"time"
)

type listenerRuntime struct {
	mgr *manager
	ln  net.Listener

	mu     sync.Mutex
	cfg    *ListenerConfig
	closed bool
}

func newListenerRuntime(mgr *manager, cfg *ListenerConfig, ln net.Listener) *listenerRuntime {
	return &listenerRuntime{mgr: mgr, cfg: cfg, ln: ln}
}

func (lr *listenerRuntime) start() {
	go lr.serve()
}

func (lr *listenerRuntime) serve() {
	for {
		conn, err := lr.ln.Accept()
		if err != nil {
			return
		}
		if tcp, ok := conn.(*net.TCPConn); ok {
			_ = tcp.SetKeepAlive(true)
			_ = tcp.SetKeepAlivePeriod(30 * time.Second)
		}
		lr.mgr.connWG.Add(1)
		go func() {
			defer lr.mgr.connWG.Done()
			defer func() {
				if recovered := recover(); recovered != nil {
					log.Printf("[caster] connection panic: %v", recovered)
				}
			}()
			lr.handle(conn)
		}()
	}
}

func (lr *listenerRuntime) handle(conn net.Conn) {
	defer conn.Close()
	if lr.isClosed() {
		return
	}

	_ = conn.SetReadDeadline(time.Now().Add(lr.mgr.opts.HeaderTimeout))
	req, br, err := readRequest(conn, lr.mgr.opts.MaxHeader)
	_ = conn.SetReadDeadline(time.Time{})
	if err != nil {
		if errors.Is(err, errHeaderTooLarge) {
			_ = writeRequestError(conn, nil, 431, "Request Header Fields Too Large")
			return
		}
		_ = writeRequestError(conn, nil, 400, "Bad Request")
		return
	}

	cfg := lr.config()
	if req.Mount == "" || req.Path == "/" {
		if req.Method != "GET" {
			_ = writeRequestError(conn, req, 405, "Method Not Allowed")
			return
		}
		host := truncate(req.Header["host"], 160)
		if host == "" {
			host = cfg.Name
		}
		_ = writeSourcetable(conn, req, lr.mgr.sourcetableMountpoints(cfg), host)
		return
	}

	switch req.Method {
	case "GET":
		lr.handleRover(conn, br, req, cfg)
	case "SOURCE", "POST":
		lr.handleSource(conn, br, req, cfg)
	default:
		_ = writeRequestError(conn, req, 405, "Method Not Allowed")
	}
}

func (lr *listenerRuntime) handleRover(conn net.Conn, br *bufio.Reader, req *request, cfg *ListenerConfig) {
	if cfg.Role == RoleSource {
		_ = writeRequestError(conn, req, 403, "Forbidden")
		return
	}
	mountpoint := findMountpoint(cfg, req.Mount)
	if mountpoint == nil || !mountpoint.Enabled {
		_ = writeRequestError(conn, req, 404, "Not Found")
		return
	}
	account, code, reason := lr.mgr.authorize(req, mountpoint, cfg, remoteHost(conn.RemoteAddr().String()))
	if code != 0 {
		if code == 401 {
			_ = writeAuthRequired(conn, req)
		} else {
			_ = writeRequestError(conn, req, code, reason)
		}
		return
	}

	h := lr.mgr.hubFor(mountpoint.ID)
	if h == nil {
		_ = writeRequestError(conn, req, 404, "Not Found")
		return
	}

	c := &connection{
		direction:    DirectionRover,
		listenerID:   cfg.ID,
		mountpointID: mountpoint.ID,
		remoteAddr:   truncate(conn.RemoteAddr().String(), 64),
		userAgent:    req.UserAgent,
		start:        time.Now().UTC(),
		conn:         conn,
		br:           br,
		hub:          h,
		mgr:          lr.mgr,
		sendCh:       make(chan []byte, lr.mgr.opts.QueueSize),
		done:         make(chan struct{}),
	}
	if err := lr.mgr.register(c, account); err != nil {
		if errors.Is(err, errMaxConns) {
			_ = writeRequestError(conn, req, 503, "Maximum Connections Reached")
		} else {
			_ = writeRequestError(conn, req, 503, "Service Unavailable")
		}
		return
	}
	if !h.addRover(c) {
		c.closeWithReason("config_changed")
		return
	}
	if err := writeSuccess(conn, req); err != nil {
		c.closeWithReason("network")
		return
	}

	go c.roverWriteLoop(lr.mgr.opts.WriteTimeout)
	go c.roverReadLoop(lr.mgr.opts.RoverIdleTimeout)
	<-c.done
}

func (lr *listenerRuntime) handleSource(conn net.Conn, br *bufio.Reader, req *request, cfg *ListenerConfig) {
	if cfg.Role == RoleRover {
		_ = writeRequestError(conn, req, 403, "Forbidden")
		return
	}
	mountpoint := findMountpoint(cfg, req.Mount)
	if mountpoint == nil || !mountpoint.Enabled {
		_ = writeRequestError(conn, req, 404, "Not Found")
		return
	}
	var account *AccountConfig
	if !mountpoint.SourceNoAuth {
		var code int
		var reason string
		account, code, reason = lr.mgr.authorize(req, mountpoint, cfg, remoteHost(conn.RemoteAddr().String()))
		if code != 0 {
			if code == 401 {
				_ = writeAuthRequired(conn, req)
			} else {
				_ = writeRequestError(conn, req, code, reason)
			}
			return
		}
	}

	h := lr.mgr.hubFor(mountpoint.ID)
	if h == nil {
		_ = writeRequestError(conn, req, 404, "Not Found")
		return
	}
	if h.hasSource() {
		_ = writeRequestError(conn, req, 409, "Conflict")
		return
	}

	c := &connection{
		direction:    DirectionSource,
		listenerID:   cfg.ID,
		mountpointID: mountpoint.ID,
		remoteAddr:   truncate(conn.RemoteAddr().String(), 64),
		userAgent:    req.UserAgent,
		start:        time.Now().UTC(),
		conn:         conn,
		br:           br,
		hub:          h,
		mgr:          lr.mgr,
		done:         make(chan struct{}),
	}
	if err := lr.mgr.register(c, account); err != nil {
		if errors.Is(err, errMaxConns) {
			_ = writeRequestError(conn, req, 503, "Maximum Connections Reached")
		} else {
			_ = writeRequestError(conn, req, 503, "Service Unavailable")
		}
		return
	}
	if !h.addSource(c) {
		c.closeWithReason("source_busy")
		return
	}
	if err := writeSuccess(conn, req); err != nil {
		c.closeWithReason("network")
		return
	}
	c.sourceReadLoop(req.bodyReader(br), lr.mgr.opts.ReadBuffer, lr.mgr.opts.SourceIdleTimeout)
}

func (lr *listenerRuntime) isClosed() bool {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	return lr.closed
}

func (lr *listenerRuntime) config() *ListenerConfig {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	return lr.cfg
}

func (lr *listenerRuntime) updateConfig(cfg *ListenerConfig) {
	lr.mu.Lock()
	lr.cfg = cfg
	lr.mu.Unlock()
}

func (lr *listenerRuntime) needsRestart(cfg *ListenerConfig) bool {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	return lr.cfg.Port != cfg.Port || lr.cfg.Role != cfg.Role || !cfg.Enabled
}

func (lr *listenerRuntime) actualPort() int {
	if tcp, ok := lr.ln.Addr().(*net.TCPAddr); ok {
		return tcp.Port
	}
	return lr.config().Port
}

func (lr *listenerRuntime) stop() {
	lr.mu.Lock()
	if lr.closed {
		lr.mu.Unlock()
		return
	}
	lr.closed = true
	lr.mu.Unlock()
	_ = lr.ln.Close()
}

func findMountpoint(cfg *ListenerConfig, name string) *MountpointConfig {
	for _, mountpoint := range cfg.Mountpoints {
		if mountpoint.Name == name {
			return mountpoint
		}
	}
	return nil
}

func mountpointList(cfg *ListenerConfig) []*MountpointConfig {
	mountpoints := make([]*MountpointConfig, 0, len(cfg.Mountpoints))
	for _, mountpoint := range cfg.Mountpoints {
		mountpoints = append(mountpoints, mountpoint)
	}
	return mountpoints
}

func (m *manager) sourcetableMountpoints(cfg *ListenerConfig) []*MountpointConfig {
	all := mountpointList(cfg)
	out := make([]*MountpointConfig, 0, len(all))
	for _, mountpoint := range all {
		if mountpoint == nil || !mountpoint.Enabled {
			continue
		}
		out = append(out, mountpoint)
	}
	// Map iteration không ổn định; sourcetable phải trả theo thứ tự ABC để
	// client/rover và công cụ so sánh nhận được danh sách nhất quán.
	sort.SliceStable(out, func(i, j int) bool {
		left := strings.ToLower(out[i].Name)
		right := strings.ToLower(out[j].Name)
		if left == right {
			return out[i].ID < out[j].ID
		}
		return left < right
	})
	return out
}

func (m *manager) authorize(req *request, mountpoint *MountpointConfig, listener *ListenerConfig, remoteIP string) (*AccountConfig, int, string) {
	username, password, ok := ParseBasic(req.Authorization)
	if !ok {
		m.recordAuthFailure("", remoteIP)
		return nil, 401, "Unauthorized"
	}
	if retryAfter := m.authBlockedFor(username, remoteIP); retryAfter > 0 {
		return nil, 429, "Too Many Requests"
	}
	account := m.accountByUsername(username)
	if account == nil || !account.Enabled || !VerifyPassword(account.PasswordHash, password) {
		m.recordAuthFailure(username, remoteIP)
		return nil, 401, "Unauthorized"
	}
	m.clearAuthFailure(username, remoteIP)
	if listener.CompanyID != nil {
		if account.CompanyID == nil || *account.CompanyID != *listener.CompanyID {
			return nil, 403, "Forbidden"
		}
	}
	if !account.ACL[mountpoint.ID] {
		return nil, 403, "Forbidden"
	}
	if len(account.ListenerACL) > 0 && !account.ListenerACL[listener.ID] {
		return nil, 403, "Forbidden"
	}
	return account, 0, ""
}

// authFailure theo dõi số lần sai liên tiếp của cặp (username, IP).
type authFailure struct {
	count int
	until time.Time
}

const (
	authFailThreshold = 5
	authFailGlobalMax = 100
)

func authKey(username, ip string) string {
	return username + "|" + ip
}

// authBlockedFor trả thời gian còn phải chờ nếu cặp (username, IP) hoặc toàn
// cục đang bị chặn; chỉ áp dụng cho các lần xác thực sai.
func (m *manager) authBlockedFor(username, ip string) time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	if now.Before(m.authGlobalUntil) {
		return m.authGlobalUntil.Sub(now)
	}
	failure := m.authFailures[authKey(username, ip)]
	if failure == nil {
		return 0
	}
	if now.After(failure.until) {
		delete(m.authFailures, authKey(username, ip))
		return 0
	}
	return failure.until.Sub(now)
}

func (m *manager) recordAuthFailure(username, ip string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	if now.Sub(m.authGlobalWindow) > time.Minute {
		m.authGlobalWindow = now
		m.authGlobalCount = 0
	}
	m.authGlobalCount++
	if m.authGlobalCount >= authFailGlobalMax {
		m.authGlobalUntil = now.Add(10 * time.Second)
		m.authGlobalCount = 0
	}

	key := authKey(username, ip)
	failure := m.authFailures[key]
	if failure == nil {
		failure = &authFailure{}
		m.authFailures[key] = failure
	}
	failure.count++
	if failure.count >= authFailThreshold {
		exponent := failure.count - authFailThreshold
		if exponent > 4 {
			exponent = 4
		}
		backoff := 5 * time.Second * time.Duration(1<<exponent)
		if backoff > time.Minute {
			backoff = time.Minute
		}
		failure.until = now.Add(backoff)
	}
}

func (m *manager) clearAuthFailure(username, ip string) {
	m.mu.Lock()
	delete(m.authFailures, authKey(username, ip))
	m.mu.Unlock()
}
