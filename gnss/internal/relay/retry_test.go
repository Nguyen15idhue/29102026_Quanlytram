package relay

import (
	"errors"
	"testing"
	"time"

	"cors/gnss/internal/ntrip"
)

func TestRetryBaseDelay(t *testing.T) {
	minimum := 5 * time.Second
	maximum := 60 * time.Second
	cases := []struct {
		name    string
		err     error
		session time.Duration
		retry   int
		min     time.Duration
		max     time.Duration
		want    time.Duration
	}{
		{
			name:    "permanent 401",
			err:     &ntrip.StatusError{Code: 401},
			session: 5 * time.Minute,
			retry:   1,
			min:     minimum,
			max:     maximum,
			want:    30 * time.Second,
		},
		{
			name:    "permanent 404 capped at max",
			err:     &ntrip.StatusError{Code: 404},
			session: 5 * time.Minute,
			retry:   1,
			min:     20 * time.Second,
			max:     maximum,
			want:    maximum,
		},
		{
			name:    "short session before permanent check",
			err:     errors.New("connection reset by peer"),
			session: 10 * time.Second,
			retry:   1,
			min:     minimum,
			max:     maximum,
			want:    20 * time.Second,
		},
		{
			name:    "temporary first retry",
			err:     errors.New("i/o timeout"),
			session: 2 * time.Minute,
			retry:   1,
			min:     minimum,
			max:     maximum,
			want:    5 * time.Second,
		},
		{
			name:    "temporary third retry",
			err:     errors.New("connection refused"),
			session: 2 * time.Minute,
			retry:   3,
			min:     minimum,
			max:     maximum,
			want:    20 * time.Second,
		},
		{
			name:    "temporary capped at max",
			err:     errors.New("dial tcp: no route to host"),
			session: 2 * time.Minute,
			retry:   10,
			min:     minimum,
			max:     maximum,
			want:    maximum,
		},
		{
			name:    "unknown linear",
			err:     errors.New("unexpected upstream failure"),
			session: 2 * time.Minute,
			retry:   2,
			min:     minimum,
			max:     maximum,
			want:    10 * time.Second,
		},
		{
			name:    "unknown capped at max",
			err:     errors.New("unexpected upstream failure"),
			session: 2 * time.Minute,
			retry:   20,
			min:     minimum,
			max:     maximum,
			want:    maximum,
		},
		{
			name:    "zero retry treated as first",
			err:     errors.New("unexpected upstream failure"),
			session: 2 * time.Minute,
			retry:   0,
			min:     minimum,
			max:     maximum,
			want:    5 * time.Second,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := retryBaseDelay(tc.err, tc.session, tc.retry, tc.min, tc.max)
			if got != tc.want {
				t.Fatalf("retryBaseDelay() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestClassifyDelayJitterWithinTenPercent(t *testing.T) {
	minimum := 5 * time.Second
	maximum := 60 * time.Second
	err := errors.New("i/o timeout")
	base := retryBaseDelay(err, 2*time.Minute, 1, minimum, maximum)
	lower := time.Duration(float64(base) * 0.9)
	upper := time.Duration(float64(base) * 1.1)

	for i := 0; i < 500; i++ {
		got := classifyDelay(err, 2*time.Minute, 1, minimum, maximum)
		if got < lower || got > upper {
			t.Fatalf("classifyDelay() = %v ngoài biên ±10%% [%v, %v]", got, lower, upper)
		}
	}
}

func TestClassifyDelayJitterVaries(t *testing.T) {
	minimum := 5 * time.Second
	maximum := 60 * time.Second
	err := errors.New("i/o timeout")
	first := classifyDelay(err, 2*time.Minute, 1, minimum, maximum)
	varied := false
	for i := 0; i < 50; i++ {
		if classifyDelay(err, 2*time.Minute, 1, minimum, maximum) != first {
			varied = true
			break
		}
	}
	if !varied {
		t.Fatal("jitter không thay đổi sau 50 lần; retry của nhiều job sẽ trùng nhịp")
	}
}

func TestRetryBaseDelayFallsBackToDefaultMinimum(t *testing.T) {
	got := retryBaseDelay(errors.New("boom"), time.Minute, 1, 0, 0)
	if got != 5*time.Second {
		t.Fatalf("minimum mặc định = %v, want 5s", got)
	}
}

func TestPermanentErrorClassification(t *testing.T) {
	if !isPermanentError(&ntrip.StatusError{Code: 403}) {
		t.Fatal("403 phải là permanent")
	}
	if isPermanentError(errors.New("i/o timeout")) {
		t.Fatal("timeout không được coi là permanent")
	}
	if isPermanentError(nil) {
		t.Fatal("nil không phải permanent")
	}
}

func TestTemporaryErrorClassification(t *testing.T) {
	for _, message := range []string{
		"read tcp: i/o timeout",
		"connection reset by peer",
		"dial tcp 127.0.0.1:2101: connect: connection refused",
	} {
		if !isTemporaryError(errors.New(message)) {
			t.Fatalf("%q phải là temporary", message)
		}
	}
	if isTemporaryError(errors.New("boom")) {
		t.Fatal("lỗi không rõ không được coi là temporary")
	}
}

func TestRandomStartStaggerBounds(t *testing.T) {
	for i := 0; i < 1000; i++ {
		got := randomStartStagger()
		if got < 0 || got > startStaggerMax {
			t.Fatalf("randomStartStagger() = %v ngoài [0, %v]", got, startStaggerMax)
		}
	}
}
