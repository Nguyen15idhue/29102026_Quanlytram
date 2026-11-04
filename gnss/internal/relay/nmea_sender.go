package relay

import (
	"context"
	"fmt"
	"math/rand"
	"net"
	"sync/atomic"
	"time"

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

// nmeaSender gửi GGA lên upstream giống rover thật:
//   - ngay sau khi mở source, gửi 1 câu Single để caster biết vị trí;
//   - định kỳ gửi lại GGA với trạng thái Single/Float/Fixed thay đổi theo việc
//     có dòng RTCM mới hay không, thay vì luôn gửi Single.
//
// Caster VRS (ví dụ rtk.taikhoandodac.vn) từ chối/không trả dữ liệu nếu không
// nhận được GGA, nên phần này là bắt buộc chứ không chỉ là keep-alive.
type nmeaSender struct {
	lat      float64
	lon      float64
	interval time.Duration
	rng      *rand.Rand

	quality    int
	nextChange time.Time
	baseSats   int
	baseHDOP   float64
}

func newNMEASender(jobID int64, lat, lon float64, interval time.Duration) *nmeaSender {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	seed := time.Now().UnixNano() ^ (jobID * 7919)
	sats := 10 + int(jobID%7) // 10..16
	hdop := 0.8 + float64(jobID%5)*0.1
	return &nmeaSender{
		lat:      lat,
		lon:      lon,
		interval: interval,
		rng:      rand.New(rand.NewSource(seed)),
		quality:  fixSingle,
		baseSats: sats,
		baseHDOP: hdop,
	}
}

func (s *nmeaSender) sentence(at time.Time, hasData bool) []byte {
	quality, sats, hdop, age := s.resolveFix(at, hasData)
	return []byte(nmea.GGAWithFix(s.lat, s.lon, at, nmea.FixInfo{
		Quality:    quality,
		Satellites: sats,
		HDOP:       hdop,
		AgeOfDiff:  age,
		Altitude:   100,
	}))
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
	// Jitter ±10% để không tạo pattern cố định.
	delta := time.Duration(float64(s.interval) * (s.rng.Float64()*0.2 - 0.1))
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
