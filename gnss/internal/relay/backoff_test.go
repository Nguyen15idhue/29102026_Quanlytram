package relay

import (
	"testing"
	"time"

	"cors/gnss/internal/ntrip"
)

func authError() error {
	return &ntrip.StatusError{Proto: "ICY", Code: 401, Status: "Unauthorized"}
}

type deadlineError struct{}

func (deadlineError) Error() string   { return "deadline exceeded" }
func (deadlineError) Timeout() bool   { return true }
func (deadlineError) Temporary() bool { return false }

func TestBackoffGrowsAndCaps(t *testing.T) {
	backoff := NewBackoff(100*time.Millisecond, 800*time.Millisecond)
	first := backoff.Next()
	if first < 80*time.Millisecond || first > 120*time.Millisecond {
		t.Fatalf("first wait = %v, want ~100ms with jitter", first)
	}
	for i := 0; i < 20; i++ {
		wait := backoff.Next()
		if wait > 960*time.Millisecond {
			t.Fatalf("wait = %v exceeds capped maximum", wait)
		}
	}
	backoff.Reset()
	reset := backoff.Next()
	if reset > 120*time.Millisecond {
		t.Fatalf("reset wait = %v, want ~100ms", reset)
	}
}

func TestClassify(t *testing.T) {
	if got := classify(nil); got != "network" {
		t.Fatalf("nil = %q", got)
	}
	if got := classify(authError()); got != "auth_failed" {
		t.Fatalf("auth = %q", got)
	}
	if got := classify(deadlineError{}); got != "timeout" {
		t.Fatalf("timeout = %q", got)
	}
}
