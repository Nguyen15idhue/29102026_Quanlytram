package relay

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http/httputil"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"cors/gnss/internal/rtcm"
)

type mockServer struct {
	listener  net.Listener
	wg        sync.WaitGroup
	captured  chan []byte
	requests  chan string
	connected chan struct{}
	progress  chan int
	closeOnce sync.Once
}

func newMockServer(t *testing.T, handler func(*mockServer, net.Conn)) *mockServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := &mockServer{
		listener:  listener,
		captured:  make(chan []byte, 64),
		requests:  make(chan string, 16),
		connected: make(chan struct{}, 16),
		progress:  make(chan int, 256),
	}
	server.wg.Add(1)
	go func() {
		defer server.wg.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			server.wg.Add(1)
			go func() {
				defer server.wg.Done()
				_ = conn.SetDeadline(time.Now().Add(8 * time.Second))
				handler(server, conn)
			}()
		}
	}()
	t.Cleanup(server.Close)
	return server
}

func (m *mockServer) Close() {
	m.closeOnce.Do(func() {
		_ = m.listener.Close()
		m.wg.Wait()
	})
}

func (m *mockServer) hostPort() (string, int) {
	host, portValue, _ := net.SplitHostPort(m.listener.Addr().String())
	port, _ := strconv.Atoi(portValue)
	return host, port
}

func readRequest(br *bufio.Reader) (string, error) {
	first := ""
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return first, err
		}
		trimmed := strings.TrimRight(line, "\r\n")
		if first == "" {
			first = trimmed
		}
		if trimmed == "" {
			return first, nil
		}
	}
}

type upstreamOptions struct {
	payload  []byte
	chunked  bool
	fragment int
	status   string
	keepOpen bool
	signal   bool
}

func upstreamHandler(options upstreamOptions) func(*mockServer, net.Conn) {
	return func(server *mockServer, conn net.Conn) {
		defer conn.Close()
		br := bufio.NewReader(conn)
		if _, err := readRequest(br); err != nil {
			return
		}
		if options.signal {
			select {
			case server.connected <- struct{}{}:
			default:
			}
		}
		if options.status != "" {
			_, _ = io.WriteString(conn, options.status)
			return
		}
		if options.chunked {
			_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
		} else {
			_, _ = io.WriteString(conn, "ICY 200 OK\r\n\r\n")
		}
		writePayload(conn, options.payload, options.fragment, options.chunked)
		if options.keepOpen {
			_, _ = io.Copy(io.Discard, br)
		}
	}
}

func writePayload(conn net.Conn, payload []byte, fragment int, chunked bool) {
	if fragment <= 0 {
		fragment = len(payload)
	}
	if fragment == 0 {
		if chunked {
			_, _ = io.WriteString(conn, "0\r\n\r\n")
		}
		return
	}
	for start := 0; start < len(payload); start += fragment {
		end := start + fragment
		if end > len(payload) {
			end = len(payload)
		}
		part := payload[start:end]
		if chunked {
			_, _ = fmt.Fprintf(conn, "%x\r\n", len(part))
			_, _ = conn.Write(part)
			_, _ = io.WriteString(conn, "\r\n")
		} else {
			_, _ = conn.Write(part)
		}
	}
	if chunked {
		_, _ = io.WriteString(conn, "0\r\n\r\n")
	}
}

type downstreamOptions struct {
	response string
	readSize int
	delay    time.Duration
	progress bool
}

func downstreamHandler(options downstreamOptions) func(*mockServer, net.Conn) {
	return func(server *mockServer, conn net.Conn) {
		defer conn.Close()
		br := bufio.NewReader(conn)
		first, err := readRequest(br)
		if err != nil {
			return
		}
		select {
		case server.requests <- first:
		default:
		}

		response := options.response
		if response == "" {
			if strings.HasPrefix(first, "POST ") {
				response = "HTTP/1.1 200 OK\r\n\r\n"
			} else {
				response = "ICY 200 OK\r\n\r\n"
			}
		}
		if _, err := io.WriteString(conn, response); err != nil {
			return
		}
		select {
		case server.connected <- struct{}{}:
		default:
		}

		var reader io.Reader = br
		if strings.HasPrefix(first, "POST ") {
			reader = httputil.NewChunkedReader(br)
		}

		readSize := options.readSize
		if readSize <= 0 {
			readSize = 16 * 1024
		}
		buffer := make([]byte, readSize)
		var captured bytes.Buffer
		for {
			n, readErr := reader.Read(buffer)
			if n > 0 {
				_, _ = captured.Write(buffer[:n])
				if options.progress {
					select {
					case server.progress <- captured.Len():
					default:
					}
				}
				if options.delay > 0 {
					time.Sleep(options.delay)
				}
			}
			if readErr != nil {
				break
			}
		}
		server.captured <- captured.Bytes()
	}
}

func deterministicPayload(size int) []byte {
	payload := make([]byte, size)
	for i := range payload {
		payload[i] = byte((i*31 + 7) % 251)
	}
	return payload
}

func testConfig(upstream, downstream *mockServer, mode string) *JobConfig {
	upstreamHost, upstreamPort := upstream.hostPort()
	downstreamHost, downstreamPort := downstream.hostPort()
	cfg := &JobConfig{
		ID:              1,
		Name:            "mock",
		Enabled:         true,
		DesiredRevision: 1,
		Upstream: EndpointConfig{
			Host:         upstreamHost,
			Port:         upstreamPort,
			Mount:        "UP",
			NtripVersion: "v2",
		},
		Downstream: EndpointConfig{
			Host:         downstreamHost,
			Port:         downstreamPort,
			Mount:        "DOWN",
			NtripVersion: "v2",
		},
		DownstreamMode: mode,
	}
	cfg.Upstream.Key = EndpointKey(cfg.Upstream)
	cfg.Downstream.Key = EndpointKey(cfg.Downstream)
	return cfg
}

func runBridge(cfg *JobConfig, monitor *rtcm.Monitor, metrics *Metrics, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return RunSession(ctx, cfg, Options{
		DialTimeout:   2 * time.Second,
		MonitorBuffer: 64,
		ReadBuffer:    8 * 1024,
		NMEAInterval:  time.Hour,
	}, monitor, metrics)
}

func acceptableBridgeError(err error) bool {
	return err == nil || errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func waitCaptured(t *testing.T, server *mockServer, timeout time.Duration) []byte {
	t.Helper()
	select {
	case payload := <-server.captured:
		return payload
	case <-time.After(timeout):
		t.Fatal("timed out waiting for downstream payload")
		return nil
	}
}

func rtcmFrame(payload []byte) []byte {
	length := len(payload)
	frame := []byte{rtcm.Preamble, byte(length>>8) & 0x03, byte(length)}
	frame = append(frame, payload...)
	crc := rtcm.CRC24Q(frame)
	return append(frame, byte(crc>>16), byte(crc>>8), byte(crc))
}

func Test2T1ByteExactSource(t *testing.T) {
	for _, size := range []int{1024, 1024 * 1024} {
		t.Run(fmt.Sprintf("%d", size), func(t *testing.T) {
			payload := deterministicPayload(size)
			upstream := newMockServer(t, upstreamHandler(upstreamOptions{payload: payload, fragment: 4096}))
			downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
			cfg := testConfig(upstream, downstream, "source")
			metrics := &Metrics{}
			monitor := rtcm.NewMonitor(1 << 20)

			if err := runBridge(cfg, monitor, metrics, 15*time.Second); !acceptableBridgeError(err) {
				t.Fatalf("RunSession: %v", err)
			}
			got := waitCaptured(t, downstream, 5*time.Second)
			if !bytes.Equal(got, payload) {
				t.Fatalf("payload mismatch: got %d bytes, want %d", len(got), len(payload))
			}
			snapshot := metrics.Snapshot(1)
			if snapshot.BytesUp != uint64(size) || snapshot.BytesDown != uint64(size) {
				t.Fatalf("byte counters = up %d/down %d, want %d", snapshot.BytesUp, snapshot.BytesDown, size)
			}
		})
	}
}

func Test2T1ByteExactPost(t *testing.T) {
	payload := deterministicPayload(1024 * 1024)
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{payload: payload, fragment: 4096}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "post")
	metrics := &Metrics{}

	if err := runBridge(cfg, rtcm.NewMonitor(1<<20), metrics, 15*time.Second); !acceptableBridgeError(err) {
		t.Fatalf("RunSession: %v", err)
	}
	first := <-downstream.requests
	if !strings.HasPrefix(first, "POST ") {
		t.Fatalf("downstream request = %q, want POST", first)
	}
	got := waitCaptured(t, downstream, 5*time.Second)
	if !bytes.Equal(got, payload) {
		t.Fatalf("payload mismatch: got %d bytes, want %d", len(got), len(payload))
	}
}

func Test2T2FragmentedAndMultiFrameReads(t *testing.T) {
	first := rtcmFrame([]byte{0x3E, 0x00, 0x01})
	second := rtcmFrame([]byte{0x3E, 0x00, 0x02, 0x11})
	payload := append(append([]byte{}, first...), second...)

	cases := []struct {
		name     string
		chunked  bool
		fragment int
	}{
		{name: "one-byte-fragments", chunked: true, fragment: 1},
		{name: "all-in-one-read", chunked: false, fragment: len(payload)},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			upstream := newMockServer(t, upstreamHandler(upstreamOptions{
				payload:  payload,
				chunked:  testCase.chunked,
				fragment: testCase.fragment,
			}))
			downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
			cfg := testConfig(upstream, downstream, "source")
			monitor := rtcm.NewMonitor(1 << 20)

			if err := runBridge(cfg, monitor, &Metrics{}, 10*time.Second); !acceptableBridgeError(err) {
				t.Fatalf("RunSession: %v", err)
			}
			if got := waitCaptured(t, downstream, 5*time.Second); !bytes.Equal(got, payload) {
				t.Fatalf("payload mismatch")
			}
			stats := monitor.Snapshot()
			if stats.Frames != 2 {
				t.Fatalf("Frames = %d, want 2", stats.Frames)
			}
		})
	}
}

func Test2T3BadCRCDoesNotDropBytes(t *testing.T) {
	validFirst := rtcmFrame([]byte{0x3E, 0x00, 0x01})
	bad := rtcmFrame([]byte{0x3E, 0x00, 0x02})
	bad[len(bad)-1] ^= 0xFF
	validSecond := rtcmFrame([]byte{0x3E, 0x00, 0x03})
	payload := append(append(append([]byte{}, validFirst...), bad...), validSecond...)

	upstream := newMockServer(t, upstreamHandler(upstreamOptions{payload: payload, fragment: 7}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	monitor := rtcm.NewMonitor(1 << 20)

	if err := runBridge(cfg, monitor, &Metrics{}, 10*time.Second); !acceptableBridgeError(err) {
		t.Fatalf("RunSession: %v", err)
	}
	if got := waitCaptured(t, downstream, 5*time.Second); !bytes.Equal(got, payload) {
		t.Fatalf("corrupted frame changed the relayed byte stream")
	}
	stats := monitor.Snapshot()
	if stats.Frames != 2 || stats.CRCErrors != 1 {
		t.Fatalf("monitor frames=%d crcErrors=%d, want 2/1", stats.Frames, stats.CRCErrors)
	}
}

func Test2T5SlowClientDoesNotBlockOtherJobs(t *testing.T) {
	slowPayload := deterministicPayload(4 * 1024 * 1024)
	fastPayload := deterministicPayload(64 * 1024)

	slowUpstream := newMockServer(t, upstreamHandler(upstreamOptions{payload: slowPayload, fragment: 4096}))
	slowDownstream := newMockServer(t, downstreamHandler(downstreamOptions{readSize: 4096, delay: 5 * time.Millisecond}))
	fastUpstream := newMockServer(t, upstreamHandler(upstreamOptions{payload: fastPayload, fragment: 4096}))
	fastDownstream := newMockServer(t, downstreamHandler(downstreamOptions{}))

	slowCfg := testConfig(slowUpstream, slowDownstream, "source")
	fastCfg := testConfig(fastUpstream, fastDownstream, "source")

	slowCtx, slowCancel := context.WithCancel(context.Background())
	slowDone := make(chan error, 1)
	go func() {
		slowDone <- RunSession(slowCtx, slowCfg, Options{
			DialTimeout: 2 * time.Second, MonitorBuffer: 64, ReadBuffer: 8 * 1024, NMEAInterval: time.Hour,
		}, rtcm.NewMonitor(1<<20), &Metrics{})
	}()
	select {
	case <-slowDownstream.connected:
	case <-time.After(3 * time.Second):
		t.Fatal("slow session did not connect")
	}

	start := time.Now()
	if err := runBridge(fastCfg, rtcm.NewMonitor(1<<20), &Metrics{}, 10*time.Second); !acceptableBridgeError(err) {
		t.Fatalf("fast RunSession: %v", err)
	}
	elapsed := time.Since(start)
	if elapsed > 2*time.Second {
		t.Fatalf("fast job took %v while another client was slow", elapsed)
	}
	if got := waitCaptured(t, fastDownstream, 5*time.Second); !bytes.Equal(got, fastPayload) {
		t.Fatal("fast job payload mismatch")
	}
	select {
	case <-slowDone:
		t.Fatal("slow session finished before being cancelled; test did not exercise concurrency")
	default:
	}
	slowCancel()
	<-slowDone
}

func TestOnFirstByteFiresOnce(t *testing.T) {
	payload := deterministicPayload(4096)
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{payload: payload, fragment: 512}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")

	var calls atomic.Int32
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := RunSession(ctx, cfg, Options{
		DialTimeout:   2 * time.Second,
		MonitorBuffer: 16,
		ReadBuffer:    512,
		NMEAInterval:  time.Hour,
		OnFirstByte:   func() { calls.Add(1) },
	}, rtcm.NewMonitor(1<<20), &Metrics{})
	if !acceptableBridgeError(err) {
		t.Fatalf("RunSession: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("OnFirstByte calls = %d, want 1", got)
	}
}
