package caster

import "testing"

func TestParseGGAPosition(t *testing.T) {
	pos, fix, ok := ParseGGAPosition("$GPGGA,123519,2112.3456,N,10550.1234,E,4,08,0.9,10.0,M,0.0,M,,*47")
	if !ok || fix != FixFixed {
		t.Fatalf("expected fixed ok, got ok=%v fix=%q", ok, fix)
	}
	if pos.Lat < 21.2 || pos.Lat > 21.22 {
		t.Fatalf("bad lat %v", pos.Lat)
	}
	if pos.Lon < 105.83 || pos.Lon > 105.84 {
		t.Fatalf("bad lon %v", pos.Lon)
	}
	if !pos.HasAlt || pos.Alt < 9.9 || pos.Alt > 10.1 {
		t.Fatalf("bad alt %+v", pos)
	}
	if pos.Sats != 8 {
		t.Fatalf("bad sats %+v", pos)
	}
	// Nam / Tây phải âm.
	posS, _, ok := ParseGGAPosition("$GPGGA,123519,2112.3456,S,10550.1234,W,1,08,0.9,10.0,M,,,*00")
	if !ok || posS.Lat >= 0 || posS.Lon >= 0 {
		t.Fatalf("S/W should be negative %+v ok=%v", posS, ok)
	}
	// Không phải GGA -> fail.
	if _, _, ok := ParseGGAPosition("$GPRMC,123519,A,2112.3456,N,10550.1234,E,0,0,010126,,*00"); ok {
		t.Fatalf("RMC should not parse as GGA")
	}
	// Thiếu tọa độ -> fail.
	if _, _, ok := ParseGGAPosition("$GPGGA,123519,,,,,,0,,,,,,*00"); ok {
		t.Fatalf("empty coords should fail")
	}
}
