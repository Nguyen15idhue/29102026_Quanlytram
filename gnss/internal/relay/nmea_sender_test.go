package relay

import (
	"bufio"
	"math"
	"math/rand"
	"net"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"cors/gnss/internal/deviceprofile"
)

func testSender(jobID int64, interval time.Duration, profile deviceprofile.Profile, motion bool) *nmeaSender {
	return newNMEASender(nmeaSenderConfig{
		JobID:         jobID,
		Lat:           21.818899,
		Lon:           104.6796,
		Interval:      interval,
		Profile:       profile,
		MotionEnabled: motion,
	})
}

func TestNMEAFixStateMachine(t *testing.T) {
	sender := testSender(42, 5*time.Second, deviceprofile.Default(), false)
	sender.rng = rand.New(rand.NewSource(7))
	now := time.Now()

	if quality, _, _, _ := sender.resolveFix(now, false); quality != fixSingle {
		t.Fatalf("no-data quality = %d, want single", quality)
	}
	quality, sats, hdop, _ := sender.resolveFix(now, true)
	if quality != fixRTKFixed && quality != fixRTKFloat && quality != fixDGPS {
		t.Fatalf("data quality = %d, want fixed/float/dgps", quality)
	}
	if sats < 4 || hdop <= 0 {
		t.Fatalf("invalid satellite/hdop: %d %.2f", sats, hdop)
	}

	// Mất dữ liệu quá 30s phải quay lại Single, không giữ Fixed giả.
	if quality, _, _, _ := sender.resolveFix(now.Add(time.Minute), false); quality != fixSingle {
		t.Fatalf("stale quality = %d, want single", quality)
	}
}

func TestNMEASentenceUsesFixQuality(t *testing.T) {
	sender := testSender(1, 5*time.Second, deviceprofile.Default(), false)
	single := string(sender.sentence(time.Now(), false))
	if !strings.Contains(single, ",1,") {
		t.Fatalf("initial GGA is not single: %q", single)
	}

	at := time.Now()
	for i := 0; i < 20; i++ {
		line := string(sender.sentence(at, true))
		fields := strings.Split(strings.TrimSuffix(line, "\r\n"), ",")
		switch fields[6] {
		case "4", "5", "2":
			return
		}
	}
	t.Fatal("GGA never reported fixed/float/dgps while data is fresh")
}

func TestNMEAInitialWriteReadsOnUpstream(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	sender := testSender(1, time.Second, deviceprofile.Default(), false)
	done := make(chan string, 1)
	go func() {
		reader := bufio.NewReader(server)
		line, _ := reader.ReadString('\n')
		done <- line
	}()
	if err := sender.sendInitial(client); err != nil {
		t.Fatalf("sendInitial: %v", err)
	}
	select {
	case line := <-done:
		if !strings.HasPrefix(line, "$GPGGA") {
			t.Fatalf("initial sentence = %q", line)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("initial GGA not written")
	}
}

func TestNMEARunSendsWhileDataFresh(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	sender := testSender(1, 50*time.Millisecond, deviceprofile.Default(), false)
	var lastData atomic.Int64
	lastData.Store(time.Now().UnixNano())
	errCh := make(chan error, 1)
	done := make(chan string, 2)
	go func() {
		reader := bufio.NewReader(server)
		for i := 0; i < 2; i++ {
			line, _ := reader.ReadString('\n')
			done <- line
		}
	}()
	go sender.run(t.Context(), client, &lastData, errCh)
	for i := 0; i < 2; i++ {
		select {
		case line := <-done:
			if !strings.HasPrefix(line, "$GPGGA") {
				t.Fatalf("sentence = %q", line)
			}
		case err := <-errCh:
			t.Fatalf("run error: %v", err)
		case <-time.After(3 * time.Second):
			t.Fatal("timed out waiting for periodic GGA")
		}
	}
}

func TestNMEAProfileIntervalAndJitter(t *testing.T) {
	profile := deviceprofile.ResolveOrDefault("chc_landstar") // 11 s, jitter 2 s
	sender := testSender(3, 0, profile, false)
	if sender.interval != 11*time.Second {
		t.Fatalf("interval = %v, want 11s theo profile", sender.interval)
	}
	if sender.jitter != 2 {
		t.Fatalf("jitter = %d, want 2", sender.jitter)
	}
	minimum := 9 * time.Second
	maximum := 13 * time.Second
	distinct := map[time.Duration]bool{}
	for i := 0; i < 200; i++ {
		next := sender.nextInterval()
		if next < minimum || next > maximum {
			t.Fatalf("next interval ngoài khoảng: %v", next)
		}
		distinct[next] = true
	}
	if len(distinct) < 2 {
		t.Fatal("jitter phải tạo nhiều khoảng khác nhau")
	}
}

func TestNMEASendsGSAAndRMCByProfile(t *testing.T) {
	chc := deviceprofile.ResolveOrDefault("chc_landstar") // GSA=false, RMC=true
	sender := testSender(3, 10*time.Second, chc, false)
	sender.rng = rand.New(rand.NewSource(11))
	at := time.Now()
	hasRMC := false
	for i := 0; i < 200; i++ {
		payload := string(sender.sentence(at, true))
		if strings.Contains(payload, "$GPGSA") {
			t.Fatalf("CHC LandStar không được gửi GSA: %q", payload)
		}
		if strings.Contains(payload, "$GPRMC") {
			hasRMC = true
		}
	}
	if !hasRMC {
		t.Fatal("CHC LandStar phải gửi RMC (profile SendRMC=true)")
	}

	efix := deviceprofile.ResolveOrDefault("efix_efield") // GSA=true, RMC=true
	sender = testSender(2, 10*time.Second, efix, false)
	sender.rng = rand.New(rand.NewSource(13))
	hasGSA := false
	hasRMC = false
	for i := 0; i < 300; i++ {
		payload := string(sender.sentence(at, true))
		hasGSA = hasGSA || strings.Contains(payload, "$GPGSA")
		hasRMC = hasRMC || strings.Contains(payload, "$GPRMC")
	}
	if !hasGSA || !hasRMC {
		t.Fatalf("EFIX phải gửi cả GSA và RMC: gsa=%v rmc=%v", hasGSA, hasRMC)
	}
}

func TestNMEAAltitudeJittersWithoutRepeat(t *testing.T) {
	sender := testSender(1, 10*time.Second, deviceprofile.Default(), false)
	sender.rng = rand.New(rand.NewSource(17))
	at := time.Now()
	altitudes := map[string]bool{}
	for i := 0; i < 50; i++ {
		payload := string(sender.sentence(at, false))
		line := strings.Split(strings.TrimSuffix(payload, "\r\n"), "\r\n")[0]
		fields := strings.Split(line, ",")
		if len(fields) < 10 {
			t.Fatalf("GGA thiếu trường: %q", line)
		}
		value, err := strconv.ParseFloat(fields[9], 64)
		if err != nil {
			t.Fatalf("altitude không phải số: %q", fields[9])
		}
		if value < 99.5 || value > 100.5 {
			t.Fatalf("altitude ngoài ±0.5 m: %.3f", value)
		}
		altitudes[fields[9]] = true
	}
	if len(altitudes) < 2 {
		t.Fatal("altitude phải dao động, không lặp y hệt")
	}
}

func TestNMEAMotionDisabledByDefault(t *testing.T) {
	rover := deviceprofile.ResolveOrDefault("trimble_da2")
	if rover.Motion != deviceprofile.MotionRover {
		t.Fatalf("trimble phải là profile rover: %s", rover.Motion)
	}
	sender := testSender(6, 10*time.Second, rover, false)
	if sender.motion != nil {
		t.Fatal("motion phải TẮT khi job không bật")
	}
	first := string(sender.sentence(time.Now(), false))
	second := string(sender.sentence(time.Now().Add(time.Minute), false))
	firstFix := strings.Split(first, "*")[0]
	secondFix := strings.Split(second, "*")[0]
	firstFields := strings.Split(firstFix, ",")
	secondFields := strings.Split(secondFix, ",")
	if firstFields[2] != secondFields[2] || firstFields[4] != secondFields[4] {
		t.Fatalf("vị trí phải đứng yên khi motion TẮT: %q vs %q", firstFix, secondFix)
	}
}

func TestNMEAMotionRoverMoves(t *testing.T) {
	rover := deviceprofile.ResolveOrDefault("trimble_da2")
	sender := testSender(6, 10*time.Second, rover, true)
	if sender.motion == nil {
		t.Fatal("motion phải bật khi job bật + profile rover")
	}
	sender.motion.rng = rand.New(rand.NewSource(23))

	start := time.Now()
	_, startLon := sender.motion.PositionAt(start)
	originLat, originLon := sender.motion.originLat, sender.motion.originLon
	moved := false
	maxDistance := 0.0
	for i := 1; i <= 3600; i++ {
		now := start.Add(time.Duration(i) * time.Second)
		lat, lon := sender.motion.PositionAt(now)
		distance := approxDistKm(originLat, originLon, lat, lon)
		if distance > maxDistance {
			maxDistance = distance
		}
		if lon != startLon {
			moved = true
		}
		speed, course := sender.motion.Motion()
		if speed != 0 && (speed < motionMinSpeedMps*1.94384-0.001 || speed > motionMaxSpeedMps*1.94384+0.001) {
			t.Fatalf("tốc độ ngoài khoảng 1-4 m/s: %.3f knots", speed)
		}
		if speed != 0 && (course < 0 || course >= 360) {
			t.Fatalf("hướng ngoài 0-360: %.3f", course)
		}
	}
	if !moved {
		t.Fatal("rover phải di chuyển khi motion bật")
	}
	if maxDistance > motionMaxRadiusKm+0.001 {
		t.Fatalf("rover vượt bán kính 10 km: %.3f km", maxDistance)
	}
	if math.IsNaN(maxDistance) {
		t.Fatal("khoảng cách không hợp lệ")
	}
}
