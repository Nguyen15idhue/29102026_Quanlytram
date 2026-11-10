package quality

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func benchFrame(b *testing.B) []byte {
	b.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "1077.bin"))
	if err != nil {
		b.Fatalf("read fixture: %v", err)
	}
	return data
}

func benchAnalyzer(b *testing.B, targets int) *Analyzer {
	b.Helper()
	analyzer := NewAnalyzer(DefaultOptions(), nil)
	frame := benchFrame(b)
	now := time.Now().UTC()
	for index := 0; index < targets; index++ {
		target := Target{Type: TargetStation, ID: int64(index + 1), Direction: DirectionIngest}
		state := newTargetState(target)
		state.ingest(frame, now, DefaultOptions().GapThreshold, DefaultOptions().ResetAfter, 0)
		analyzer.targets[target.Key()] = state
	}
	return analyzer
}

func BenchmarkEvaluate(b *testing.B) {
	analyzer := benchAnalyzer(b, 129)
	now := time.Now().UTC()
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		analyzer.evaluate(now.Add(time.Duration(index) * time.Second))
	}
}

// BenchmarkEvaluateDetailSnapshot mô phỏng đường cũ: mỗi tick đánh giá tính cả
// sky plot + danh sách signal cho toàn bộ target.
func BenchmarkEvaluateDetailSnapshot(b *testing.B) {
	analyzer := benchAnalyzer(b, 129)
	now := time.Now().UTC()
	opts := DefaultOptions()
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		analyzer.mu.Lock()
		for _, state := range analyzer.targets {
			_ = state.snapshot(now.Add(time.Duration(index)*time.Second), opts)
		}
		analyzer.mu.Unlock()
	}
}

func BenchmarkSnapshotSummary(b *testing.B) {
	analyzer := benchAnalyzer(b, 1)
	state := analyzer.targets[Target{Type: TargetStation, ID: 1, Direction: DirectionIngest}.Key()]
	now := time.Now().UTC()
	opts := DefaultOptions()
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		_ = state.summarySnapshot(now, opts)
	}
}
