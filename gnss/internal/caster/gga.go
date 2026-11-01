package caster

import "strings"

const (
	FixSingle = "single"
	FixFixed  = "fixed"
	FixFloat  = "float"
	FixRTD    = "rtd"
	FixError  = "error"
)

// ParseGGAFixType returns the RTK/DGPS fix type from a GGA sentence.
// GGA field 6 is the GPS quality indicator.
func ParseGGAFixType(line string) (string, bool) {
	value := strings.TrimSpace(line)
	if !strings.HasPrefix(value, "$") {
		return "", false
	}
	if index := strings.IndexByte(value, '*'); index >= 0 {
		value = value[:index]
	}
	fields := strings.Split(value, ",")
	if len(fields) < 7 || !strings.HasSuffix(fields[0], "GGA") {
		return "", false
	}
	switch strings.TrimSpace(fields[6]) {
	case "0":
		return FixError, true
	case "1":
		return FixSingle, true
	case "2", "3":
		return FixRTD, true
	case "4":
		return FixFixed, true
	case "5":
		return FixFloat, true
	default:
		return FixError, true
	}
}
