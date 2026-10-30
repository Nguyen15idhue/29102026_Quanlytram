package relay

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestBufferedWriterDoesNotBlockAndDropsWhenBackendFails(t *testing.T) {
	var calls atomic.Int64
	writer := newBufferedWriterWithFlush(4, func(context.Context, []writeOp) error {
		calls.Add(1)
		return errors.New("db down")
	})
	ctx, cancel := context.WithCancel(context.Background())
	go writer.Run(ctx)

	start := time.Now()
	for i := 0; i < 200; i++ {
		writer.State(int64(i), "streaming", 1, "")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("enqueue blocked for %v with a failing backend", elapsed)
	}

	time.Sleep(100 * time.Millisecond)
	if calls.Load() == 0 {
		t.Fatal("expected the writer to attempt a flush")
	}
	if writer.Dropped() == 0 {
		t.Fatal("expected dropped operations to be counted")
	}

	cancel()
	select {
	case <-writer.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("writer did not stop")
	}
}

func TestBufferedWriterFlushesAfterBackendRecovers(t *testing.T) {
	var failures atomic.Int64
	var flushed atomic.Int64
	writer := newBufferedWriterWithFlush(64, func(_ context.Context, ops []writeOp) error {
		if failures.Add(1) <= 2 {
			return errors.New("db down")
		}
		flushed.Add(int64(len(ops)))
		return nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	go writer.Run(ctx)

	for i := 0; i < 10; i++ {
		writer.State(int64(i), "streaming", 1, "")
	}
	deadline := time.Now().Add(3 * time.Second)
	for flushed.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if flushed.Load() == 0 {
		t.Fatal("writer did not flush after the backend recovered")
	}
	cancel()
	<-writer.Done()
}
