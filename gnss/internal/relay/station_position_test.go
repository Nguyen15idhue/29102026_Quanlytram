package relay

import (
	"encoding/hex"
	"math"
	"testing"
	"time"

	"cors/gnss/internal/rtcm"
)

// 1006 thật lấy từ luồng THA_HauLoc (payload, chưa có header/CRC).
const payload1006Hex = "3ee1e303bc28c5f61d8d6be0f8c1050c0af9d10000"

func mustHex(t *testing.T, value string) []byte {
	t.Helper()
	decoded, err := hex.DecodeString(value)
	if err != nil {
		t.Fatalf("decode hex: %v", err)
	}
	return decoded
}

func buildTestFrame(payload []byte) []byte {
	length := len(payload)
	frame := make([]byte, 0, 3+length+3)
	frame = append(frame, rtcm.Preamble, byte(length>>8)&0x03, byte(length))
	frame = append(frame, payload...)
	crc := rtcm.CRC24Q(frame)
	frame = append(frame, byte(crc>>16), byte(crc>>8), byte(crc))
	return frame
}

func TestPositionFromPayload1006(t *testing.T) {
	payload := mustHex(t, payload1006Hex)
	lat, lon, ok := positionFromPayload(payload)
	if !ok {
		t.Fatalf("no position from 1006 payload")
	}
	if math.Abs(lat-19.999946989) > 1e-4 {
		t.Fatalf("lat = %.9f, want ~19.999946989", lat)
	}
	if math.Abs(lon-105.969244330) > 1e-4 {
		t.Fatalf("lon = %.9f, want ~105.969244330", lon)
	}
}

func TestFramePositionScannerHandlesPartialFrames(t *testing.T) {
	payload := mustHex(t, payload1006Hex)
	frame := buildTestFrame(payload)
	tracker := newPositionTracker(nil, nil)
	scanner := newFramePositionScanner(tracker)

	// Cắt frame ở nhiều điểm để mô phỏng read trả mảnh.
	for _, part := range [][]byte{frame[:1], frame[1:4], frame[4:10], frame[10:]} {
		scanner.Feed(part)
	}

	select {
	case <-tracker.readyCh():
	case <-time.After(time.Second):
		t.Fatalf("scanner did not find position")
	}
	lat, lon, ok := tracker.get()
	if !ok || math.Abs(lat-19.999946989) > 1e-4 || math.Abs(lon-105.969244330) > 1e-4 {
		t.Fatalf("tracker position = %.9f,%.9f ok=%v", lat, lon, ok)
	}
}

func TestFramePositionScannerIgnoresCrcErrors(t *testing.T) {
	payload := mustHex(t, payload1006Hex)
	frame := buildTestFrame(payload)
	corrupt := append([]byte(nil), frame...)
	corrupt[len(corrupt)-1] ^= 0xFF
	tracker := newPositionTracker(nil, nil)
	scanner := newFramePositionScanner(tracker)

	scanner.Feed(corrupt)
	select {
	case <-tracker.readyCh():
		t.Fatalf("corrupt frame must not yield a position")
	case <-time.After(50 * time.Millisecond):
	}
	scanner.Feed(frame)
	select {
	case <-tracker.readyCh():
	case <-time.After(time.Second):
		t.Fatalf("valid frame after corrupt was not parsed")
	}
}

func TestNewPositionTrackerUsesConfiguredCoordinate(t *testing.T) {
	lat, lon := 21.0278, 105.8342
	tracker := newPositionTracker(&lat, &lon)
	select {
	case <-tracker.readyCh():
	case <-time.After(time.Second):
		t.Fatalf("configured coordinate not ready immediately")
	}
	gotLat, gotLon, ok := tracker.get()
	if !ok || gotLat != lat || gotLon != lon {
		t.Fatalf("tracker = %.6f,%.6f ok=%v", gotLat, gotLon, ok)
	}
}
