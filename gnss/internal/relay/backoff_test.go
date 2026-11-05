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

func TestRetryDelay(t *testing.T) {
	if got := retryDelay(authError()); got != 0 {
		t.Fatalf("401 retry delay = %v, want 0", got)
	}
	err := &ntrip.StatusError{Proto: "HTTP", Code: 429, Status: "Too Many Requests", RetryAfter: 3 * time.Second}
	if got := retryDelay(err); got != 3*time.Second {
		t.Fatalf("429 retry delay = %v, want 3s", got)
	}
	err.RetryAfter = 10 * time.Minute
	if got := retryDelay(err); got != 5*time.Minute {
		t.Fatalf("capped retry delay = %v, want 5m", got)
	}
}
