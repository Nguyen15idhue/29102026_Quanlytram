package caster

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
)

type fakeExec struct {
	query string
	args  []any
	rows  int64
	err   error
}

func (f *fakeExec) ExecContext(_ context.Context, query string, args ...any) (sql.Result, error) {
	f.query = query
	f.args = args
	if f.err != nil {
		return nil, f.err
	}
	return fakeResult(f.rows), nil
}

type fakeResult int64

func (f fakeResult) LastInsertId() (int64, error) { return 0, nil }
func (f fakeResult) RowsAffected() (int64, error) { return int64(f), nil }

func TestCloseOpenConnectionsSetsEndAndReason(t *testing.T) {
	exec := &fakeExec{rows: 58}
	rows, err := closeOpenConnections(context.Background(), exec, "service_restart")
	if err != nil {
		t.Fatalf("closeOpenConnections: %v", err)
	}
	if rows != 58 {
		t.Fatalf("rows = %d, want 58", rows)
	}
	if !strings.Contains(exec.query, "end_ts = UTC_TIMESTAMP(3)") ||
		!strings.Contains(exec.query, "WHERE end_ts IS NULL") {
		t.Fatalf("unexpected query: %s", exec.query)
	}
	if len(exec.args) != 1 || exec.args[0] != "service_restart" {
		t.Fatalf("args = %#v", exec.args)
	}
}

func TestCloseOpenConnectionsPropagatesError(t *testing.T) {
	exec := &fakeExec{err: errors.New("db down")}
	if _, err := closeOpenConnections(context.Background(), exec, "service_restart"); err == nil {
		t.Fatal("expected error")
	}
}
