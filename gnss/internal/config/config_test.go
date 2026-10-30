package config

import "testing"

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
