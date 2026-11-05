package relay

import "time"

type hourlyBucket struct {
	hour    time.Time
	seconds int
}

// splitSessionHours chia thời lượng session theo từng giờ UTC. Tổng seconds
// của các bucket luôn bằng duration của session (không mất giây ở biên giờ).
func splitSessionHours(start, end time.Time) []hourlyBucket {
	start = start.UTC()
	end = end.UTC()
	if !end.After(start) {
		return []hourlyBucket{{hour: start.Truncate(time.Hour), seconds: 0}}
	}

	total := int(end.Sub(start).Seconds())
	buckets := make([]hourlyBucket, 0, total/3600+1)
	elapsed := 0
	for cursor := start; cursor.Before(end); {
		hour := cursor.Truncate(time.Hour)
		next := hour.Add(time.Hour)
		if next.After(end) {
			next = end
		}
		nextElapsed := int(next.Sub(start).Seconds())
		seconds := nextElapsed - elapsed
		if seconds < 0 {
			seconds = 0
		}
		buckets = append(buckets, hourlyBucket{hour: hour, seconds: seconds})
		elapsed = nextElapsed
		cursor = next
	}
	if len(buckets) == 0 {
		return []hourlyBucket{{hour: start.Truncate(time.Hour), seconds: total}}
	}
	return buckets
}
