package relay

import (
	"bytes"
	"math"
	"sync"

	"cors/gnss/internal/rtcm"
	"github.com/go-gnss/rtcm/rtcm3"
)

const (
	wgs84A  = 6378137.0
	wgs84F  = 1 / 298.257223563
	wgs84E2 = wgs84F * (2 - wgs84F)
)

// positionTracker giữ vị trí dùng cho GGA. Vị trí có thể đến từ cấu hình
// (client_gga_lat/lon hoặc toạ độ trạm) hoặc từ message 1005/1006 của luồng nguồn.
type positionTracker struct {
	mu    sync.Mutex
	lat   float64
	lon   float64
	ready bool
	ch    chan struct{}
}

func newPositionTracker(lat, lon *float64) *positionTracker {
	p := &positionTracker{ch: make(chan struct{})}
	if lat != nil && lon != nil && validCoordinate(*lat, *lon) {
		p.set(*lat, *lon)
	}
	return p
}

func (p *positionTracker) set(lat, lon float64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ready {
		return
	}
	p.lat, p.lon, p.ready = lat, lon, true
	close(p.ch)
}

func (p *positionTracker) readyCh() <-chan struct{} {
	return p.ch
}

func (p *positionTracker) get() (float64, float64, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.lat, p.lon, p.ready
}

func validCoordinate(lat, lon float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lon) &&
		lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
		!(lat == 0 && lon == 0)
}

// framePositionScanner bóc frame RTCM3 và lấy vị trí trạm từ 1005/1006.
// Chỉ chạy cho tới khi tìm được vị trí đầu tiên.
type framePositionScanner struct {
	buf     []byte
	tracker *positionTracker
	done    bool
}

func newFramePositionScanner(tracker *positionTracker) *framePositionScanner {
	return &framePositionScanner{tracker: tracker}
}

func (s *framePositionScanner) Feed(data []byte) {
	if s.done || s.tracker == nil {
		return
	}
	s.buf = append(s.buf, data...)
	for {
		index := bytes.IndexByte(s.buf, rtcm.Preamble)
		if index < 0 {
			s.buf = s.buf[:0]
			return
		}
		if index > 0 {
			s.buf = s.buf[index:]
		}
		if len(s.buf) < 6 {
			return
		}
		length := int(s.buf[1]&0x03)<<8 | int(s.buf[2])
		if length == 0 || length > rtcm.MaxPayload {
			s.buf = s.buf[1:]
			continue
		}
		total := 3 + length + 3
		if len(s.buf) < total {
			return
		}
		want := rtcm.CRC24Q(s.buf[:3+length])
		got := uint32(s.buf[3+length])<<16 |
			uint32(s.buf[3+length+1])<<8 |
			uint32(s.buf[3+length+2])
		if want != got {
			s.buf = s.buf[1:]
			continue
		}
		payload := s.buf[3 : 3+length]
		if lat, lon, ok := positionFromPayload(payload); ok {
			s.tracker.set(lat, lon)
			s.done = true
			s.buf = nil
			return
		}
		s.buf = s.buf[total:]
	}
}

func positionFromPayload(payload []byte) (float64, float64, bool) {
	number, err := rtcm3.MessageNumber(payload)
	if err != nil {
		return 0, 0, false
	}
	var x, y, z int64
	switch number {
	case 1005:
		msg, err := rtcm3.DeserializeMessage1005(payload)
		if err != nil {
			return 0, 0, false
		}
		x, y, z = msg.ReferencePointX, msg.ReferencePointY, msg.ReferencePointZ
	case 1006:
		msg, err := rtcm3.DeserializeMessage1006(payload)
		if err != nil {
			return 0, 0, false
		}
		x, y, z = msg.ReferencePointX, msg.ReferencePointY, msg.ReferencePointZ
	default:
		return 0, 0, false
	}
	if x == 0 && y == 0 && z == 0 {
		return 0, 0, false
	}
	lat, lon := ecefToGeodetic(float64(x)/10000, float64(y)/10000, float64(z)/10000)
	if !validCoordinate(lat, lon) {
		return 0, 0, false
	}
	return lat, lon, true
}

// ecefToGeodetic chuyển ECEF (mét) sang WGS84 (độ).
func ecefToGeodetic(x, y, z float64) (latDeg, lonDeg float64) {
	lon := math.Atan2(y, x)
	p := math.Hypot(x, y)
	if p < 1e-9 {
		latDeg = math.Copysign(90, z)
		return latDeg, lon * 180 / math.Pi
	}
	lat := math.Atan2(z, p*(1-wgs84E2))
	for i := 0; i < 6; i++ {
		sin := math.Sin(lat)
		n := wgs84A / math.Sqrt(1-wgs84E2*sin*sin)
		h := p/math.Cos(lat) - n
		lat = math.Atan2(z, p*(1-wgs84E2*n/(n+h)))
	}
	return lat * 180 / math.Pi, lon * 180 / math.Pi
}
