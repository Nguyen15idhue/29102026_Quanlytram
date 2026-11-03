package api

import (
	"context"
	"testing"

	"cors/gnss/internal/relay"
)

type fakeRelayManager struct {
	degraded bool
}

func (f fakeRelayManager) Reconcile(context.Context, []int64) error { return nil }

func (f fakeRelayManager) Test(context.Context, int64) relay.TestResult {
	return relay.TestResult{}
}

func (f fakeRelayManager) Snapshot() []relay.MetricsSnapshot { return nil }

func (f fakeRelayManager) Degraded() bool { return f.degraded }

// Manager cũ không cài Degraded(); /health phải coi là bình thường thay vì panic.
type plainRelayManager struct{}

func (plainRelayManager) Reconcile(context.Context, []int64) error { return nil }

func (plainRelayManager) Test(context.Context, int64) relay.TestResult {
	return relay.TestResult{}
}

func (plainRelayManager) Snapshot() []relay.MetricsSnapshot { return nil }

func TestRelayDegradedFromManager(t *testing.T) {
	cases := []struct {
		name    string
		manager RelayManager
		want    bool
	}{
		{name: "nil manager", manager: nil, want: false},
		{name: "healthy", manager: fakeRelayManager{degraded: false}, want: false},
		{name: "degraded", manager: fakeRelayManager{degraded: true}, want: true},
		{name: "không hỗ trợ Degraded", manager: plainRelayManager{}, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := relayDegraded(tc.manager); got != tc.want {
				t.Fatalf("relayDegraded() = %v, want %v", got, tc.want)
			}
		})
	}
}
