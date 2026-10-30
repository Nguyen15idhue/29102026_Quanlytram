package relay

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

type fakeResult int64

func (r fakeResult) LastInsertId() (int64, error) { return 0, nil }
func (r fakeResult) RowsAffected() (int64, error) { return int64(r), nil }

type fakeExec struct {
	results []int64
	calls   []fakeCall
}

type fakeCall struct {
	query string
	args  []any
}

func (f *fakeExec) ExecContext(_ context.Context, query string, args ...any) (sql.Result, error) {
	f.calls = append(f.calls, fakeCall{query: query, args: args})
	value := f.results[0]
	f.results = f.results[1:]
	return fakeResult(value), nil
}

func TestPruneOnceUsesRetentionAndBatches(t *testing.T) {
	exec := &fakeExec{results: []int64{10, 2, 3, 4}}
	options := RetentionOptions{SessionDays: 90, EventDays: 30, HourlyDays: 90, Batch: 10}
	if err := PruneOnce(context.Background(), exec, options); err != nil {
		t.Fatalf("PruneOnce: %v", err)
	}
	if len(exec.calls) != 4 {
		t.Fatalf("calls = %d, want 4", len(exec.calls))
	}
	if !strings.Contains(exec.calls[0].query, "end_ts IS NOT NULL") {
		t.Fatalf("session prune must keep open sessions: %s", exec.calls[0].query)
	}
	if !strings.Contains(exec.calls[1].query, "relay_sessions") {
		t.Fatalf("second session batch query = %s", exec.calls[1].query)
	}
	if !strings.Contains(exec.calls[2].query, "relay_events") {
		t.Fatalf("event prune query = %s", exec.calls[2].query)
	}
	if !strings.Contains(exec.calls[3].query, "relay_hourly") {
		t.Fatalf("hourly prune query = %s", exec.calls[3].query)
	}
	for _, call := range exec.calls {
		if len(call.args) != 2 {
			t.Fatalf("args = %v, want days + batch", call.args)
		}
	}
}

func TestRetentionOptionsDefaults(t *testing.T) {
	options := RetentionOptions{}.withDefaults()
	if options.SessionDays != 90 || options.EventDays != 30 || options.HourlyDays != 90 {
		t.Fatalf("unexpected defaults: %+v", options)
	}
	if options.Batch != 1000 || options.Interval <= 0 {
		t.Fatalf("unexpected batch/interval: %+v", options)
	}
}
