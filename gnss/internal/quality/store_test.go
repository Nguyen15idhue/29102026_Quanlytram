package quality

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeExec struct {
	query string
	rows  int64
	err   error
}

func (f *fakeExec) ExecContext(_ context.Context, query string, _ ...any) (sql.Result, error) {
	f.query = query
	if f.err != nil {
		return nil, f.err
	}
	return fakeResult(f.rows), nil
}

type fakeResult int64

func (f fakeResult) LastInsertId() (int64, error) { return 0, nil }
func (f fakeResult) RowsAffected() (int64, error) { return int64(f), nil }

func TestResolveAllOpenClosesEveryOpenAlert(t *testing.T) {
	exec := &fakeExec{rows: 63}
	rows, err := resolveAllOpen(context.Background(), exec)
	if err != nil {
		t.Fatalf("resolveAllOpen: %v", err)
	}
	if rows != 63 {
		t.Fatalf("rows = %d, want 63", rows)
	}
	if !strings.Contains(exec.query, "SET resolved_at = UTC_TIMESTAMP(3)") ||
		!strings.Contains(exec.query, "WHERE resolved_at IS NULL") {
		t.Fatalf("unexpected query: %s", exec.query)
	}
}

func TestResolveAllOpenPropagatesError(t *testing.T) {
	exec := &fakeExec{err: errors.New("db down")}
	if _, err := resolveAllOpen(context.Background(), exec); err == nil {
		t.Fatal("expected error")
	}
}

func TestAsyncStoreUsesLongerTimeoutForSamples(t *testing.T) {
	async := NewAsyncStore(&fakeStore{}, 4)
	defer func() { async.storeTimeout = 4 * time.Second }()
	if got := async.timeoutFor(opSamples); got != 15*time.Second {
		t.Fatalf("sample timeout = %s, want 15s", got)
	}
	if got := async.timeoutFor(opStats); got != 10*time.Second {
		t.Fatalf("stats timeout = %s, want 10s", got)
	}
	if got := async.timeoutFor(opAlert); got != 5*time.Second {
		t.Fatalf("alert timeout = %s, want 5s", got)
	}
	// Khi test hạ storeTimeout (hành vi cũ) thì mọi loại dùng mức chung.
	async.sampleTimeout = 0
	if got := async.timeoutFor(opSamples); got != async.storeTimeout {
		t.Fatalf("fallback timeout = %s, want %s", got, async.storeTimeout)
	}
}

func TestScoreCacheInvalidatedWhenStateChanges(t *testing.T) {
	target := Target{Type: TargetStation, ID: 1}
	state := newTargetState(target)
	opts := DefaultOptions()
	now := time.Now().UTC()

	// Không có dữ liệu: trạng thái stale/unknown, điểm 0 được cache lại.
	state.lastDataAt = now.Add(-time.Minute)
	state.frames = 100
	stale := state.snapshot(now, opts)
	if stale.Score != 0 {
		t.Fatalf("stale score = %d, want 0", stale.Score)
	}

	// Vừa có dữ liệu lại trong cùng 5 s: phải tính lại điểm ngay, không dùng
	// cache 0 của trạng thái stale (D20-6).
	state.lastDataAt = now.Add(-200 * time.Millisecond)
	state.frames = 120
	streaming := state.snapshot(now, opts)
	if streaming.State != "streaming" {
		t.Fatalf("state = %s, want streaming", streaming.State)
	}
	if streaming.Score == 0 {
		t.Fatal("streaming score reused stale cache 0")
	}
}
