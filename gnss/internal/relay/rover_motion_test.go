package relay

import (
	"math/rand"
	"testing"
	"time"
)

func TestRoverMotionStaysWithinRadius(t *testing.T) {
	originLat, originLon := 21.818899, 104.6796
	for seed := int64(1); seed <= 20; seed++ {
		motion := newRoverMotion(originLat, originLon, rand.New(rand.NewSource(seed)))
		start := time.Now()
		maxDistance := 0.0
		idleSeen := false
		moved := false
		previousLat, previousLon := motion.PositionAt(start)
		for i := 1; i <= 3600; i++ {
			now := start.Add(time.Duration(i) * time.Second)
			lat, lon := motion.PositionAt(now)
			if lat != previousLat || lon != previousLon {
				moved = true
			}
			previousLat, previousLon = lat, lon
			if distance := approxDistKm(originLat, originLon, lat, lon); distance > maxDistance {
				maxDistance = distance
			}
			if speed, _ := motion.Motion(); speed == 0 && i > 1 {
				idleSeen = true
			}
		}
		if !moved {
			t.Fatalf("seed %d: rover không di chuyển", seed)
		}
		if !idleSeen {
			t.Fatalf("seed %d: không có giai đoạn nghỉ", seed)
		}
		if maxDistance > motionMaxRadiusKm+0.001 {
			t.Fatalf("seed %d: vượt bán kính 10 km: %.3f", seed, maxDistance)
		}
	}
}

func TestRoverMotionSpeedRange(t *testing.T) {
	motion := newRoverMotion(21.818899, 104.6796, rand.New(rand.NewSource(5)))
	start := time.Now()
	motion.PositionAt(start)

	for i := 1; i <= 600; i++ {
		motion.PositionAt(start.Add(time.Duration(i) * time.Second))
		speed, course := motion.Motion()
		if speed == 0 {
			continue
		}
		mps := speed / 1.94384
		if mps < motionMinSpeedMps-0.001 || mps > motionMaxSpeedMps+0.001 {
			t.Fatalf("tốc độ ngoài 1-4 m/s: %.4f", mps)
		}
		if course < 0 || course >= 360 {
			t.Fatalf("hướng ngoài 0-360: %.3f", course)
		}
	}
}

func TestRoverMotionIdleBeforeMoving(t *testing.T) {
	motion := newRoverMotion(21.818899, 104.6796, rand.New(rand.NewSource(9)))
	start := time.Now()
	lat, lon := motion.PositionAt(start)

	// Trong thời gian nghỉ (60-300 s) rover đứng yên, tốc độ 0.
	if nextLat, nextLon := motion.PositionAt(start.Add(time.Second)); nextLat != lat || nextLon != lon {
		t.Fatal("rover phải đứng yên ngay sau khi khởi tạo")
	}
	if speed, _ := motion.Motion(); speed != 0 {
		t.Fatalf("tốc độ khi nghỉ phải 0, có %.3f", speed)
	}

	// Sau tối đa 300 s rover bắt đầu chặng mới.
	moved := false
	for i := 0; i <= 400; i++ {
		now := start.Add(time.Duration(i) * time.Second)
		nextLat, nextLon := motion.PositionAt(now)
		if nextLat != lat || nextLon != lon {
			moved = true
			break
		}
	}
	if !moved {
		t.Fatal("rover không bắt đầu di chuyển sau thời gian nghỉ")
	}
}

func TestRoverMotionIdleDurationRange(t *testing.T) {
	motion := newRoverMotion(21.818899, 104.6796, rand.New(rand.NewSource(3)))
	for i := 0; i < 200; i++ {
		duration := motion.randomIdleLocked()
		if duration < motionIdleMinSec*time.Second || duration > motionIdleMaxSec*time.Second {
			t.Fatalf("thời gian nghỉ ngoài 60-300 s: %v", duration)
		}
	}
}
