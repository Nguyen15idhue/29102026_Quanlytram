package caster

import (
	"fmt"
	"strconv"
	"strings"
)

// ParsePortSpec đọc danh sách port/range, ví dụ "1508,1509,2101,1510-1599".
func ParsePortSpec(spec string) (map[int]bool, error) {
	out := make(map[int]bool)
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		startText, endText, hasRange := strings.Cut(part, "-")
		start, err := strconv.Atoi(strings.TrimSpace(startText))
		if err != nil || start < 1 || start > 65535 {
			return nil, fmt.Errorf("invalid port %q", part)
		}
		end := start
		if hasRange {
			end, err = strconv.Atoi(strings.TrimSpace(endText))
			if err != nil || end < start || end > 65535 {
				return nil, fmt.Errorf("invalid port range %q", part)
			}
		}
		for port := start; port <= end; port++ {
			out[port] = true
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("empty port spec")
	}
	return out, nil
}
