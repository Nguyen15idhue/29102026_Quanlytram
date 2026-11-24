package relay

import (
	"errors"
	"io"
	"strings"
	"testing"
)

func tapFrom(data string) io.ReadCloser {
	return io.NopCloser(strings.NewReader(data))
}

func readAll(t *testing.T, r io.ReadCloser) string {
	t.Helper()
	defer r.Close()
	buf, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read tap: %v", err)
	}
	return string(buf)
}

func TestCombineStationSourceTapsUsesPrimaryFirst(t *testing.T) {
	primaryCalled, fallbackCalled := 0, 0
	combined := CombineStationSourceTaps(
		func(int64) (io.ReadCloser, error) {
			primaryCalled++
			return tapFrom("client"), nil
		},
		func(int64) (io.ReadCloser, error) {
			fallbackCalled++
			return tapFrom("caster"), nil
		},
	)

	tap, err := combined(5)
	if err != nil {
		t.Fatalf("combined tap: %v", err)
	}
	if got := readAll(t, tap); got != "client" {
		t.Fatalf("data = %q, want client", got)
	}
	if primaryCalled != 1 || fallbackCalled != 0 {
		t.Fatalf("primary=%d fallback=%d, want 1/0", primaryCalled, fallbackCalled)
	}
}

func TestCombineStationSourceTapsFallsBackToCasterSource(t *testing.T) {
	combined := CombineStationSourceTaps(
		func(int64) (io.ReadCloser, error) {
			return nil, errStationSourceOffline
		},
		func(stationID int64) (io.ReadCloser, error) {
			if stationID != 656 {
				t.Fatalf("stationID = %d, want 656", stationID)
			}
			return tapFrom("caster-source"), nil
		},
	)

	tap, err := combined(656)
	if err != nil {
		t.Fatalf("combined tap: %v", err)
	}
	if got := readAll(t, tap); got != "caster-source" {
		t.Fatalf("data = %q, want caster-source", got)
	}
}

func TestCombineStationSourceTapsOfflineWhenBothMissing(t *testing.T) {
	combined := CombineStationSourceTaps(
		func(int64) (io.ReadCloser, error) { return nil, errStationSourceOffline },
		func(int64) (io.ReadCloser, error) { return nil, errStationSourceOffline },
	)

	tap, err := combined(656)
	if tap != nil {
		tap.Close()
	}
	if !errors.Is(err, errStationSourceOffline) {
		t.Fatalf("err = %v, want station_source_offline", err)
	}
}

func TestCombineStationSourceTapsWithoutOpeners(t *testing.T) {
	combined := CombineStationSourceTaps(nil, nil)
	if _, err := combined(1); !errors.Is(err, errStationSourceOffline) {
		t.Fatalf("err = %v, want station_source_offline", err)
	}
}
