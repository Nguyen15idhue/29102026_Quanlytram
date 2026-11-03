package config

import (
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("GO_PORT", "")
	t.Setenv("MYSQL_HOST", "")
	t.Setenv("MYSQL_PORT", "")
	t.Setenv("MYSQL_RELAY_USER", "")
	t.Setenv("MYSQL_RUNTIME_DATABASE", "")
	t.Setenv("MYSQL_ADMIN_DATABASE", "")

	cfg := Load()
	if cfg.Port != "7080" {
		t.Fatalf("Port = %q, want 7080", cfg.Port)
	}
	if cfg.RuntimeDB != "cors_runtime" || cfg.AdminDB != "cors_admin" {
		t.Fatalf("unexpected databases: %q %q", cfg.RuntimeDB, cfg.AdminDB)
	}
}

func TestStationSourceIdleTimeoutClamp(t *testing.T) {
	t.Setenv("STATION_SOURCE_IDLE_TIMEOUT_SEC", "5")
	if got := Load().StationSourceIdleTimeout; got != 30*time.Second {
		t.Fatalf("StationSourceIdleTimeout = %s, want clamp 30s", got)
	}
	t.Setenv("STATION_SOURCE_IDLE_TIMEOUT_SEC", "90")
	if got := Load().StationSourceIdleTimeout; got != 90*time.Second {
		t.Fatalf("StationSourceIdleTimeout = %s, want 90s", got)
	}
	t.Setenv("STATION_SOURCE_IDLE_TIMEOUT_SEC", "")
	if got := Load().StationSourceIdleTimeout; got != 120*time.Second {
		t.Fatalf("StationSourceIdleTimeout máº·c Ä‘á»‹nh = %s, want 120s", got)
	}
}
