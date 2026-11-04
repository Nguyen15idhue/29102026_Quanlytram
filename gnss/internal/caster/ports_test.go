package caster

import "testing"

func TestParsePortSpec(t *testing.T) {
	ports, err := ParsePortSpec("1508,1509,2101,1510-1512")
	if err != nil {
		t.Fatalf("ParsePortSpec error: %v", err)
	}
	for _, port := range []int{1508, 1509, 2101, 1510, 1511, 1512} {
		if !ports[port] {
			t.Fatalf("port %d missing", port)
		}
	}
	if ports[1513] {
		t.Fatalf("port 1513 should not be allowed")
	}
}

func TestParsePortSpecRejectsInvalid(t *testing.T) {
	for _, spec := range []string{"", "abc", "1509-1508", "0", "70000"} {
		if _, err := ParsePortSpec(spec); err == nil {
			t.Fatalf("ParsePortSpec(%q) should fail", spec)
		}
	}
}
