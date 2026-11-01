package caster

import (
	"bufio"
	"errors"
	"net"
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
		lr.mgr.connWG.Add(1)
		go func() {
			defer lr.mgr.connWG.Done()
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
		_ = writeSourcetable(conn, req, lr.mgr.sourcetableMountpoints(req, cfg), host)
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
	account, code, reason := lr.mgr.authorize(req, mountpoint, cfg.ID)
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
	go c.roverReadLoop()
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
	account, code, reason := lr.mgr.authorize(req, mountpoint, cfg.ID)
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
	c.sourceReadLoop(req.bodyReader(br), lr.mgr.opts.ReadBuffer)
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

func (m *manager) sourcetableMountpoints(req *request, cfg *ListenerConfig) []*MountpointConfig {
	all := mountpointList(cfg)
	username, password, hasBasic := ParseBasic(req.Authorization)
	var account *AccountConfig
	if hasBasic {
		account = m.accountByUsername(username)
		if account != nil && (!account.Enabled || !VerifyPassword(account.PasswordHash, password)) {
			account = nil
		}
	}
	out := make([]*MountpointConfig, 0, len(all))
	for _, mountpoint := range all {
		if mountpoint == nil || !mountpoint.Enabled {
			continue
		}
		if account == nil || !account.ACL[mountpoint.ID] {
			continue
		}
		if len(account.ListenerACL) > 0 && !account.ListenerACL[cfg.ID] {
			continue
		}
		out = append(out, mountpoint)
	}
	return out
}

func (m *manager) authorize(req *request, mountpoint *MountpointConfig, listenerID int64) (*AccountConfig, int, string) {
	username, password, ok := ParseBasic(req.Authorization)
	if !ok {
		return nil, 401, "Unauthorized"
	}
	account := m.accountByUsername(username)
	if account == nil || !account.Enabled || !VerifyPassword(account.PasswordHash, password) {
		return nil, 401, "Unauthorized"
	}
	if !account.ACL[mountpoint.ID] {
		return nil, 403, "Forbidden"
	}
	if len(account.ListenerACL) > 0 && !account.ListenerACL[listenerID] {
		return nil, 403, "Forbidden"
	}
	return account, 0, ""
}
