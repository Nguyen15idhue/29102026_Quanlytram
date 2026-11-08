package relay

import (
	"math"
	"math/rand"
	"time"
)

// Mô phỏng rover di chuyển quanh vị trí cấu hình (port từ relay cũ,
// relayrtcm/backup/main.go L1385-1515). Chỉ dùng khi job bật motion và profile
// có motion = 'rover' (D19-23); mặc định TẮT để không làm sai VRS của người
// dùng thật.
const (
	motionEarthRadiusKm = 6371.0
	motionMaxRadiusKm   = 10.0 // bán kính tối đa quanh vị trí gốc (km)
	motionMoveRadiusKm  = 2.0  // quãng đường tối đa mỗi chặng (km)
	motionMinSpeedMps   = 1.0  // tốc độ nhỏ nhất (m/s)
	motionMaxSpeedMps   = 4.0  // tốc độ lớn nhất (m/s)
	motionArriveMeters  = 40.0 // coi là tới waypoint khi cách <= 40 m
	motionIdleMinSec    = 60   // nghỉ tối thiểu giữa 2 chặng (giây)
	motionIdleMaxSec    = 300  // nghỉ tối đa giữa 2 chặng (giây)
)

// roverMotion giữ trạng thái một rover giả: đi theo waypoint ngẫu nhiên trong
// bán kính 10 km với tốc độ 1-4 m/s, dừng nghỉ 60-300 s sau mỗi chặng.
//
// RNG và đồng hồ được inject để test tất định; production dùng time.Now.
type roverMotion struct {
	originLat float64
	originLon float64
	lat       float64
	lon       float64
	targetLat float64
	targetLon float64

	speedMps    float64
	speedKnots  float64
	courseDeg   float64
	moving      bool
	initialized bool
	idleUntil   time.Time
	lastUpdate  time.Time

	rng *rand.Rand
}

func newRoverMotion(originLat, originLon float64, rng *rand.Rand) *roverMotion {
	if rng == nil {
		rng = rand.New(rand.NewSource(time.Now().UnixNano()))
	}
	return &roverMotion{
		originLat: originLat,
		originLon: originLon,
		rng:       rng,
	}
}

// PositionAt trả vị trí tại thời điểm now, đồng thời tiến trạng thái di chuyển.
// Gọi lặp lại với cùng mốc thời gian không làm rover nhảy thêm.
func (m *roverMotion) PositionAt(now time.Time) (float64, float64) {
	if !m.initialized {
		m.speedMps = motionMinSpeedMps + m.rng.Float64()*(motionMaxSpeedMps-motionMinSpeedMps)
		// Khởi tạo lệch khỏi toạ độ thật để không lộ vị trí chính xác ngay.
		initKm := motionMaxRadiusKm * 0.5 * math.Sqrt(m.rng.Float64())
		m.lat, m.lon = offsetLatLon(m.originLat, m.originLon, initKm, m.rng.Float64()*360)
		m.pickTargetLocked()
		m.moving = false
		m.idleUntil = now.Add(m.randomIdleLocked())
		m.lastUpdate = now
		m.initialized = true
		return m.lat, m.lon
	}

	if !m.moving {
		if now.Before(m.idleUntil) {
			m.speedKnots = 0
			return m.lat, m.lon
		}
		m.moving = true
		m.pickTargetLocked()
		m.lastUpdate = now
		return m.lat, m.lon
	}

	dt := now.Sub(m.lastUpdate).Seconds()
	if dt <= 0 {
		return m.lat, m.lon
	}
	m.lastUpdate = now

	rad := math.Pi / 180.0
	northKm := (m.targetLat - m.lat) * rad * motionEarthRadiusKm
	eastKm := (m.targetLon - m.lon) * rad * motionEarthRadiusKm * math.Cos(m.lat*rad)
	distKm := math.Hypot(northKm, eastKm)

	if distKm <= motionArriveMeters/1000.0 {
		m.moving = false
		m.idleUntil = now.Add(m.randomIdleLocked())
		m.speedKnots = 0
		return m.lat, m.lon
	}

	moveKm := m.speedMps * dt / 1000.0
	if moveKm > distKm {
		moveKm = distKm
	}
	uN := northKm / distKm
	uE := eastKm / distKm
	m.lat += (uN * moveKm) / (motionEarthRadiusKm * rad)
	m.lon += (uE * moveKm) / (motionEarthRadiusKm * rad * math.Cos(m.lat*rad))

	m.courseDeg = math.Atan2(uE, uN) * 180.0 / math.Pi
	if m.courseDeg < 0 {
		m.courseDeg += 360
	}
	m.speedKnots = m.speedMps * 1.94384

	if dBase := approxDistKm(m.originLat, m.originLon, m.lat, m.lon); dBase > motionMaxRadiusKm {
		m.lat, m.lon = offsetLatLon(
			m.originLat, m.originLon, motionMaxRadiusKm,
			bearingDegFrom(m.originLat, m.originLon, m.lat, m.lon),
		)
		m.pickTargetLocked()
	}

	return m.lat, m.lon
}

// Motion trả tốc độ (knots) và hướng (độ) hiện tại cho câu RMC.
func (m *roverMotion) Motion() (float64, float64) {
	if m == nil {
		return 0, 0
	}
	return m.speedKnots, m.courseDeg
}

func (m *roverMotion) randomIdleLocked() time.Duration {
	seconds := motionIdleMinSec + m.rng.Intn(motionIdleMaxSec-motionIdleMinSec+1)
	return time.Duration(seconds) * time.Second
}

// pickTargetLocked chọn waypoint mới gần vị trí hiện tại và luôn nằm trong bán
// kính tối đa quanh vị trí gốc.
func (m *roverMotion) pickTargetLocked() {
	radiusKm := motionMoveRadiusKm * math.Sqrt(m.rng.Float64())
	targetLat, targetLon := offsetLatLon(m.lat, m.lon, radiusKm, m.rng.Float64()*360)
	if approxDistKm(m.originLat, m.originLon, targetLat, targetLon) > motionMaxRadiusKm {
		bearing := bearingDegFrom(m.originLat, m.originLon, targetLat, targetLon)
		targetLat, targetLon = offsetLatLon(
			m.originLat, m.originLon,
			motionMaxRadiusKm*math.Sqrt(m.rng.Float64()), bearing,
		)
	}
	m.targetLat, m.targetLon = targetLat, targetLon
}

// approxDistKm tính khoảng cách xấp xỉ (equirectangular) giữa hai toạ độ, km.
func approxDistKm(lat1, lon1, lat2, lon2 float64) float64 {
	const rad = math.Pi / 180.0
	northKm := (lat2 - lat1) * rad * motionEarthRadiusKm
	eastKm := (lon2 - lon1) * rad * motionEarthRadiusKm * math.Cos(lat1*rad)
	return math.Hypot(northKm, eastKm)
}

// bearingDegFrom trả hướng từ điểm 1 sang điểm 2 (0 = Bắc, 90 = Đông).
func bearingDegFrom(lat1, lon1, lat2, lon2 float64) float64 {
	rad := math.Pi / 180.0
	north := lat2 - lat1
	east := (lon2 - lon1) * math.Cos(lat1*rad)
	bearing := math.Atan2(east, north) * 180.0 / math.Pi
	if bearing < 0 {
		bearing += 360
	}
	return bearing
}

// offsetLatLon dịch một toạ độ đi distKm theo bearingDeg.
func offsetLatLon(lat, lon, distKm, bearingDeg float64) (float64, float64) {
	rad := bearingDeg * math.Pi / 180.0
	dLat := (distKm * math.Cos(rad)) / motionEarthRadiusKm
	dLon := (distKm * math.Sin(rad)) / (motionEarthRadiusKm * math.Cos(lat*math.Pi/180.0))
	return lat + dLat*180.0/math.Pi, lon + dLon*180.0/math.Pi
}
