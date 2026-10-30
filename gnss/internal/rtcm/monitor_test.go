package rtcm

import (
	"bytes"
	"testing"
)

func makeFrame(payload []byte) []byte {
	length := len(payload)
	frame := []byte{Preamble, byte(length>>8) & 0x03, byte(length)}
	frame = append(frame, payload...)
	crc := CRC24Q(frame)
	return append(frame, byte(crc>>16), byte(crc>>8), byte(crc))
}

func TestCRC24QStable(t *testing.T) {
	if CRC24Q(nil) != 0 {
		t.Fatalf("CRC24Q(empty) = %d, want 0", CRC24Q(nil))
	}
	frame := makeFrame([]byte{0x01, 0x02, 0x03})
	if got := CRC24Q(frame[:len(frame)-3]); got == 0 {
		t.Fatal("CRC24Q should be non-zero for a non-empty payload")
	}
}

func TestMonitorCountsFramesAcrossOneByteReads(t *testing.T) {
	first := makeFrame([]byte{1, 2, 3, 4})
	second := makeFrame([]byte{5, 6, 7})
	monitor := NewMonitor(1024)
	for _, b := range append(first, second...) {
		monitor.Feed([]byte{b})
	}
	stats := monitor.Snapshot()
	if stats.Frames != 2 {
		t.Fatalf("Frames = %d, want 2", stats.Frames)
	}
	if stats.CRCErrors != 0 {
		t.Fatalf("CRCErrors = %d, want 0", stats.CRCErrors)
	}
}

func TestMonitorResyncsAfterGarbage(t *testing.T) {
	monitor := NewMonitor(1024)
	monitor.Feed([]byte{0x00, 0x11, 0x22})
	monitor.Feed(makeFrame([]byte{9, 9, 9}))
	if stats := monitor.Snapshot(); stats.Frames != 1 {
		t.Fatalf("Frames = %d, want 1", stats.Frames)
	}
}

func TestMonitorCountsBadCRC(t *testing.T) {
	frame := makeFrame([]byte{1, 2, 3})
	frame[len(frame)-1] ^= 0xFF
	monitor := NewMonitor(1024)
	monitor.Feed(frame)
	monitor.Feed(makeFrame([]byte{4, 5, 6}))
	stats := monitor.Snapshot()
	if stats.CRCErrors != 1 {
		t.Fatalf("CRCErrors = %d, want 1", stats.CRCErrors)
	}
	if stats.Frames != 1 {
		t.Fatalf("Frames = %d, want 1", stats.Frames)
	}
}

func TestMonitorBoundedBuffer(t *testing.T) {
	monitor := NewMonitor(MaxFrame)
	junk := bytes.Repeat([]byte{0xAA}, MaxFrame*4)
	monitor.Feed(junk)
	if stats := monitor.Snapshot(); stats.Dropped == 0 {
		t.Fatal("expected dropped bytes for oversized buffer")
	}
}
