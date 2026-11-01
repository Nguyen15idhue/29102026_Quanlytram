package relay

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"cors/gnss/internal/ntrip"
)

// startCaster dựng caster mock nhận nhiều kết nối. handle nhận chỉ số kết nối
// (0,1,2,...), conn và request header; trả về cổng đang lắng nghe.
func startCaster(t *testing.T, handle func(idx int, conn net.Conn, req string)) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for idx := 0; ; idx++ {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(i int, c net.Conn) {
				defer c.Close()
				req, ok := readRequestHead(c)
				if !ok {
					return
				}
				handle(i, c, req)
			}(idx, conn)
		}
	}()
	return listener.Addr().(*net.TCPAddr).Port
}

func readRequestHead(conn net.Conn) (string, bool) {
	var req bytes.Buffer
	buf := make([]byte, 1024)
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for !bytes.Contains(req.Bytes(), []byte("\r\n\r\n")) {
		n, err := conn.Read(buf)
		if err != nil {
			return "", false
		}
		req.Write(buf[:n])
	}
	_ = conn.SetReadDeadline(time.Time{})
	return req.String(), true
}

func basicAuthOf(req string) string {
	for _, line := range strings.Split(req, "\r\n") {
		if strings.HasPrefix(line, "Authorization: Basic ") {
			raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(line, "Authorization: Basic "))
			return string(raw)
		}
	}
	return ""
}

type fakeStationStore struct {
	mu      sync.Mutex
	configs []*StationSourceConfig
}

func (f *fakeStationStore) LoadAll(ctx context.Context) ([]*StationSourceConfig, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*StationSourceConfig, len(f.configs))
	copy(out, f.configs)
	return out, nil
}

func (f *fakeStationStore) set(configs ...*StationSourceConfig) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.configs = configs
}

type sinkRecorder struct {
	mu  sync.Mutex
	buf []byte
}

func (s *sinkRecorder) add(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf = append(s.buf, data...)
}

func (s *sinkRecorder) waitFor(t *testing.T, want string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		ok := bytes.Contains(s.buf, []byte(want))
		s.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t.Fatalf("timeout waiting for %q; got %q", want, s.buf)
}

func waitUntil(t *testing.T, timeout time.Duration, msg string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout: %s", msg)
}

func testStationConfig(port int, password string) *StationSourceConfig {
	return &StationSourceConfig{
		StationID:    480,
		MountpointID: 445,
		StationName:  "TestHauLoc",
		Endpoint: EndpointConfig{
			Host:         "127.0.0.1",
			Port:         port,
			Mount:        "THA_HauLoc",
			NtripVersion: "v1",
			Username:     "nguyen",
			Password:     password,
		},
	}
}

func testManagerOptions(idle time.Duration) StationSourceOptions {
	return StationSourceOptions{
		Options: Options{
			DialTimeout:  2 * time.Second,
			ReadBuffer:   1024,
			RetryMin:     20 * time.Millisecond,
			RetryMax:     50 * time.Millisecond,
			PollInterval: 50 * time.Millisecond,
		},
		IdleTimeout: idle,
	}
}

func newTestManager(store StationSourceStore, idle time.Duration, rec *sinkRecorder) *StationSourceManager {
	m := NewStationSourceManager(store, nil, testManagerOptions(idle))
	m.feedFor = func(*StationSourceConfig) func([]byte) { return rec.add }
	return m
}

func TestRunStationSourcePassesBytesToFeed(t *testing.T) {
	payload := []byte{0xD3, 0x00, 0x13, 0x3E, 0xD7, 0xD3, 0x02, 0x02}
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		_, _ = conn.Write(append([]byte("ICY 200 OK\r\n\r\n"), payload...))
		time.Sleep(200 * time.Millisecond)
	})
	cfg := testStationConfig(port, "pw")

	var mu sync.Mutex
	var received []byte
	var streamingCalls int
	gotPayload := make(chan struct{})
	hooks := stationSessionHooks{
		feed: func(data []byte) {
			mu.Lock()
			defer mu.Unlock()
			received = append(received, data...)
			if bytes.Equal(received, payload) {
				select {
				case <-gotPayload:
				default:
					close(gotPayload)
				}
			}
		},
		streaming: func() {
			mu.Lock()
			defer mu.Unlock()
			streamingCalls++
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- RunStationSource(ctx, cfg, testManagerOptions(5*time.Second), hooks) }()

	select {
	case <-gotPayload:
	case <-ctx.Done():
		t.Fatalf("timeout waiting for payload")
	}
	if err := <-errCh; err == nil {
		t.Fatalf("expected session to end with error after caster closed")
	}
	mu.Lock()
	defer mu.Unlock()
	if !bytes.Equal(received, payload) {
		t.Fatalf("payload mismatch: got %x want %x", received, payload)
	}
	if streamingCalls != 1 {
		t.Fatalf("streaming hook called %d times, want 1", streamingCalls)
	}
}

func TestRunStationSourceRequestAndAuth(t *testing.T) {
	var gotReq string
	var mu sync.Mutex
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		mu.Lock()
		gotReq = req
		mu.Unlock()
		_, _ = conn.Write([]byte("ICY 200 OK\r\n\r\nx"))
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = RunStationSource(ctx, testStationConfig(port, "pw"), testManagerOptions(time.Second), stationSessionHooks{})

	mu.Lock()
	defer mu.Unlock()
	if !strings.HasPrefix(gotReq, "GET /THA_HauLoc HTTP/1.0\r\n") {
		t.Fatalf("unexpected request line: %q", strings.SplitN(gotReq, "\r\n", 2)[0])
	}
	if basicAuthOf(gotReq) != "nguyen:pw" {
		t.Fatalf("basic auth = %q, want nguyen:pw", basicAuthOf(gotReq))
	}
}

func TestRunStationSourceAuthFailureClassifiedAsAuth(t *testing.T) {
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		_, _ = conn.Write([]byte("HTTP/1.1 401 Unauthorized\r\n\r\n"))
	})
	cfg := testStationConfig(port, "wrong")
	cfg.Endpoint.NtripVersion = "v2"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := RunStationSource(ctx, cfg, testManagerOptions(time.Second), stationSessionHooks{})
	if err == nil {
		t.Fatalf("expected auth error")
	}
	var status *ntrip.StatusError
	if !errors.As(err, &status) || status.Code != 401 {
		t.Fatalf("expected 401 status error, got %v", err)
	}
	if got := classify(err); got != "auth_failed" {
		t.Fatalf("classify = %q, want auth_failed", got)
	}
}

func TestRunStationSourceIdleTimeoutReturnsTimeout(t *testing.T) {
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		_, _ = conn.Write([]byte("ICY 200 OK\r\n\r\nX"))
		time.Sleep(3 * time.Second) // giữ socket mở nhưng không gửi thêm byte
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	start := time.Now()
	err := RunStationSource(ctx, testStationConfig(port, "pw"), testManagerOptions(300*time.Millisecond), stationSessionHooks{})
	if err == nil {
		t.Fatalf("expected idle timeout error")
	}
	if got := classify(err); got != "timeout" {
		t.Fatalf("classify = %q, want timeout (err=%v)", got, err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("idle timeout took %s, expected ~300ms", elapsed)
	}
}

func TestStationSourceManagerReconnectsAfterSourceRestart(t *testing.T) {
	// Mỗi lần kết nối: nguồn gửi một mốc rồi đóng (như nguồn restart).
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		_, _ = conn.Write([]byte(fmt.Sprintf("ICY 200 OK\r\n\r\nS%d;", idx)))
	})
	store := &fakeStationStore{}
	store.set(testStationConfig(port, "p1"))
	rec := &sinkRecorder{}
	m := newTestManager(store, 5*time.Second, rec)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.Run(ctx)
	defer m.Shutdown(context.Background())

	rec.waitFor(t, "S0;", 3*time.Second)
	rec.waitFor(t, "S1;", 3*time.Second)
	rec.waitFor(t, "S2;", 3*time.Second)
}

func TestStationSourceManagerRecoversFromStall(t *testing.T) {
	// Kết nối đầu: gửi một đoạn rồi treo (socket mở, không có byte).
	// Kết nối sau: nguồn hoạt động trở lại.
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		if idx == 0 {
			_, _ = conn.Write([]byte("ICY 200 OK\r\n\r\nSTALL;"))
			time.Sleep(3 * time.Second)
			return
		}
		_, _ = conn.Write([]byte("ICY 200 OK\r\n\r\nRESUMED;"))
		_, _ = io.Copy(io.Discard, conn)
	})
	store := &fakeStationStore{}
	store.set(testStationConfig(port, "p1"))
	rec := &sinkRecorder{}
	m := newTestManager(store, 300*time.Millisecond, rec)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.Run(ctx)
	defer m.Shutdown(context.Background())

	rec.waitFor(t, "STALL;", 3*time.Second)
	rec.waitFor(t, "RESUMED;", 3*time.Second)
}

func TestStationSourceManagerAppliesConfigChangeAndStops(t *testing.T) {
	var mu sync.Mutex
	var auths []string
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		mu.Lock()
		auths = append(auths, basicAuthOf(req))
		mu.Unlock()
		_, _ = conn.Write([]byte("ICY 200 OK\r\n\r\nK;"))
		_, _ = io.Copy(io.Discard, conn) // giữ phiên mở tới khi client đóng
	})
	authCount := func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(auths)
	}
	lastAuth := func() string {
		mu.Lock()
		defer mu.Unlock()
		if len(auths) == 0 {
			return ""
		}
		return auths[len(auths)-1]
	}

	store := &fakeStationStore{}
	store.set(testStationConfig(port, "p1"))
	rec := &sinkRecorder{}
	m := newTestManager(store, 5*time.Second, rec)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.Run(ctx)
	defer m.Shutdown(context.Background())

	rec.waitFor(t, "K;", 3*time.Second)
	waitUntil(t, 3*time.Second, "first connection uses p1", func() bool {
		return lastAuth() == "nguyen:p1"
	})

	// Đổi mật khẩu: phiên cũ phải đóng, phiên mới dùng mật khẩu mới.
	store.set(testStationConfig(port, "p2"))
	waitUntil(t, 3*time.Second, "reconnect uses p2", func() bool {
		return lastAuth() == "nguyen:p2"
	})

	// Tắt trạm (xóa cấu hình): không còn phiên và không kết nối thêm.
	store.set()
	waitUntil(t, 3*time.Second, "session stopped", func() bool {
		m.mu.Lock()
		defer m.mu.Unlock()
		return len(m.sessions) == 0
	})
	before := authCount()
	time.Sleep(300 * time.Millisecond)
	if after := authCount(); after != before {
		t.Fatalf("disabled station still connecting: %d -> %d", before, after)
	}
}

func TestStationSourceFingerprintChangesWithCredential(t *testing.T) {
	cfg := testStationConfig(1509, "a")
	first := stationSourceFingerprint(cfg)
	cfg.Endpoint.Password = "b"
	if stationSourceFingerprint(cfg) == first {
		t.Fatal("fingerprint did not change when password changed")
	}
}

func TestStationSourceFingerprintChangesWithSendGGA(t *testing.T) {
	cfg := testStationConfig(1509, "a")
	first := stationSourceFingerprint(cfg)
	cfg.SendGGA = true
	if stationSourceFingerprint(cfg) == first {
		t.Fatal("fingerprint did not change when SendGGA toggled")
	}
}

func waitForGGA(t *testing.T, conn net.Conn) string {
	t.Helper()
	buf := make([]byte, 512)
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, err := conn.Read(buf)
	if err != nil || n == 0 {
		t.Fatalf("no GGA written by client (err=%v)", err)
	}
	return string(buf[:n])
}

func assertGGA(t *testing.T, data string) {
	t.Helper()
	if !strings.Contains(data, "$GPGGA,") {
		t.Fatalf("expected GPGGA sentence, got %q", data)
	}
}

func TestRunStationSourceSendsGGAFromConfiguredPosition(t *testing.T) {
	gga := make(chan string, 1)
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		_, _ = conn.Write([]byte("ICY 200 OK\r\n\r\n"))
		gga <- waitForGGA(t, conn)
	})
	cfg := testStationConfig(port, "pw")
	lat, lon := 21.0278, 105.8342
	cfg.Lat, cfg.Lon = &lat, &lon
	cfg.SendGGA = true
	cfg.NMEAIntervalSec = 10

	opts := testManagerOptions(5 * time.Second)
	// Chu kỳ dài: GGA vẫn phải được gửi ngay, không đợi hết chu kỳ đầu.
	opts.Options.NMEAInterval = 10 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = RunStationSource(ctx, cfg, opts, stationSessionHooks{}) }()

	select {
	case data := <-gga:
		assertGGA(t, data)
	case <-time.After(time.Second):
		t.Fatalf("GGA was not sent immediately")
	}
}

func TestRunStationSourceSendsGGADerivedFrom1006(t *testing.T) {
	gga := make(chan string, 1)
	port := startCaster(t, func(idx int, conn net.Conn, req string) {
		_, _ = conn.Write([]byte("ICY 200 OK\r\n\r\n"))
		_, _ = conn.Write(buildTestFrame(mustHex(t, payload1006Hex)))
		gga <- waitForGGA(t, conn)
	})
	cfg := testStationConfig(port, "pw")
	cfg.SendGGA = true
	cfg.NMEAIntervalSec = 10

	opts := testManagerOptions(5 * time.Second)
	opts.Options.NMEAInterval = 10 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = RunStationSource(ctx, cfg, opts, stationSessionHooks{}) }()

	select {
	case data := <-gga:
		assertGGA(t, data)
	case <-time.After(time.Second):
		t.Fatalf("GGA derived from 1006 was not sent immediately")
	}
}
