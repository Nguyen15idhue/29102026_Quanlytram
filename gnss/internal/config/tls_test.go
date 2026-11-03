package config

import "testing"

func TestUseDBTLS(t *testing.T) {
	cases := []struct {
		host string
		mode string
		want bool
	}{
		{"127.0.0.1", "", false},
		{"localhost", "", false},
		{"mysql", "", false},
		{"10.0.0.5", "", false},
		{"192.168.1.5", "", false},
		{"172.16.0.9", "", false},
		{"172.31.9.9", "", false},
		{"db.example.com", "", true},
		{"203.113.1.5", "", true},
		{"mysql", "true", true},
		{"db.example.com", "false", false},
	}
	for _, item := range cases {
		cfg := Config{DBHost: item.host, DBTLS: item.mode}
		if got := cfg.UseDBTLS(); got != item.want {
			t.Fatalf("UseDBTLS(%q, %q) = %v, want %v", item.host, item.mode, got, item.want)
		}
	}
}
