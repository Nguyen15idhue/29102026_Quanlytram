package relay

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"cors/gnss/internal/ntrip"
	"cors/gnss/internal/rtcm"
)

type Job struct {
	cfg     *JobConfig
	opts    Options
	writer  RuntimeWriter
	monitor *rtcm.Monitor
	metrics *Metrics

	mu         sync.Mutex
	stopReason string
	cancel     context.CancelFunc
	done       chan struct{}
}

func newJob(cfg *JobConfig, opts Options, writer RuntimeWriter) *Job {
	return &Job{
		cfg:     cfg,
		opts:    opts,
		writer:  writer,
		monitor: rtcm.NewMonitor(64 * 1024),
		metrics: &Metrics{},
		done:    make(chan struct{}),
	}
}

func (j *Job) start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	j.cancel = cancel
	j.writer.State(j.cfg.ID, "connecting", j.cfg.DesiredRevision, "")
	j.metrics.SetState("connecting", j.cfg.DesiredRevision, "")
	go j.run(ctx)
}

func (j *Job) stop(reason string) {
	j.mu.Lock()
	if j.stopReason == "" {
		j.stopReason = reason
	}
	cancel := j.cancel
	j.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (j *Job) currentStopReason() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.stopReason
}

func (j *Job) run(ctx context.Context) {
	defer close(j.done)

	backoff := NewBackoff(j.opts.RetryMin, j.opts.RetryMax)
	sessionOpts := j.opts
	sessionOpts.OnFirstByte = func() {
		j.writer.State(j.cfg.ID, "streaming", j.cfg.DesiredRevision, "")
		j.metrics.SetState("streaming", j.cfg.DesiredRevision, "")
	}
	for {
		if ctx.Err() != nil {
			return
		}

		j.writer.State(j.cfg.ID, "connecting", j.cfg.DesiredRevision, "")
		j.metrics.SetState("connecting", j.cfg.DesiredRevision, "")

		start := time.Now().UTC().Truncate(time.Millisecond)
		j.monitor.Reset()
		if starter, ok := j.writer.(SessionStartWriter); ok {
			starter.SessionStart(j.cfg.ID, start)
		}
		err := RunSession(ctx, j.cfg, sessionOpts, j.monitor, j.metrics)
		end := time.Now()

		stats := j.monitor.Snapshot()
		j.metrics.SetFrames(stats.Frames, stats.CRCErrors)
		j.metrics.SessionStarted()

		reason := j.currentStopReason()
		if reason == "" {
			reason = classify(err)
		}
		result := "error"
		if err == nil {
			result = "ok"
		}
		message := messageFor(err)
		j.writer.Session(j.cfg.ID, start, end, result, reason, message)

		duration := int(end.Sub(start).Seconds())
		errorCount := 0
		if result != "ok" {
			errorCount = 1
		}
		for index, bucket := range splitSessionHours(start, end) {
			sessions := 0
			errors := 0
			timeouts := 0
			authErrors := 0
			proxyErrors := 0
			retries := 0
			if index == 0 {
				sessions = 1
				errors = errorCount
				timeouts = boolToInt(reason == "timeout")
				authErrors = boolToInt(reason == "auth_failed")
				proxyErrors = boolToInt(strings.Contains(strings.ToLower(message), "proxy"))
				retries = 1
			}
			j.writer.Hourly(
				j.cfg.ID,
				bucket.hour,
				bucket.seconds,
				sessions,
				errors,
				timeouts,
				authErrors,
				proxyErrors,
				0,
				retries,
			)
		}

		if ctx.Err() != nil {
			return
		}

		j.metrics.Retry()
		j.writer.Event(j.cfg.ID, "reconnect", reason, duration)
		if end.Sub(start) > 30*time.Second {
			backoff.Reset()
		}
		wait := backoff.Next()
		if delay := retryDelay(err); delay > wait {
			wait = delay
		}
		j.writer.State(j.cfg.ID, "backoff", j.cfg.DesiredRevision, message)
		j.metrics.SetState("backoff", j.cfg.DesiredRevision, message)

		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func retryDelay(err error) time.Duration {
	var status *ntrip.StatusError
	if errors.As(err, &status) && status.RetryAfter > 0 {
		if status.RetryAfter > 5*time.Minute {
			return 5 * time.Minute
		}
		return status.RetryAfter
	}
	return 0
}

func classify(err error) string {
	if err == nil {
		return "network"
	}
	var status *ntrip.StatusError
	if errors.As(err, &status) {
		if status.Code == 401 || status.Code == 403 {
			return "auth_failed"
		}
		return "network"
	}
	if errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err) {
		return "timeout"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "timeout"
	}
	return "network"
}

func messageFor(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 400 {
		message = message[:400]
	}
	return message
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
