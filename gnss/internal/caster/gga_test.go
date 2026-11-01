package caster

import "testing"

func TestParseGGAFixType(t *testing.T) {
	cases := []struct {
		line string
		want string
		ok   bool
	}{
		{"$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47", FixSingle, true},
		{"$GNGGA,123519,4807.038,N,01131.000,E,2,08,0.9,545.4,M,46.9,M,,*48", FixRTD, true},
		{"$GPGGA,123519,4807.038,N,01131.000,E,3,08,0.9,545.4,M,46.9,M,,*49", FixRTD, true},
		{"$GPGGA,123519,4807.038,N,01131.000,E,4,08,0.9,545.4,M,46.9,M,,*4E", FixFixed, true},
		{"$GPGGA,123519,4807.038,N,01131.000,E,5,08,0.9,545.4,M,46.9,M,,*4F", FixFloat, true},
		{"$GPGGA,123519,4807.038,N,01131.000,E,0,08,0.9,545.4,M,46.9,M,,*4A", FixError, true},
		{"$GPGGA,123519,4807.038,N,01131.000,E,6,08,0.9,545.4,M,46.9,M,,*4C", FixError, true},
		{"$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A", "", false},
		{"garbage", "", false},
		{"", "", false},
	}
	for _, item := range cases {
		got, ok := ParseGGAFixType(item.line)
		if ok != item.ok || got != item.want {
			t.Fatalf("ParseGGAFixType(%q) = (%q,%v), want (%q,%v)", item.line, got, ok, item.want, item.ok)
		}
	}
}
