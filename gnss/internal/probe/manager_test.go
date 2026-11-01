package probe

import "testing"

func TestProbeFingerprintChanges(t *testing.T) {
	lat := 21.0
	lon := 105.0
	cfg := &Config{
		ID:           1,
		StationID:    2,
		MountpointID: 3,
		Host:         "127.0.0.1",
		Port:         1509,
		Mount:        "M",
		Username:     "user",
		Password:     "pass",
		Lat:          &lat,
		Lon:          &lon,
	}
	first := probeFingerprint(cfg)
	if first == "" {
		t.Fatal("empty fingerprint")
	}
	cfg.Host = "127.0.0.2"
	if second := probeFingerprint(cfg); second == first {
		t.Fatal("fingerprint did not change when host changed")
	}
	cfg.Host = "127.0.0.1"
	cfg.Password = "pass2"
	if third := probeFingerprint(cfg); third == first {
		t.Fatal("fingerprint did not change when password changed")
	}
}
