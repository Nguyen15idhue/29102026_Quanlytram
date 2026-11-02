package relay

import (
	"bytes"
	"context"
	"log"
	"strings"
	"sync"
	"testing"
	"time"

	"cors/gnss/internal/rtcm"
)

type fakeStore struct {
	mu   sync.Mutex
	jobs []*JobConfig
}

func (f *fakeStore) setJobs(jobs []*JobConfig) {
	f.mu.Lock()
	f.jobs = jobs
	f.mu.Unlock()
}

func (f *fakeStore) LoadAll(context.Context) ([]*JobConfig, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]*JobConfig{}, f.jobs...), nil
}

func (f *fakeStore) LoadJob(_ context.Context, id int64) (*JobConfig, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, job := range f.jobs {
		if job.ID == id {
			return job, nil
		}
	}
	return nil, nil
}

func waitFor(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}

func Test2T4JobReconnectsAndCountsRetries(t *testing.T) {
	payload := deterministicPayload(1024)
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{payload: payload, fragment: 512}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	writer := &MemoryWriter{}

	job := newJob(cfg, Options{
		DialTimeout:   time.Second,
		MonitorBuffer: 16,
		ReadBuffer:    512,
		NMEAInterval:  time.Hour,
		RetryMin:      10 * time.Millisecond,
		RetryMax:      20 * time.Millisecond,
	}, writer)
	ctx, cancel := context.WithCancel(context.Background())
	job.start(ctx)

	waitFor(t, 3*time.Second, func() bool {
		return len(writer.SessionWrites()) >= 2
	})
	cancel()
	select {
	case <-job.done:
	case <-time.After(3 * time.Second):
		t.Fatal("job did not stop")
	}

	sessions := writer.SessionWrites()
	if len(sessions) < 2 {
		t.Fatalf("sessions = %d, want >= 2", len(sessions))
	}
	if sessions[0].closeReason != "network" {
		t.Fatalf("close reason = %q, want network", sessions[0].closeReason)
	}
	if job.metrics.Snapshot(1).Retries < 1 {
		t.Fatal("expected retry counter to increase")
	}
}

func Test2T6ShutdownClosesSessionWithServiceRestart(t *testing.T) {
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{
		payload:  deterministicPayload(64),
		keepOpen: true,
		signal:   true,
	}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	writer := &MemoryWriter{}

	manager := NewManager(&fakeStore{jobs: []*JobConfig{cfg}}, writer, Options{
		DialTimeout:  time.Second,
		PollInterval: time.Hour,
		RetryMin:     10 * time.Millisecond,
		RetryMax:     20 * time.Millisecond,
		NMEAInterval: time.Hour,
	})
	ctx, cancel := context.WithCancel(context.Background())
	go manager.Run(ctx)

	select {
	case <-upstream.connected:
	case <-time.After(3 * time.Second):
		t.Fatal("job did not connect")
	}
	waitFor(t, 2*time.Second, func() bool {
		for _, state := range writer.StateWrites() {
			if state.state == "streaming" {
				return true
			}
		}
		return false
	})

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 3*time.Second)
	manager.Shutdown(shutdownCtx)
	shutdownCancel()
	cancel()

	found := false
	for _, session := range writer.SessionWrites() {
		if session.closeReason == "service_restart" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no service_restart session: %+v", writer.SessionWrites())
	}
}

func TestDisabledStateNotOverwrittenByStopped(t *testing.T) {
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{
		payload:  deterministicPayload(64),
		keepOpen: true,
		signal:   true,
	}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	writer := &MemoryWriter{}
	store := &fakeStore{jobs: []*JobConfig{cfg}}
	manager := NewManager(store, writer, Options{
		DialTimeout:  time.Second,
		PollInterval: time.Hour,
		RetryMin:     10 * time.Millisecond,
		RetryMax:     20 * time.Millisecond,
		NMEAInterval: time.Hour,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go manager.Run(ctx)

	waitFor(t, 3*time.Second, func() bool {
		for _, state := range writer.StateWrites() {
			if state.state == "streaming" {
				return true
			}
		}
		return false
	})

	disabled := *cfg
	disabled.Enabled = false
	store.setJobs([]*JobConfig{&disabled})
	if err := manager.Reconcile(ctx, []int64{cfg.ID}); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	waitFor(t, 2*time.Second, func() bool {
		for _, state := range writer.StateWrites() {
			if state.state == "disabled" {
				return true
			}
		}
		return false
	})
	time.Sleep(150 * time.Millisecond)
	states := writer.StateWrites()
	if last := states[len(states)-1]; last.state != "disabled" {
		t.Fatalf("last state = %q, want disabled", last.state)
	}
}

func TestDeleteClosesSessionWithDeletedReason(t *testing.T) {
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{
		payload:  deterministicPayload(64),
		keepOpen: true,
		signal:   true,
	}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	writer := &MemoryWriter{}
	store := &fakeStore{jobs: []*JobConfig{cfg}}
	manager := NewManager(store, writer, Options{
		DialTimeout:  time.Second,
		PollInterval: time.Hour,
		RetryMin:     10 * time.Millisecond,
		RetryMax:     20 * time.Millisecond,
		NMEAInterval: time.Hour,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go manager.Run(ctx)

	select {
	case <-upstream.connected:
	case <-time.After(3 * time.Second):
		t.Fatal("job did not connect")
	}
	waitFor(t, 2*time.Second, func() bool {
		for _, state := range writer.StateWrites() {
			if state.state == "streaming" {
				return true
			}
		}
		return false
	})

	store.setJobs(nil)
	if err := manager.Reconcile(ctx, []int64{cfg.ID}); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	waitFor(t, 3*time.Second, func() bool {
		for _, session := range writer.SessionWrites() {
			if session.closeReason == "deleted" {
				return true
			}
		}
		return false
	})
	if len(writer.SessionWrites()) == 0 {
		t.Fatal("history session was not kept")
	}
}

func Test2T8ManagerRefusesInternalCycle(t *testing.T) {
	a := &JobConfig{
		ID: 1, Name: "a", Enabled: true, DesiredRevision: 1,
		Upstream:   EndpointConfig{Host: "a", Port: 2101, Mount: "m", Key: "http://a:2101/m"},
		Downstream: EndpointConfig{Host: "b", Port: 2101, Mount: "m", Key: "http://b:2101/m"},
	}
	b := &JobConfig{
		ID: 2, Name: "b", Enabled: true, DesiredRevision: 1,
		Upstream:   EndpointConfig{Host: "b", Port: 2101, Mount: "m", Key: "http://b:2101/m"},
		Downstream: EndpointConfig{Host: "a", Port: 2101, Mount: "m", Key: "http://a:2101/m"},
	}
	writer := &MemoryWriter{}
	manager := NewManager(&fakeStore{jobs: []*JobConfig{a, b}}, writer, Options{
		PollInterval: time.Hour,
		RetryMin:     10 * time.Millisecond,
		RetryMax:     20 * time.Millisecond,
	})
	ctx, cancel := context.WithCancel(context.Background())
	go manager.Run(ctx)

	waitFor(t, 2*time.Second, func() bool {
		for _, state := range writer.StateWrites() {
			if state.state == "error" && strings.Contains(state.lastError, "loop") {
				return true
			}
		}
		return false
	})
	if len(writer.SessionWrites()) != 0 {
		t.Fatalf("cycle jobs started sessions: %+v", writer.SessionWrites())
	}
	cancel()
}

func Test2T9AuthFailureDoesNotLeakSecret(t *testing.T) {
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{
		status: "ICY 401 Unauthorized\r\n\r\n",
	}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	cfg.Upstream.Username = "relay-user"
	cfg.Upstream.Password = "fixture-credential-123"
	writer := &MemoryWriter{}

	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(previous)

	job := newJob(cfg, Options{
		DialTimeout:   time.Second,
		MonitorBuffer: 16,
		ReadBuffer:    512,
		NMEAInterval:  time.Hour,
		RetryMin:      10 * time.Millisecond,
		RetryMax:      20 * time.Millisecond,
	}, writer)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	job.start(ctx)
	<-job.done
	cancel()

	if strings.Contains(logs.String(), "fixture-credential-123") {
		t.Fatal("log output contains the plaintext credential")
	}
	for _, session := range writer.SessionWrites() {
		if strings.Contains(session.message, "fixture-credential-123") {
			t.Fatal("session message contains the plaintext credential")
		}
	}
}

func Test2T7BridgeKeepsStreamingWhenWriterIsDown(t *testing.T) {
	payload := deterministicPayload(256 * 1024)
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{
		payload:  payload,
		fragment: 4096,
		keepOpen: true,
	}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{
		readSize: 16 * 1024,
		progress: true,
	}))
	cfg := testConfig(upstream, downstream, "source")

	failingWriter := newBufferedWriterWithFlush(4, func(context.Context, []writeOp) error {
		return context.DeadlineExceeded
	})
	writerCtx, writerCancel := context.WithCancel(context.Background())
	go failingWriter.Run(writerCtx)

	job := newJob(cfg, Options{
		DialTimeout:   time.Second,
		MonitorBuffer: 64,
		ReadBuffer:    16 * 1024,
		NMEAInterval:  time.Hour,
		RetryMin:      time.Hour,
		RetryMax:      time.Hour,
	}, failingWriter)
	jobCtx, jobCancel := context.WithCancel(context.Background())
	job.start(jobCtx)

	waitFor(t, 10*time.Second, func() bool {
		for {
			select {
			case total := <-downstream.progress:
				if total >= len(payload) {
					return true
				}
			default:
				return false
			}
		}
	})

	jobCancel()
	select {
	case <-job.done:
	case <-time.After(3 * time.Second):
		t.Fatal("job did not stop")
	}
	writerCancel()
	select {
	case <-failingWriter.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("writer did not stop")
	}

	if got := waitCaptured(t, downstream, 5*time.Second); !bytes.Equal(got, payload) {
		t.Fatalf("payload mismatch while runtime writer was down: got %d bytes", len(got))
	}
	if failingWriter.Dropped() == 0 {
		t.Log("writer queue did not overflow during this short test")
	}
}

func TestMonitorDoesNotChangeRelayedBytes(t *testing.T) {
	payload := deterministicPayload(32 * 1024)
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{payload: payload, fragment: 333}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	monitor := rtcm.NewMonitor(4 * 1024)

	if err := runBridge(cfg, monitor, &Metrics{}, 10*time.Second); !acceptableBridgeError(err) {
		t.Fatalf("RunSession: %v", err)
	}
	if got := waitCaptured(t, downstream, 5*time.Second); !bytes.Equal(got, payload) {
		t.Fatal("monitor altered the relayed bytes")
	}
}

func TestComputeEnabledHonoursLockAndStation(t *testing.T) {
	cases := []struct {
		name           string
		configEnabled  bool
		locked         bool
		deleted        bool
		stationBlocked bool
		want           bool
	}{
		{"bình thường", true, false, false, false, true},
		{"đang tắt", false, false, false, false, false},
		{"bị khóa", true, true, false, false, false},
		{"đã xóa", true, false, true, false, false},
		{"trạm nguồn tắt/khóa", true, false, false, true, false},
	}
	for _, tc := range cases {
		if got := computeEnabled(tc.configEnabled, tc.locked, tc.deleted, tc.stationBlocked); got != tc.want {
			t.Fatalf("%s: computeEnabled = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestLockedJobStopsWithDisabledReason(t *testing.T) {
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{
		payload:  deterministicPayload(64),
		keepOpen: true,
		signal:   true,
	}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	cfg.ConfigEnabled = true
	writer := &MemoryWriter{}
	store := &fakeStore{jobs: []*JobConfig{cfg}}
	manager := NewManager(store, writer, Options{
		DialTimeout:  time.Second,
		PollInterval: time.Hour,
		RetryMin:     10 * time.Millisecond,
		RetryMax:     20 * time.Millisecond,
		NMEAInterval: time.Hour,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go manager.Run(ctx)

	waitFor(t, 3*time.Second, func() bool {
		for _, state := range writer.StateWrites() {
			if state.state == "streaming" {
				return true
			}
		}
		return false
	})

	locked := *cfg
	locked.Locked = true
	locked.Enabled = computeEnabled(locked.ConfigEnabled, true, false, false)
	store.setJobs([]*JobConfig{&locked})
	if err := manager.Reconcile(ctx, []int64{cfg.ID}); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	waitFor(t, 2*time.Second, func() bool {
		states := writer.StateWrites()
		return len(states) > 0 && states[len(states)-1].state == "disabled"
	})
	time.Sleep(150 * time.Millisecond)

	states := writer.StateWrites()
	last := states[len(states)-1]
	if last.state != "disabled" {
		t.Fatalf("last state = %q, want disabled", last.state)
	}
	if last.lastError != "" {
		t.Fatalf("last error = %q, want empty", last.lastError)
	}
	sawDisabled := false
	for _, session := range writer.SessionWrites() {
		if session.closeReason == "deleted" {
			t.Fatalf("locked job bị đóng với lý do deleted: %+v", session)
		}
		if session.closeReason == "disabled" {
			sawDisabled = true
		}
	}
	if !sawDisabled {
		t.Fatal("không có phiên đóng với lý do disabled")
	}
}

func TestStationLockedStopsRelayWithDisabledReason(t *testing.T) {
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{
		payload:  deterministicPayload(64),
		keepOpen: true,
		signal:   true,
	}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	cfg.ConfigEnabled = true
	writer := &MemoryWriter{}
	store := &fakeStore{jobs: []*JobConfig{cfg}}
	manager := NewManager(store, writer, Options{
		DialTimeout:  time.Second,
		PollInterval: time.Hour,
		RetryMin:     10 * time.Millisecond,
		RetryMax:     20 * time.Millisecond,
		NMEAInterval: time.Hour,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go manager.Run(ctx)

	waitFor(t, 3*time.Second, func() bool {
		for _, state := range writer.StateWrites() {
			if state.state == "streaming" {
				return true
			}
		}
		return false
	})

	blocked := *cfg
	blocked.StationBlocked = true
	blocked.Enabled = computeEnabled(blocked.ConfigEnabled, false, false, true)
	store.setJobs([]*JobConfig{&blocked})
	if err := manager.Reconcile(ctx, []int64{cfg.ID}); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	waitFor(t, 2*time.Second, func() bool {
		states := writer.StateWrites()
		return len(states) > 0 && states[len(states)-1].state == "disabled"
	})
	for _, session := range writer.SessionWrites() {
		if session.closeReason == "deleted" {
			t.Fatalf("relay bị trạm khóa lại đóng với lý do deleted: %+v", session)
		}
	}
}

func TestLockedEnabledRowNeverStreams(t *testing.T) {
	upstream := newMockServer(t, upstreamHandler(upstreamOptions{
		payload:  deterministicPayload(64),
		keepOpen: true,
		signal:   true,
	}))
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))
	cfg := testConfig(upstream, downstream, "source")
	cfg.ConfigEnabled = true
	cfg.Locked = true
	cfg.Enabled = computeEnabled(true, true, false, false)
	writer := &MemoryWriter{}
	store := &fakeStore{jobs: []*JobConfig{cfg}}
	manager := NewManager(store, writer, Options{
		DialTimeout:  time.Second,
		PollInterval: time.Hour,
		RetryMin:     10 * time.Millisecond,
		RetryMax:     20 * time.Millisecond,
		NMEAInterval: time.Hour,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go manager.Run(ctx)

	waitFor(t, 2*time.Second, func() bool {
		for _, state := range writer.StateWrites() {
			if state.state == "disabled" {
				return true
			}
		}
		return false
	})
	time.Sleep(250 * time.Millisecond)
	for _, state := range writer.StateWrites() {
		if state.state == "streaming" {
			t.Fatal("relay đang khóa nhưng vẫn stream")
		}
	}
	select {
	case <-upstream.connected:
		t.Fatal("relay đang khóa vẫn mở kết nối upstream")
	default:
	}
}
