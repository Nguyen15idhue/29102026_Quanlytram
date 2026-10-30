package nmea

import (
	"strings"
	"testing"
	"time"
)

func parseHex(t *testing.T, value string) byte {
	t.Helper()
	var result byte
	for i := 0; i < len(value); i++ {
		result <<= 4
		switch {
		case value[i] >= '0' && value[i] <= '9':
			result |= value[i] - '0'
		case value[i] >= 'A' && value[i] <= 'F':
			result |= value[i] - 'A' + 10
		default:
			t.Fatalf("invalid hex digit %q", value[i])
		}
	}
	return result
}

func TestSentencesHaveValidChecksum(t *testing.T) {
	at := time.Date(2026, 10, 30, 12, 34, 56, 0, time.UTC)
	for _, value := range Sentences(21.0285, 105.8542, at) {
		if !strings.HasPrefix(value, "$GP") {
			t.Fatalf("unexpected sentence prefix: %q", value)
		}
		trimmed := strings.TrimSuffix(value, "\r\n")
		star := strings.LastIndex(trimmed, "*")
		if star < 0 {
			t.Fatalf("missing checksum: %q", value)
		}
		if got := parseHex(t, trimmed[star+1:]); got != checksum(trimmed[1:star]) {
			t.Fatalf("checksum mismatch: %q", value)
		}
	}
}

func TestJoinContainsAllSentences(t *testing.T) {
	payload := string(Join(10.5, 106.5, time.Now()))
	for _, prefix := range []string{"$GPGGA", "$GPGSA", "$GPRMC"} {
		if !strings.Contains(payload, prefix) {
			t.Fatalf("missing %s in payload", prefix)
		}
	}
}
