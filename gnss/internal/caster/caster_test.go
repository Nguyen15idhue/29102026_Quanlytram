package caster

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
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
			1: {ID: 1, Name: "M", Enabled: true, RequiresAuth: true},
		},
		Accounts: []*AccountConfig{
			{ID: 1, Username: "ok", PasswordHash: hash, Enabled: true, MaxConnections: 1, ACL: map[int64]bool{1: true}},
			{ID: 2, Username: "noacl", PasswordHash: hash, Enabled: true, MaxConnections: 2, ACL: map[int64]bool{}},
		},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: {ID: 1, Name: "M", Enabled: true, RequiresAuth: true}}},
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

func TestPasswordOnlyMountpoint(t *testing.T) {
	hash := passwordHash("secret123")
	mountpoint := &MountpointConfig{
		ID:           1,
		Name:         "P",
		Enabled:      true,
		RequiresAuth: true,
		AuthMode:     "password_only",
		PasswordHash: hash,
	}
	cfg := &Config{
		Mountpoints: map[int64]*MountpointConfig{1: mountpoint},
		Listeners: []*ListenerConfig{
			{ID: 1, Name: "default", Port: 0, Enabled: true, Role: RoleBoth, Mountpoints: map[int64]*MountpointConfig{1: mountpoint}},
		},
	}
	manager, _ := newTestManager(t, cfg)
	port := listenerPort(t, manager, 1)

	_, _, status := connect(t, port, "GET /P HTTP/1.0\r\n\r\n")
	if status != "ICY 401 Unauthorized" {
		t.Fatalf("missing auth status = %q", status)
	}
	_, _, status = connect(t, port, "GET /P HTTP/1.1\r\nHost: x\r\nAuthorization: Basic "+
		base64.StdEncoding.EncodeToString([]byte(":wrong"))+"\r\n\r\n")
	if status != "HTTP/1.1 401 Unauthorized" {
		t.Fatalf("wrong password status = %q", status)
	}

	auth := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(":secret123"))
	source, _, status := connect(t, port, "SOURCE /P HTTP/1.0\r\n"+auth+"\r\n\r\n")
	if status != "ICY 200 OK" {
		t.Fatalf("password-only source v1 status = %q", status)
	}
	source.Close()

	source, _, status = connect(t, port, "POST /P HTTP/1.1\r\nHost: x\r\n"+auth+"\r\n\r\n")
	if status != "HTTP/1.1 200 OK" {
		t.Fatalf("password-only source v2 status = %q", status)
	}
	source.Close()

	rover, _, status := connect(t, port, "GET /P HTTP/1.1\r\nHost: x\r\nNtrip-Version: Ntrip/2.0\r\n"+auth+"\r\n\r\n")
	if status != "HTTP/1.1 200 OK" {
		t.Fatalf("password-only rover status = %q", status)
	}
	rover.Close()
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

func TestDisconnectAndSourceConflict(t *testing.T) {
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

	_, _, status = connect(t, port, "SOURCE /M HTTP/1.0\r\n\r\n")
	if status != "ICY 409 Conflict" {
		t.Fatalf("second source status = %q", status)
	}

	connections := manager.Connections()
	if len(connections) != 1 {
		t.Fatalf("connections = %d, want 1", len(connections))
	}
	if !manager.Disconnect(connections[0].ID) {
		t.Fatal("Disconnect returned false")
	}
	time.Sleep(50 * time.Millisecond)
	if len(manager.Connections()) != 0 {
		t.Fatal("connection was not removed")
	}
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
