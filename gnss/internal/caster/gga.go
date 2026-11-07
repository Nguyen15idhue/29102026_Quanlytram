package caster

import (
	"strconv"
	"strings"
)

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
	value, ok := splitGGAFields(line)
	if !ok {
		return "", false
	}
	switch trimField(value[6]) {
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

// RoverPosition là vị trí rover parse từ câu GGA.
// Chỉ dùng để hiển thị bản đồ, không persisted xuống DB.
type RoverPosition struct {
	Lat float64
	Lon float64
	Alt float64
	Sats int
	HasAlt bool
}

// ParseGGAPosition parse lat/lon/alt/số vệ tinh từ câu GGA.
// Trả về fixType qua ParseGGAFixType để tái dùng 1 lần split.
func ParseGGAPosition(line string) (RoverPosition, string, bool) {
	fields, ok := splitGGAFields(line)
	if !ok {
		return RoverPosition{}, "", false
	}
	fixType, _ := ParseGGAFixType(line)
	lat, ok := parseGGACoord(fields[2], fields[3], true)
	if !ok {
		return RoverPosition{}, "", false
	}
	lon, ok := parseGGACoord(fields[4], fields[5], false)
	if !ok {
		return RoverPosition{}, "", false
	}
	pos := RoverPosition{Lat: lat, Lon: lon}
	if len(fields) > 7 {
		if sats := parseGGAInt(fields[7]); sats >= 0 {
			pos.Sats = sats
		}
	}
	if len(fields) > 9 {
		if alt, ok := parseGGAFloat(fields[9]); ok {
			pos.Alt = alt
			pos.HasAlt = true
		}
	}
	return pos, fixType, true
}

func splitGGAFields(line string) ([]string, bool) {
	value := strings.TrimSpace(line)
	if !strings.HasPrefix(value, "$") {
		return nil, false
	}
	if index := strings.IndexByte(value, '*'); index >= 0 {
		value = value[:index]
	}
	fields := strings.Split(value, ",")
	if len(fields) < 7 || !strings.HasSuffix(fields[0], "GGA") {
		return nil, false
	}
	return fields, true
}

func trimField(value string) string {
	return strings.TrimSpace(value)
}

// parseGGACoord parse ddmm.mmmm + hemisphere thành độ thập phân.
// isLat=true: 2 số độ, ngược lại 3 số độ. Từ chối ngoài [-90,90]/[-180,180].
func parseGGACoord(raw, hemi string, isLat bool) (float64, bool) {
	raw = strings.TrimSpace(raw)
	hemi = strings.ToUpper(strings.TrimSpace(hemi))
	if raw == "" || hemi == "" {
		return 0, false
	}
	degLen := 2
	if !isLat {
		degLen = 3
	}
	if len(raw) < degLen+1 {
		return 0, false
	}
	deg, err := strconv.Atoi(raw[:degLen])
	if err != nil {
		return 0, false
	}
	min, err := strconv.ParseFloat(raw[degLen:], 64)
	if err != nil {
		return 0, false
	}
	if min < 0 || min >= 60 {
		return 0, false
	}
	value := float64(deg) + min/60
	if isLat {
		if hemi == "S" {
			value = -value
		} else if hemi != "N" {
			return 0, false
		}
		if value < -90 || value > 90 {
			return 0, false
		}
	} else {
		if hemi == "W" {
			value = -value
		} else if hemi != "E" {
			return 0, false
		}
		if value < -180 || value > 180 {
			return 0, false
		}
	}
	return value, true
}

func parseGGAInt(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return -1
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 || value > 99 {
		return -1
	}
	return value
}

func parseGGAFloat(raw string) (float64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, false
	}
	return value, true
}
