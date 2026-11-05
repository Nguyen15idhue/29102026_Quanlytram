package relay

import (
	"context"
	"strings"
	"testing"
)

func TestCloseStaleSessions(t *testing.T) {
	exec := &fakeExec{results: []int64{3}}
	closed, err := CloseStaleSessions(context.Background(), exec)
	if err != nil {
		t.Fatalf("CloseStaleSessions: %v", err)
	}
	if closed != 3 {
		t.Fatalf("closed = %d, want 3", closed)
	}
	if len(exec.calls) != 1 {
		t.Fatalf("calls = %d, want 1", len(exec.calls))
	}
	query := exec.calls[0].query
	if !strings.Contains(query, "end_ts IS NULL") || !strings.Contains(query, "service_restart") {
		t.Fatalf("query không đúng: %s", query)
	}
}
