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

func TestGGAWithFixEncodesQuality(t *testing.T) {
	at := time.Date(2026, 11, 5, 1, 2, 3, 0, time.UTC)
	cases := []struct {
		quality int
		age     float64
	}{
		{quality: 1},
		{quality: 2, age: 2.5},
		{quality: 4},
		{quality: 5, age: 1.2},
	}
	for _, tc := range cases {
		line := GGAWithFix(21.818899, 104.6796, at, FixInfo{
			Quality: tc.quality, Satellites: 12, HDOP: 0.9, AgeOfDiff: tc.age, Altitude: 100,
		})
		fields := strings.Split(strings.TrimSuffix(line, "\r\n"), ",")
		if fields[6] != string(rune('0'+tc.quality)) {
			t.Fatalf("quality field = %q, want %d (%q)", fields[6], tc.quality, line)
		}
		if fields[7] != "12" {
			t.Fatalf("satellites = %q", fields[7])
		}
		if fields[2] != "2149.13394" || fields[3] != "N" {
			t.Fatalf("latitude = %q %q", fields[2], fields[3])
		}
		if fields[4] != "10440.77600" || fields[5] != "E" {
			t.Fatalf("longitude = %q %q", fields[4], fields[5])
		}
		if tc.age > 0 && fields[13] == "" {
			t.Fatalf("missing age of differential: %q", line)
		}
	}
}
