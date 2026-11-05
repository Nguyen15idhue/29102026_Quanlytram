package relay

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEventThrottlesByJobAndType(t *testing.T) {
	var mu sync.Mutex
	var events []writeOp
	writer := newBufferedWriterWithFlush(128, func(_ context.Context, ops []writeOp) error {
		mu.Lock()
		events = append(events, ops...)
		mu.Unlock()
		return nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go writer.Run(ctx)

	now := time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)
	writer.eventWindow = 60 * time.Second
	writer.now = func() time.Time { return now }

	// 100 lần trong cùng 10 giây: chỉ 1 event được ghi.
	for index := 0; index < 100; index++ {
		writer.Event(1, "reconnect", "timeout", 0)
	}
	// Sang cửa sổ mới: ghi thêm 1 event kèm số đã gộp.
	now = now.Add(61 * time.Second)
	writer.Event(1, "reconnect", "timeout", 0)
	// Job khác và type khác không bị gộp chung.
	writer.Event(2, "reconnect", "other job", 0)
	writer.Event(1, "auth_failed", "other type", 0)

	deadline := time.Now().Add(3 * time.Second)
	for {
		mu.Lock()
		count := len(events)
		mu.Unlock()
		if count >= 4 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("chỉ ghi %d event, mong đợi 4", count)
		}
		time.Sleep(10 * time.Millisecond)
	}

	cancel()
	select {
	case <-writer.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("writer không dừng")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 4 {
		t.Fatalf("events = %d, want 4", len(events))
	}
	var merged *writeOp
	for index := range events {
		event := &events[index]
		if event.jobID == 1 && event.eventType == "reconnect" &&
			strings.Contains(event.message, "gộp") {
			merged = event
		}
	}
	if merged == nil {
		t.Fatal("không thấy event tổng hợp cho (job 1, reconnect)")
	}
	if !strings.Contains(merged.message, "gộp 99 sự kiện") {
		t.Fatalf("message = %q, want gộp 99 sự kiện", merged.message)
	}
}
