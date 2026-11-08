package relay

import (
	"context"
	"fmt"
	"math/rand"
	"net"
	"strings"
	"sync/atomic"
	"time"

	"cors/gnss/internal/deviceprofile"
	"cors/gnss/internal/nmea"
)

// Trạng thái fix theo NMEA 0183.
const (
	fixSingle   = 1 // GPS single
	fixDGPS     = 2 // DGPS/RTD
	fixRTKFixed = 4
	fixRTKFloat = 5
)

const (
	fixDataWindow = 30 * time.Second
	fixWriteLimit = 2 * time.Second
)

// nmeaSender gửi NMEA lên upstream giống rover thật:
//   - ngay sau khi mở source, gửi 1 câu Single để caster biết vị trí;
//   - định kỳ gửi lại GGA với trạng thái Single/Float/Fixed thay đổi theo việc
//     có dòng RTCM mới hay không, thay vì luôn gửi Single;
//   - chu kỳ, jitter, HDOP, số vệ tinh, GSA/RMC lấy theo device profile;
//   - altitude dao động ±0.5 m và (khi bật motion) vị trí di chuyển theo
//     waypoint thay vì đứng yên tuyệt đối.
//
// Caster VRS (ví dụ rtk.taikhoandodac.vn) từ chối/không trả dữ liệu nếu không
// nhận được GGA, nên phần này là bắt buộc chứ không chỉ là keep-alive.
type nmeaSender struct {
	lat      float64
	lon      float64
	interval time.Duration
	jitter   int // biên jitter mỗi lần gửi, giây
	profile  deviceprofile.Profile
	rng      *rand.Rand
	motion   *roverMotion

	quality    int
	nextChange time.Time
	baseSats   int
	baseHDOP   float64
}

type nmeaSenderConfig struct {
	JobID         int64
	Lat           float64
	Lon           float64
	Interval      time.Duration
	Profile       deviceprofile.Profile
	MotionEnabled bool
}

func newNMEASender(cfg nmeaSenderConfig) *nmeaSender {
	profile := cfg.Profile
	if profile.IsZero() {
		profile = deviceprofile.Default()
	}
	profile = profile.Normalize()

	interval := cfg.Interval
	if interval <= 0 {
		interval = time.Duration(profile.NMEAInterval(0)) * time.Second
	}

	jitter := profile.NMEAJitterSec
	if maxJitter := int(interval/time.Second) / 5; jitter > maxJitter {
		jitter = maxJitter
	}
	if jitter < 0 {
		jitter = 0
	}

	seed := time.Now().UnixNano() ^ (cfg.JobID * 7919)
	rng := rand.New(rand.NewSource(seed))

	sats := profile.SatsMin
	if profile.SatsMax > profile.SatsMin {
		sats += rng.Intn(profile.SatsMax - profile.SatsMin + 1)
	}
	hdop := profile.HDOPMin
	if profile.HDOPMax > profile.HDOPMin {
		hdop += rng.Float64() * (profile.HDOPMax - profile.HDOPMin)
	}

	sender := &nmeaSender{
		lat:      cfg.Lat,
		lon:      cfg.Lon,
		interval: interval,
		jitter:   jitter,
		profile:  profile,
		rng:      rng,
		quality:  fixSingle,
		baseSats: sats,
		baseHDOP: hdop,
	}
	if cfg.MotionEnabled && profile.Motion == deviceprofile.MotionRover {
		sender.motion = newRoverMotion(cfg.Lat, cfg.Lon, rand.New(rand.NewSource(seed^0x5eed)))
	}
	return sender
}

func (s *nmeaSender) sentence(at time.Time, hasData bool) []byte {
	lat, lon := s.lat, s.lon
	speedKnots, courseDeg := 0.0, 0.0
	if s.motion != nil {
		lat, lon = s.motion.PositionAt(at)
		speedKnots, courseDeg = s.motion.Motion()
	}

	quality, sats, hdop, age := s.resolveFix(at, hasData)
	altitude := 100.0 + (s.rng.Float64() - 0.5)

	var builder strings.Builder
	builder.WriteString(nmea.GGAWithFix(lat, lon, at, nmea.FixInfo{
		Quality:     quality,
		Satellites:  sats,
		HDOP:        hdop,
		AgeOfDiff:   age,
		Altitude:    altitude,
		GeoidHeight: -5.0,
	}))
	// Thiết bị thật không phải lúc nào cũng gửi kèm GSA/RMC trên mỗi GGA.
	if s.profile.SendGSA && s.rng.Intn(3) == 0 {
		builder.WriteString(nmea.GSAWithDOP(hdop))
	}
	if s.profile.SendRMC && s.rng.Intn(4) == 0 {
		builder.WriteString(nmea.RMCWithMotion(lat, lon, speedKnots, courseDeg, at))
	}
	return []byte(builder.String())
}

// sendInitial gửi GGA Single ngay sau khi kết nối upstream, trước khi mở
// downstream, đúng thứ tự CGBAS đang làm.
func (s *nmeaSender) sendInitial(conn net.Conn) error {
	return writeNMEA(conn, s.sentence(time.Now(), false))
}

func (s *nmeaSender) run(ctx context.Context, conn net.Conn, lastData *atomic.Int64, errCh chan<- error) {
	timer := time.NewTimer(s.nextInterval())
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			hasData := false
			if value := lastData.Load(); value > 0 {
				hasData = time.Since(time.Unix(0, value)) <= fixDataWindow
			}
			if err := writeNMEA(conn, s.sentence(time.Now(), hasData)); err != nil {
				select {
				case errCh <- fmt.Errorf("nmea write: %w", err):
				default:
				}
				return
			}
			timer.Reset(s.nextInterval())
		}
	}
}

func (s *nmeaSender) resolveFix(now time.Time, hasData bool) (int, int, float64, float64) {
	if !hasData {
		s.quality = fixSingle
		s.nextChange = time.Time{}
		return fixSingle, s.baseSats, s.baseHDOP, 0
	}
	if s.quality == 0 || s.quality == fixSingle || now.After(s.nextChange) {
		// Tỷ lệ giống CGBAS: Fixed giữ lâu, Float/DGPS chỉ là giai đoạn ngắn.
		switch roll := s.rng.Intn(100); {
		case roll < 75:
			s.quality = fixRTKFixed
			s.nextChange = now.Add(time.Duration(60+s.rng.Intn(240)) * time.Second)
		case roll < 93:
			s.quality = fixRTKFloat
			s.nextChange = now.Add(time.Duration(10+s.rng.Intn(45)) * time.Second)
		default:
			s.quality = fixDGPS
			s.nextChange = now.Add(time.Duration(8+s.rng.Intn(35)) * time.Second)
		}
	}
	switch s.quality {
	case fixRTKFloat:
		return s.quality, maxInt(s.baseSats-1, 4), s.baseHDOP * 1.6, 0.8 + s.rng.Float64()*1.5
	case fixDGPS:
		return s.quality, maxInt(s.baseSats-2, 4), s.baseHDOP * 2.2, 1.5 + s.rng.Float64()*2.0
	default:
		return fixRTKFixed, s.baseSats, s.baseHDOP, 0
	}
}

func (s *nmeaSender) nextInterval() time.Duration {
	if s.jitter <= 0 {
		return s.interval
	}
	span := int64(2*s.jitter + 1)
	delta := time.Duration(s.rng.Int63n(span)-int64(s.jitter)) * time.Second
	next := s.interval + delta
	if next < time.Second {
		next = time.Second
	}
	return next
}

func writeNMEA(conn net.Conn, payload []byte) error {
	if conn == nil {
		return fmt.Errorf("nil upstream connection")
	}
	if err := conn.SetWriteDeadline(time.Now().Add(fixWriteLimit)); err != nil {
		return err
	}
	_, err := conn.Write(payload)
	_ = conn.SetWriteDeadline(time.Time{})
	return err
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
