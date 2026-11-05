package relay

import (
	"testing"
	"time"
)

func TestSplitSessionHours(t *testing.T) {
	start := time.Date(2026, 11, 4, 21, 33, 53, 0, time.UTC)
	end := time.Date(2026, 11, 4, 23, 44, 6, 0, time.UTC)
	buckets := splitSessionHours(start, end)
	if len(buckets) != 3 {
		t.Fatalf("buckets = %d, want 3", len(buckets))
	}
	want := []struct {
		hour    time.Time
		seconds int
	}{
		{time.Date(2026, 11, 4, 21, 0, 0, 0, time.UTC), 1567},
		{time.Date(2026, 11, 4, 22, 0, 0, 0, time.UTC), 3600},
		{time.Date(2026, 11, 4, 23, 0, 0, 0, time.UTC), 2646},
	}
	sum := 0
	for index, bucket := range buckets {
		if !bucket.hour.Equal(want[index].hour) || bucket.seconds != want[index].seconds {
			t.Fatalf("bucket %d = %s/%d, want %s/%d", index, bucket.hour, bucket.seconds, want[index].hour, want[index].seconds)
		}
		sum += bucket.seconds
	}
	if sum != 7813 {
		t.Fatalf("sum = %d, want 7813", sum)
	}
}

func TestSplitSessionHoursSameHourAndZero(t *testing.T) {
	start := time.Date(2026, 11, 5, 10, 0, 10, 0, time.UTC)
	end := time.Date(2026, 11, 5, 10, 5, 20, 0, time.UTC)
	buckets := splitSessionHours(start, end)
	if len(buckets) != 1 || buckets[0].seconds != 310 {
		t.Fatalf("same-hour buckets = %+v, want one 310s bucket", buckets)
	}

	zero := splitSessionHours(start, start)
	if len(zero) != 1 || zero[0].seconds != 0 || !zero[0].hour.Equal(time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("zero buckets = %+v", zero)
	}
}

func TestSplitSessionHoursCrossDay(t *testing.T) {
	start := time.Date(2026, 11, 4, 23, 50, 0, 0, time.UTC)
	end := time.Date(2026, 11, 5, 0, 10, 0, 0, time.UTC)
	buckets := splitSessionHours(start, end)
	if len(buckets) != 2 {
		t.Fatalf("buckets = %d, want 2", len(buckets))
	}
	if buckets[0].seconds != 600 || buckets[1].seconds != 600 {
		t.Fatalf("buckets = %+v, want 600/600", buckets)
	}
	if !buckets[1].hour.Equal(time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("second hour = %s", buckets[1].hour)
	}
}
