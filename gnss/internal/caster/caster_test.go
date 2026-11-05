package caster

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"cors/gnss/internal/quality"
	"golang.org/x/crypto/argon2"
)

type memoryStore struct {
	cfg *Config
}

func (s *memoryStore) LoadConfig(context.Context) (*Config, error) {
	return s.cfg, nil
}

type memoryRuntime struct {
	mu     sync.Mutex
	nextID int64
	starts []StartInfo
	ends   []EndInfo
}

func (r *memoryRuntime) Start(_ context.Context, info StartInfo) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	r.starts = append(r.starts, info)
	return r.nextID, nil
}

func (r *memoryRuntime) End(_ context.Context, info EndInfo) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ends = append(r.ends, info)
	return nil
}

func passwordHash(password string) string {
	salt := []byte("0123456789abcdef")
	key := argon2.IDKey([]byte(password), salt, 2, 64*1024, 1, 32)
	return fmt.Sprintf(
		"$argon2id$v=19$m=65536,t=2,p=1$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)
}

func newTestManager(t *testing.T, cfg *Config) (*manager, *memoryRuntime) {
	return newTestManagerWithOptions(t, cfg, Options{
		BindAddr:      "127.0.0.1",
		PollInterval:  time.Hour,
		HeaderTimeout: 2 * time.Second,
		WriteTimeout:  2 * time.Second,
		DBTimeout:     time.Second,
		ReadBuffer:    1024,
		QueueSize:     4,
		MaxHeader:     8192,
	})
}

func newTestManagerWithOptions(t *testing.T, cfg *Config, options Options) (*manager, *memoryRuntime) {
	t.Helper()
	if len(cfg.Accounts) == 0 {
		acl := make(map[int64]bool, len(cfg.Mountpoints))
		for id := range cfg.Mountpoints {
			acl[id] = true
		}
		cfg.Accounts = []*AccountConfig{{
			ID:             9000,
			Username:       "test",
			PasswordHash:   passwordHash("test"),
			Enabled:        true,
			MaxConnections: 100,
			ACL:            acl,
		}}
	}
	runtime := &memoryRuntime{}
	manager := NewManager(&memoryStore{cfg: cfg}, runtime, options)
	if err := manager.Reconcile(context.Background()); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		manager.Shutdown(ctx)
	})
	return manager, runtime
}

func listenerPort(t *testing.T, manager *manager, id int64) int {
	t.Helper()
	for _, listener := range manager.Listeners() {
		if listener.ID == id {
			if !listener.Running || listener.ActualPort == 0 {
				t.Fatalf("listener %d not running: %+v", id, listener)
			}
			return listener.ActualPort
		}
	}
	t.Fatalf("listener %d not found", id)
	return 0
}

func connect(t *testing.T, port int, request string) (net.Conn, *bufio.Reader, string) {
	t.Helper()
	if !strings.Contains(request, "Authorization:") {
		auth := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("test:test")) + "\r\n"
		if index := strings.Index(request, "\r\n"); index >= 0 {
			request = request[:index+2] + auth + request[index+2:]
		}
	}
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.WriteString(conn, request); err != nil {
		conn.Close()
		t.Fatalf("write request: %v", err)
	}
	reader := bufio.NewReader(conn)
	status, err := reader.ReadString('\n')
	if err != nil {
		conn.Close()
		t.Fatalf("read status: %v", err)
	}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			conn.Close()
			t.Fatalf("read headers: %v", err)
		}
		if strings.TrimSpace(line) == "" {
			break
		}
	}
	return conn, reader, strings.TrimSpace(status)
}

func TestSourceRoverByteExactV1(t *testing.T) {
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	source, _, status := connect(t, port, "SOURCE /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("source status = %q", status)
	}
	defer source.Close()

	rover, reader, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("rover status = %q", status)
	}
	defer rover.Close()

	payload := []byte("RTCM-DATA-1234")
	if _, err := source.Write(payload); err != nil {
		t.Fatalf("source write: %v", err)
	}
	got := make([]byte, len(payload))
	if _, err := io.ReadFull(reader, got); err != nil {
		t.Fatalf("rover read: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("payload = %q", got)
	}
}

func TestSourceRoverV2Chunked(t *testing.T) {
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	source, _, status := connect(t, port, "POST /M HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n")
	if status != "HTTP/1.1 200 OK" {
		t.Fatalf("source status = %q", status)
	}
	defer source.Close()

	rover, reader, status := connect(t, port, "GET /M HTTP/1.1\r\nHost: x\r\nNtrip-Version: Ntrip/2.0\r\n\r\n")
	if status != "HTTP/1.1 200 OK" {
		t.Fatalf("rover status = %q", status)
	}
	defer rover.Close()

	payload := []byte("V2-CHUNKED")
	if _, err := fmt.Fprintf(source, "%x\r\n%s\r\n", len(payload), payload); err != nil {
		t.Fatalf("source chunk: %v", err)
	}
	got := make([]byte, len(payload))
	if _, err := io.ReadFull(reader, got); err != nil {
		t.Fatalf("rover read: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("payload = %q", got)
	}
}

func TestAuthACLAndMaxConnections(t *testing.T) {
	hash := passwordHash("secret123")
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Accounts: []*AccountConfig{
			{ID: 1, Username: "ok", PasswordHash: hash, Enabled: true, MaxConnections: 1, ACL: map[int64]bool{1: true}},
			{ID: 2, Username: "noacl", PasswordHash: hash, Enabled: true, MaxConnections: 2, ACL: map[int64]bool{}},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	_, _, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 401 Unauthorized" {
		t.Fatalf("no auth status = %q", status)
	}
	_, _, status = connect(t, port, "GET /M HTTP/1.0\r\nAuthorization: Basic "+base64.StdEncoding.EncodeToString([]byte("ok:wrong"))+"\r\n\r\n")
	if status != "ICY 401 Unauthorized" {
		t.Fatalf("wrong password status = %q", status)
	}
	_, _, status = connect(t, port, "GET /M HTTP/1.0\r\nAuthorization: Basic "+base64.StdEncoding.EncodeToString([]byte("noacl:secret123"))+"\r\n\r\n")
	if status != "ICY 403 Forbidden" {
		t.Fatalf("no acl status = %q", status)
	}

	first, _, status := connect(t, port, "GET /M HTTP/1.1\r\nHost: x\r\nNtrip-Version: Ntrip/2.0\r\nAuthorization: Basic "+base64.StdEncoding.EncodeToString([]byte("ok:secret123"))+"\r\n\r\n")
	if status != "HTTP/1.1 200 OK" {
		t.Fatalf("authorized v2 status = %q", status)
	}
	defer first.Close()
	_, _, status = connect(t, port, "GET /M HTTP/1.0\r\nAuthorization: Basic "+base64.StdEncoding.EncodeToString([]byte("ok:secret123"))+"\r\n\r\n")
	if status != "ICY 503 Maximum Connections Reached" {
		t.Fatalf("max conn status = %q", status)
	}
}

func TestListenerACLAndSourcetable(t *testing.T) {
	hash := passwordHash("secret123")
	m1 := &MountpointConfig{ID: 1, Name: "M1", Enabled: true}
	m2 := &MountpointConfig{ID: 2, Name: "M2", Enabled: true}
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{1: m1, 2: m2},
		Accounts: []*AccountConfig{{
			ID:             1,
			Username:       "ok",
			PasswordHash:   hash,
			Enabled:        true,
			MaxConnections: 2,
			ACL:            map[int64]bool{1: true, 2: true},
			ListenerACL:    map[int64]bool{1: true},
		}},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "l1", Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: m1}},
			{ID: 2, Name: "l2", Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{2: m2}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte("ok:secret123"))

	if _, code, _ := manager.authorize(&request{Authorization: auth}, m2, cfg.Listeners[1], "127.0.0.1"); code != 403 {
		t.Fatalf("listener acl code = %d, want 403", code)
	}
	if _, code, _ := manager.authorize(&request{Authorization: auth}, m1, cfg.Listeners[0], "127.0.0.1"); code != 0 {
		t.Fatalf("allowed listener code = %d, want 0", code)
	}
	allowed := manager.sourcetableMountpoints(cfg.Listeners[0])
	if len(allowed) != 1 || allowed[0].Name != "M1" {
		t.Fatalf("sourcetable listener1 = %+v", allowed)
	}
	blocked := manager.sourcetableMountpoints(cfg.Listeners[1])
	if len(blocked) != 1 || blocked[0].Name != "M2" {
		t.Fatalf("sourcetable listener2 = %+v", blocked)
	}
	anonymous := manager.sourcetableMountpoints(cfg.Listeners[0])
	if len(anonymous) != 1 || anonymous[0].Name != "M1" {
		t.Fatalf("anonymous sourcetable = %+v", anonymous)
	}
}

func TestSourcetableMountpointsSortedABC(t *testing.T) {
	cfg := &ListenerConfig{Mountpoints: map[int64]*MountpointConfig{
		1: {ID: 1, Name: "zeta", Enabled: true},
		2: {ID: 2, Name: "Alpha", Enabled: true},
		3: {ID: 3, Name: "beta", Enabled: true},
		4: {ID: 4, Name: "disabled", Enabled: false},
	}}
	m := &manager{}
	got := m.sourcetableMountpoints(cfg)
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	for i, want := range []string{"Alpha", "beta", "zeta"} {
		if got[i].Name != want {
			t.Fatalf("order[%d] = %q, want %q", i, got[i].Name, want)
		}
	}
}

func TestAuthorizeRequiresSameCompany(t *testing.T) {
	mountpoint := &MountpointConfig{ID: 1, Name: "M1", Enabled: true}
	listenerCompany := int64(85)
	accountCompany := int64(87)
	account := &AccountConfig{
		ID:             1,
		Username:       "other-company",
		PasswordHash:   passwordHash("secret123"),
		Enabled:        true,
		MaxConnections: 1,
		CompanyID:      &accountCompany,
		ACL:            map[int64]bool{1: true},
	}
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		Accounts:    []*AccountConfig{account},
		Listeners: []*ListenerConfig{{
			ID:          1,
			Name:        "wally",
			Port:        1509,
			Enabled:     true,
			Role:        RoleBoth,
			CompanyID:   &listenerCompany,
			Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		}},
	}
	manager, _ := newTestManager(t, cfg)
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte("other-company:secret123"))
	if _, code, _ := manager.authorize(&request{Authorization: auth}, mountpoint, cfg.Listeners[0], "127.0.0.1"); code != 403 {
		t.Fatalf("cross-company authorize code = %d, want 403", code)
	}
}

func TestStartListenerRejectsPortOutsideAllowlist(t *testing.T) {
	manager, _ := newTestManagerWithOptions(t, &Config{}, Options{
		BindAddr:     "127.0.0.1",
		AllowedPorts: map[int]bool{1509: true},
	})
	err := manager.startListener(&ListenerConfig{ID: 1, Port: 1600, Enabled: true})
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("startListener err = %v, want not allowed", err)
	}
}

func TestLegacySourceRequestLine(t *testing.T) {
	mountpoint := &MountpointConfig{ID: 1, Name: "M", Enabled: true, SourceNoAuth: true}
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: mountpoint}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	source, _, status := connect(t, port, "SOURCE 123456 M\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("legacy source status = %q, want ICY 200 OK", status)
	}
	_ = source.Close()
}

func TestAnonymousSourceRejected(t *testing.T) {
	mountpoint := &MountpointConfig{ID: 1, Name: "M", Enabled: true}
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: mountpoint}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	_, _, status := connect(t, port, "GET /M HTTP/1.0\r\nAuthorization: Basic "+
		base64.StdEncoding.EncodeToString([]byte("unknown:secret"))+"\r\n\r\n")
	if status != "ICY 401 Unauthorized" {
		t.Fatalf("unknown account status = %q", status)
	}
}

func TestSourceNoAuthAllowsPublishButReaderStillRequiresAccount(t *testing.T) {
	mountpoint := &MountpointConfig{ID: 1, Name: "M", Enabled: true, SourceNoAuth: true}
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: mountpoint}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	// Basic rỗng: mô phỏng client không có thông tin đăng nhập (connect() tự
	// thêm test:test nếu không thấy header Authorization).
	source, _, status := connect(t, port, "SOURCE /M HTTP/1.0\r\nAuthorization: Basic \r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("no-auth source status = %q", status)
	}
	source.Close()

	source, _, status = connect(t, port, "SOURCE /M HTTP/1.0\r\nAuthorization: Basic "+
		base64.StdEncoding.EncodeToString([]byte("random:password"))+"\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("random-credential source status = %q", status)
	}
	source.Close()

	if _, _, status := connect(t, port, "GET /M HTTP/1.0\r\nAuthorization: Basic \r\n\r\n"); status != "ICY 401 Unauthorized" {
		t.Fatalf("reader without account status = %q", status)
	}
	if _, _, status := connect(t, port, "GET /M HTTP/1.0\r\nAuthorization: Basic "+
		base64.StdEncoding.EncodeToString([]byte("random:password"))+"\r\n\r\n"); status != "ICY 401 Unauthorized" {
		t.Fatalf("reader with unknown account status = %q", status)
	}
}

func TestSourceAuthRequiredRejectsAnonymousPublish(t *testing.T) {
	mountpoint := &MountpointConfig{ID: 1, Name: "M", Enabled: true}
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: mountpoint}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	if _, _, status := connect(t, port, "SOURCE /M HTTP/1.0\r\nAuthorization: Basic \r\n\r\n"); status != "ICY 401 Unauthorized" {
		t.Fatalf("anonymous source status = %q", status)
	}
}

func TestListenerGroupsAndSourcetable(t *testing.T) {
	mountpoint := &MountpointConfig{ID: 1, Name: "M", Enabled: true}
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "a", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: mountpoint}},
			{ID: 2, Name: "b", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: mountpoint}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port1 := listenerPort(t, manager, 1)
	port2 := listenerPort(t, manager, 2)
	if port1 == port2 {
		t.Fatalf("listener ports should differ: %d", port1)
	}

	for _, port := range []int{port1, port2} {
		conn, reader, status := connect(t, port, "GET / HTTP/1.0\r\n\r\n")
		if status != "SOURCETABLE 200 OK" {
			t.Fatalf("sourcetable status = %q", status)
		}
		body, _ := io.ReadAll(reader)
		conn.Close()
		if !strings.Contains(string(body), "STR;M;") {
			t.Fatalf("sourcetable missing mountpoint: %s", body)
		}
	}
}

func TestSourceReconnectReplacesStaleSource(t *testing.T) {
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, runtime := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	first, _, status := connect(t, port, "SOURCE /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("first source status = %q", status)
	}
	defer first.Close()

	rover, roverReader, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("rover status = %q", status)
	}
	defer rover.Close()

	// Trạm reconnect khi kết nối cũ còn half-open: source mới phải được nhận
	// ngay, không bị 409/503 chờ hết SourceIdleTimeout.
	second, _, status := connect(t, port, "SOURCE /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("second source status = %q, want ICY 200 OK", status)
	}
	defer second.Close()

	// Source cũ phải bị đóng, không còn treo tới 60s.
	_ = first.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := first.Read(make([]byte, 1)); err == nil {
		t.Fatal("old source vẫn mở sau khi bị thay thế")
	} else if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		t.Fatal("old source không bị đóng, chỉ hết read deadline")
	}

	payload := []byte{0xD3, 0x00, 0x03, 0x40, 0x00, 0x00}
	if _, err := second.Write(payload); err != nil {
		t.Fatalf("second source write: %v", err)
	}
	buf := make([]byte, len(payload))
	_ = rover.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := io.ReadFull(roverReader, buf); err != nil {
		t.Fatalf("rover read after source replacement: %v", err)
	}
	if !bytes.Equal(buf, payload) {
		t.Fatalf("rover payload = %x, want %x", buf, payload)
	}

	connections := manager.Connections()
	sources, rovers := 0, 0
	for _, conn := range connections {
		switch conn.Direction {
		case DirectionSource:
			sources++
		case DirectionRover:
			rovers++
		}
	}
	if sources != 1 || rovers != 1 {
		t.Fatalf("connections source=%d rover=%d, want 1/1", sources, rovers)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		runtime.mu.Lock()
		found := false
		for _, end := range runtime.ends {
			if end.DisconnectReason == "source_replaced" {
				found = true
				break
			}
		}
		runtime.mu.Unlock()
		if found {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("không thấy end reason source_replaced")
}

func TestMultiClientFanout(t *testing.T) {
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	source, _, status := connect(t, port, "SOURCE /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("source status = %q", status)
	}
	defer source.Close()

	rovers := make([]net.Conn, 0, 3)
	readers := make([]*bufio.Reader, 0, 3)
	for i := 0; i < 3; i++ {
		conn, reader, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
		if status != "ICY 200 OK" {
			t.Fatalf("rover %d status = %q", i, status)
		}
		defer conn.Close()
		rovers = append(rovers, conn)
		readers = append(readers, reader)
	}

	payload := []byte("FANOUT")
	if _, err := source.Write(payload); err != nil {
		t.Fatalf("source write: %v", err)
	}
	for i, reader := range readers {
		got := make([]byte, len(payload))
		if _, err := io.ReadFull(reader, got); err != nil {
			t.Fatalf("rover %d read: %v", i, err)
		}
		if string(got) != string(payload) {
			t.Fatalf("rover %d payload = %q", i, got)
		}
	}
}

func TestSlowClientDropped(t *testing.T) {
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, runtime := newTestManagerWithOptions(t, cfg, Options{
		BindAddr:      "127.0.0.1",
		PollInterval:  time.Hour,
		HeaderTimeout: 2 * time.Second,
		WriteTimeout:  50 * time.Millisecond,
		DBTimeout:     time.Second,
		ReadBuffer:    512,
		QueueSize:     1,
		MaxHeader:     8192,
	})
	port := listenerPort(t, manager, 1)

	source, _, status := connect(t, port, "SOURCE /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("source status = %q", status)
	}
	defer source.Close()
	rover, _, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("rover status = %q", status)
	}
	defer rover.Close()

	chunk := make([]byte, 4096)
	for i := 0; i < 64; i++ {
		if _, err := source.Write(chunk); err != nil {
			t.Fatalf("source write: %v", err)
		}
	}
	time.Sleep(200 * time.Millisecond)

	runtime.mu.Lock()
	ends := append([]EndInfo(nil), runtime.ends...)
	runtime.mu.Unlock()
	found := false
	for _, end := range ends {
		if end.DisconnectReason == "slow_client" {
			found = true
		}
	}
	if !found {
		t.Fatalf("slow client was not dropped; ends=%+v", ends)
	}
}

func Test6T3ByteExactWithQualityAnalyzer(t *testing.T) {
	analyzer := quality.NewAnalyzer(quality.Options{QueueSize: 64}, nil)
	analyzerCtx, analyzerCancel := context.WithCancel(context.Background())
	go analyzer.Run(analyzerCtx)
	defer func() {
		analyzerCancel()
		analyzer.Shutdown()
	}()

	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", StationID: 99, Enabled: true},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", StationID: 99, Enabled: true}}},
		},
	}
	manager, _ := newTestManagerWithOptions(t, cfg, Options{
		BindAddr:      "127.0.0.1",
		PollInterval:  time.Hour,
		HeaderTimeout: 2 * time.Second,
		WriteTimeout:  2 * time.Second,
		DBTimeout:     time.Second,
		ReadBuffer:    1024,
		QueueSize:     4,
		MaxHeader:     8192,
		Quality:       analyzer,
	})
	port := listenerPort(t, manager, 1)

	source, _, _ := connect(t, port, "SOURCE /M HTTP/1.0\r\n\r\n")
	defer source.Close()
	rover, reader, _ := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	defer rover.Close()

	payload := []byte{0xD3, 0x00, 0x03, 0x3E, 0x00, 0x01, 0x4E, 0x01, 0xB4}
	if _, err := source.Write(payload); err != nil {
		t.Fatalf("source write: %v", err)
	}
	got := make([]byte, len(payload))
	if _, err := io.ReadFull(reader, got); err != nil {
		t.Fatalf("rover read: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("byte mismatch: got %x want %x", got, payload)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		snapshots := analyzer.Snapshot()
		if len(snapshots) > 0 && snapshots[0].TargetType == quality.TargetStation && snapshots[0].TargetID == 99 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("analyzer did not observe station ingest")
}

func TestTargetedDisconnect(t *testing.T) {
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	first, _, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("first status = %q", status)
	}
	defer first.Close()
	second, _, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("second status = %q", status)
	}
	defer second.Close()

	if closed := manager.DisconnectMountpoint(1, "mountpoint_disabled"); closed != 2 {
		t.Fatalf("DisconnectMountpoint closed = %d, want 2", closed)
	}
	waitClosed(t, manager, 0)

	third, _, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("third status = %q", status)
	}
	defer third.Close()
	if closed := manager.DisconnectListener(1, "listener_disabled"); closed != 1 {
		t.Fatalf("DisconnectListener closed = %d, want 1", closed)
	}
	waitClosed(t, manager, 0)

	fourth, _, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("fourth status = %q", status)
	}
	defer fourth.Close()
	if closed := manager.DisconnectAccount(9000, "account_disabled"); closed != 1 {
		t.Fatalf("DisconnectAccount closed = %d, want 1", closed)
	}
	waitClosed(t, manager, 0)
}

func TestReconcileClosesExcessConnections(t *testing.T) {
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Accounts: []*AccountConfig{{
			ID:             1,
			Username:       "test",
			PasswordHash:   passwordHash("test"),
			Enabled:        true,
			MaxConnections: 2,
			ACL:            map[int64]bool{1: true},
		}},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	first, _, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("first status = %q", status)
	}
	defer first.Close()
	time.Sleep(20 * time.Millisecond)
	second, _, status := connect(t, port, "GET /M HTTP/1.0\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("second status = %q", status)
	}
	defer second.Close()
	if got := len(manager.Connections()); got != 2 {
		t.Fatalf("connections = %d, want 2", got)
	}
	firstID := manager.Connections()[1].ID

	cfg.Accounts[0].MaxConnections = 1
	if err := manager.Reconcile(context.Background()); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	waitClosed(t, manager, 1)
	remaining := manager.Connections()
	if remaining[0].ID != firstID {
		t.Fatalf("remaining connection = %d, want oldest %d", remaining[0].ID, firstID)
	}
}

func TestClosedConnectionIsNotAddedToHub(t *testing.T) {
	mountpoint := &MountpointConfig{ID: 1, Name: "M", Enabled: true}
	h := newHub(mountpoint, nil)
	conn := &connection{id: 1}
	conn.closed.Store(true)
	if h.addRover(conn) {
		t.Fatal("closed rover was added to hub")
	}
	if h.addSource(conn) {
		t.Fatal("closed source was added to hub")
	}
	if len(h.rovers) != 0 || h.source != nil {
		t.Fatal("closed connection remained in hub")
	}
}

func waitClosed(t *testing.T, manager *manager, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(manager.Connections()) == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("connections = %d, want %d", len(manager.Connections()), want)
}

func TestRepeatedListenerToggleNoGoroutineLeak(t *testing.T) {
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{
			1: {ID: 1, Name: "M", Enabled: true},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true}}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	baseline := runtime.NumGoroutine()
	for i := 0; i < 50; i++ {
		cfg.Listeners[0].Enabled = i%2 == 0
		if err := manager.Reconcile(context.Background()); err != nil {
			t.Fatalf("Reconcile %d: %v", i, err)
		}
	}
	cfg.Listeners[0].Enabled = true
	if err := manager.Reconcile(context.Background()); err != nil {
		t.Fatalf("final Reconcile: %v", err)
	}
	time.Sleep(200 * time.Millisecond)
	runtime.GC()
	after := runtime.NumGoroutine()
	if after > baseline+5 {
		t.Fatalf("goroutines = %d, baseline = %d", after, baseline)
	}
}

type slowRuntime struct {
	*memoryRuntime
	delay time.Duration
}

func (r *slowRuntime) Start(ctx context.Context, info StartInfo) (int64, error) {
	select {
	case <-time.After(r.delay):
	case <-ctx.Done():
		return 0, ctx.Err()
	}
	return r.memoryRuntime.Start(ctx, info)
}

func registerTestConfig(maxConnections int) *Config {
	mountpoint := &MountpointConfig{ID: 1, Name: "M", Enabled: true}
	return &Config{
		Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		Accounts: []*AccountConfig{{
			ID:             1,
			Username:       "register",
			PasswordHash:   passwordHash("register"),
			Enabled:        true,
			MaxConnections: maxConnections,
			ACL:            map[int64]bool{1: true},
		}},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth,
				Mountpoints: map[int64]*MountpointConfig{1: mountpoint}},
		},
	}
}

func seedRegisterConfig(mgr *manager, cfg *Config) {
	mgr.mu.Lock()
	defer mgr.mu.Unlock()
	for _, account := range cfg.Accounts {
		mgr.accounts[account.Username] = account
		mgr.accountsByID[account.ID] = account
	}
	for id, mountpoint := range cfg.Mountpoints {
		mgr.mountpoints[id] = mountpoint
	}
	for _, listener := range cfg.Listeners {
		mgr.listenerCfgs[listener.ID] = listener
	}
}

func testConnection() *connection {
	return &connection{
		direction:    DirectionRover,
		listenerID:   1,
		mountpointID: 1,
		remoteAddr:   "127.0.0.1:5000",
		start:        time.Now().UTC(),
	}
}

func TestRegisterDoesNotHoldLockDuringRuntimeStart(t *testing.T) {
	cfg := registerTestConfig(4)
	mgr := NewManager(&memoryStore{cfg: cfg}, &slowRuntime{memoryRuntime: &memoryRuntime{}, delay: 150 * time.Millisecond}, Options{
		DBTimeout:  time.Second,
		ReadBuffer: 1024,
		QueueSize:  4,
	})
	seedRegisterConfig(mgr, cfg)
	defer func() {
		mgr.mu.Lock()
		mgr.conns = make(map[int64]*connection)
		mgr.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		mgr.Shutdown(ctx)
	}()

	done := make(chan error, 1)
	go func() { done <- mgr.register(testConnection(), cfg.Accounts[0]) }()
	time.Sleep(30 * time.Millisecond)

	probeStart := time.Now()
	_ = mgr.Connections()
	if elapsed := time.Since(probeStart); elapsed > 80*time.Millisecond {
		t.Fatalf("Connections blocked %v while runtime.Start runs", elapsed)
	}
	if err := <-done; err != nil {
		t.Fatalf("register: %v", err)
	}
	if got := len(mgr.Connections()); got != 1 {
		t.Fatalf("connections = %d, want 1", got)
	}
}

func TestRegisterReservesSlotsConcurrently(t *testing.T) {
	cfg := registerTestConfig(2)
	mgr := NewManager(&memoryStore{cfg: cfg}, &slowRuntime{memoryRuntime: &memoryRuntime{}, delay: 80 * time.Millisecond}, Options{
		DBTimeout:  time.Second,
		ReadBuffer: 1024,
		QueueSize:  4,
	})
	seedRegisterConfig(mgr, cfg)
	defer func() {
		mgr.mu.Lock()
		mgr.conns = make(map[int64]*connection)
		mgr.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		mgr.Shutdown(ctx)
	}()

	var wg sync.WaitGroup
	results := make(chan error, 3)
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- mgr.register(testConnection(), cfg.Accounts[0])
		}()
	}
	wg.Wait()
	close(results)
	accepted, rejected := 0, 0
	for err := range results {
		switch {
		case err == nil:
			accepted++
		case err == errMaxConns:
			rejected++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if accepted != 2 || rejected != 1 {
		t.Fatalf("accepted = %d, rejected = %d", accepted, rejected)
	}
}

func clearRegisteredConns(mgr *manager) {
	mgr.mu.Lock()
	mgr.conns = make(map[int64]*connection)
	mgr.pending = make(map[int64]int)
	mgr.pendingIP = make(map[string]int)
	mgr.pendingTotal = 0
	mgr.mu.Unlock()
}

func TestRegisterEnforcesPerIPLimit(t *testing.T) {
	cfg := registerTestConfig(10)
	mgr := NewManager(&memoryStore{cfg: cfg}, &memoryRuntime{}, Options{
		DBTimeout:           time.Second,
		ReadBuffer:          1024,
		QueueSize:           4,
		MaxConnectionsPerIP: 2,
	})
	seedRegisterConfig(mgr, cfg)
	defer clearRegisteredConns(mgr)

	first := testConnection()
	first.remoteAddr = "127.0.0.1:1000"
	second := testConnection()
	second.remoteAddr = "127.0.0.1:1001"
	third := testConnection()
	third.remoteAddr = "127.0.0.1:1002"

	if err := mgr.register(first, cfg.Accounts[0]); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := mgr.register(second, cfg.Accounts[0]); err != nil {
		t.Fatalf("second: %v", err)
	}
	if err := mgr.register(third, cfg.Accounts[0]); err != errMaxConns {
		t.Fatalf("third = %v, want errMaxConns", err)
	}
}

func TestRegisterEnforcesGlobalLimit(t *testing.T) {
	cfg := registerTestConfig(10)
	mgr := NewManager(&memoryStore{cfg: cfg}, &memoryRuntime{}, Options{
		DBTimeout:      time.Second,
		ReadBuffer:     1024,
		QueueSize:      4,
		MaxConnections: 2,
	})
	seedRegisterConfig(mgr, cfg)
	defer clearRegisteredConns(mgr)

	for index, addr := range []string{"10.0.0.1:1", "10.0.0.2:1", "10.0.0.3:1"} {
		conn := testConnection()
		conn.remoteAddr = addr
		err := mgr.register(conn, cfg.Accounts[0])
		if index < 2 && err != nil {
			t.Fatalf("connection %d: %v", index, err)
		}
		if index == 2 && err != errMaxConns {
			t.Fatalf("connection %d = %v, want errMaxConns", index, err)
		}
	}
}

func TestSourceReadLoopClosesIdleSource(t *testing.T) {
	server, client := net.Pipe()
	defer client.Close()
	conn := &connection{conn: server, hub: newHub(nil, nil), done: make(chan struct{})}
	go conn.sourceReadLoop(server, 1024, 80*time.Millisecond)

	if _, err := client.Write([]byte("x")); err != nil {
		t.Fatalf("write: %v", err)
	}
	select {
	case <-conn.done:
	case <-time.After(2 * time.Second):
		t.Fatal("source im lĂ¡ÂºÂ·ng khÄ‚Â´ng bĂ¡Â»â€¹ Ă„â€˜Ä‚Â³ng")
	}
	if got := conn.closeReason(); got != "timeout" {
		t.Fatalf("closeReason = %q, want timeout", got)
	}
}

func TestSourceReadLoopKeepsActiveSource(t *testing.T) {
	server, client := net.Pipe()
	conn := &connection{conn: server, hub: newHub(nil, nil), done: make(chan struct{})}
	go conn.sourceReadLoop(server, 1024, 120*time.Millisecond)

	for i := 0; i < 5; i++ {
		if _, err := client.Write([]byte("x")); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
		time.Sleep(40 * time.Millisecond)
	}
	select {
	case <-conn.done:
		t.Fatal("source cÄ‚Â²n gĂ¡Â»Â­i dĂ¡Â»Â¯ liĂ¡Â»â€¡u nhĂ†Â°ng bĂ¡Â»â€¹ Ă„â€˜Ä‚Â³ng")
	default:
	}
	client.Close()
	select {
	case <-conn.done:
	case <-time.After(2 * time.Second):
		t.Fatal("source Ă„â€˜Ä‚Â³ng khÄ‚Â´ng giĂ¡ÂºÂ£i phÄ‚Â³ng kĂ¡ÂºÂ¿t nĂ¡Â»â€˜i")
	}
	if got := conn.closeReason(); got != "source_closed" {
		t.Fatalf("closeReason = %q, want source_closed", got)
	}
}

func TestDefaultPerIPLimitAllowsValidFanIn(t *testing.T) {
	opts := DefaultOptions()
	if opts.MaxConnectionsPerIP < 200 {
		t.Fatalf("MaxConnectionsPerIP mĂ¡ÂºÂ·c Ă„â€˜Ă¡Â»â€¹nh = %d, cĂ¡ÂºÂ§n >= 200 cho fan-in 100 trĂ¡ÂºÂ¡m", opts.MaxConnectionsPerIP)
	}
	if opts.MaxConnections < 500 {
		t.Fatalf("MaxConnections mĂ¡ÂºÂ·c Ă„â€˜Ă¡Â»â€¹nh = %d, cĂ¡ÂºÂ§n >= 500", opts.MaxConnections)
	}
}

func TestRoverReadLoopRejectsOversizedLine(t *testing.T) {
	server, client := net.Pipe()
	conn := &connection{
		conn: server,
		br:   bufio.NewReaderSize(server, 4096),
		done: make(chan struct{}),
	}
	go conn.roverReadLoop(2 * time.Second)

	go func() {
		_, _ = client.Write(bytes.Repeat([]byte("A"), 10*1024))
	}()
	select {
	case <-conn.done:
	case <-time.After(2 * time.Second):
		t.Fatal("dÄ‚Â²ng quÄ‚Â¡ dÄ‚Â i khÄ‚Â´ng bĂ¡Â»â€¹ Ă„â€˜Ä‚Â³ng")
	}
	if got := conn.closeReason(); got != "protocol_error" {
		t.Fatalf("closeReason = %q, want protocol_error", got)
	}
	_ = client.Close()
}

func TestRoverReadLoopUpdatesFixType(t *testing.T) {
	server, client := net.Pipe()
	conn := &connection{
		conn:      server,
		br:        bufio.NewReaderSize(server, 4096),
		done:      make(chan struct{}),
		direction: "rover",
	}
	go conn.roverReadLoop(2 * time.Second)

	if _, err := client.Write([]byte("$GPGGA,123519,4807.038,N,01131.000,E,4,08,0.9,545.4,M,46.9,M,,*4E\r\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && conn.currentFixType() == FixError {
		time.Sleep(10 * time.Millisecond)
	}
	if got := conn.currentFixType(); got != FixFixed {
		t.Fatalf("fixType = %q, want %q", got, FixFixed)
	}
	_ = client.Close()
	select {
	case <-conn.done:
	case <-time.After(time.Second):
		t.Fatal("khÄ‚Â´ng Ă„â€˜Ä‚Â³ng sau khi client Ă„â€˜Ä‚Â³ng")
	}
}

func TestAuthFailureThrottleBlocksOnlyFailedPair(t *testing.T) {
	mgr := NewManager(&memoryStore{}, &memoryRuntime{}, Options{DBTimeout: time.Second})
	for i := 0; i < authFailThreshold; i++ {
		mgr.recordAuthFailure("nguyen", "203.0.113.5")
	}
	if got := mgr.authBlockedFor("nguyen", "203.0.113.5"); got <= 0 {
		t.Fatalf("cáº·p sai chÆ°a bá»‹ cháº·n: %s", got)
	}
	if got := mgr.authBlockedFor("nguyen", "203.0.113.6"); got != 0 {
		t.Fatalf("IP khĂ¡c bá»‹ cháº·n nháº§m: %s", got)
	}
	if got := mgr.authBlockedFor("khac", "203.0.113.5"); got != 0 {
		t.Fatalf("username khĂ¡c bá»‹ cháº·n nháº§m: %s", got)
	}
	mgr.clearAuthFailure("nguyen", "203.0.113.5")
	if got := mgr.authBlockedFor("nguyen", "203.0.113.5"); got != 0 {
		t.Fatalf("clear khĂ´ng giáº£i phĂ³ng: %s", got)
	}
}

func TestAuthFailureGlobalThrottle(t *testing.T) {
	mgr := NewManager(&memoryStore{}, &memoryRuntime{}, Options{DBTimeout: time.Second})
	for i := 0; i < authFailGlobalMax; i++ {
		mgr.recordAuthFailure("u"+strconv.Itoa(i), "198.51.100."+strconv.Itoa(i%200))
	}
	if got := mgr.authBlockedFor("bat-ky", "192.0.2.1"); got <= 0 {
		t.Fatal("chÆ°a cháº·n toĂ n cá»¥c sau ngÆ°á»¡ng sai")
	}
}

func TestPublishFromIgnoresStaleSource(t *testing.T) {
	h := newHub(&MountpointConfig{ID: 1, Name: "M", Enabled: true}, nil)
	rover := &connection{id: 1, sendCh: make(chan []byte, 1), done: make(chan struct{})}
	if !h.addRover(rover) {
		t.Fatal("addRover failed")
	}
	stale := &connection{id: 2, done: make(chan struct{})}
	current := &connection{id: 3, done: make(chan struct{})}
	h.source = current

	h.publishFrom(stale, []byte{0x01})
	select {
	case got := <-rover.sendCh:
		t.Fatalf("source cũ vẫn publish được: %x", got)
	default:
	}

	h.publishFrom(current, []byte{0x02})
	select {
	case got := <-rover.sendCh:
		if !bytes.Equal(got, []byte{0x02}) {
			t.Fatalf("payload = %x, want 02", got)
		}
	case <-time.After(time.Second):
		t.Fatal("source hiện tại không publish được")
	}
}

func TestHubDetachSourceKeepsRoversForGrace(t *testing.T) {
	h := newHub(nil, nil)
	source := &connection{id: 1}
	rover := &connection{id: 2}
	h.source = source
	if !h.addRover(rover) {
		t.Fatal("addRover failed")
	}
	h.detachSource(source)
	if h.hasSource() {
		t.Fatal("source chưa được detach")
	}
	rovers := h.takeRoversIfNoSource()
	if len(rovers) != 1 || rovers[0] != rover {
		t.Fatalf("rovers = %d, want 1", len(rovers))
	}
	if got := h.takeRoversIfNoSource(); len(got) != 0 {
		t.Fatalf("lấy rover lần hai = %d, want 0", len(got))
	}
}

func TestSourceGraceClosesRoverAfterTimeout(t *testing.T) {
	mgr := NewManager(&memoryStore{}, &memoryRuntime{}, Options{
		DBTimeout:   time.Second,
		SourceGrace: 30 * time.Millisecond,
	})
	h := newHub(nil, nil)
	server, client := net.Pipe()
	defer client.Close()
	source := &connection{id: 1, direction: DirectionSource, hub: h, conn: server}
	roverServer, roverClient := net.Pipe()
	defer roverClient.Close()
	rover := &connection{id: 2, direction: DirectionRover, hub: h, conn: roverServer, done: make(chan struct{})}
	h.source = source
	if !h.addRover(rover) {
		t.Fatal("addRover failed")
	}

	mgr.connectionClosed(source, "timeout")
	select {
	case <-rover.done:
		t.Fatal("rover bị đóng ngay, chưa hết grace")
	case <-time.After(10 * time.Millisecond):
	}
	select {
	case <-rover.done:
	case <-time.After(time.Second):
		t.Fatal("rover không bị đóng sau grace")
	}
	if got := rover.closeReason(); got != "source_disconnected" {
		t.Fatalf("closeReason = %q, want source_disconnected", got)
	}
}

func TestSourceConnectionHasNoFixType(t *testing.T) {
	conn := &connection{direction: "source"}
	if got := conn.currentFixType(); got != "" {
		t.Fatalf("source fixType = %q, want empty", got)
	}
}

func TestAuthorizeRejectsEmptyUsername(t *testing.T) {
	cfg := registerTestConfig(4)
	mgr := NewManager(&memoryStore{cfg: cfg}, &memoryRuntime{}, Options{
		DBTimeout:  time.Second,
		ReadBuffer: 1024,
		QueueSize:  4,
	})
	seedRegisterConfig(mgr, cfg)

	// Basic ":register" => username rỗng, password đúng. Phải bị 401 vì
	// không có tài khoản NTRIP hợp lệ.
	req := &request{Authorization: "Basic " + base64.StdEncoding.EncodeToString([]byte(":register"))}
	account, code, _ := mgr.authorize(req, cfg.Mountpoints[1], cfg.Listeners[0], "127.0.0.1")
	if account != nil || code != 401 {
		t.Fatalf("account = %v, code = %d, want nil/401", account, code)
	}
}

func TestRegisterRejectsNilAccountForRover(t *testing.T) {
	cfg := registerTestConfig(4)
	mgr := NewManager(&memoryStore{cfg: cfg}, &memoryRuntime{}, Options{
		DBTimeout:  time.Second,
		ReadBuffer: 1024,
		QueueSize:  4,
	})
	seedRegisterConfig(mgr, cfg)
	defer clearRegisteredConns(mgr)

	if err := mgr.register(testConnection(), nil); err != errAuthRequired {
		t.Fatalf("register rover without account = %v, want errAuthRequired", err)
	}
}
