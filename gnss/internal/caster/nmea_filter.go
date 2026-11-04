package caster

import "bytes"

// nmeaFilter loại các câu NMEA (GGA/GSA/RMC...) do rover/relay gửi ngược lên
// source trước khi phát RTCM cho rover. NMEA không được trộn vào luồng RTCM.
//
// Bộ lọc chỉ coi một '$' là bắt đầu NMEA khi:
//   - theo sau là talker 2 ký tự (GP/GN/GL/GA/GB/BD/GQ) và loại câu quen thuộc;
//   - có '\n' trong tối đa 1KB.
//
// RTCM là dữ liệu nhị phân nên có thể chứa '$'; các điều kiện trên tránh cắt
// nhầm byte RTCM.
type nmeaFilter struct {
	pending []byte
}

var nmeaSentenceTypes = [][]byte{
	[]byte("GGA"), []byte("GSA"), []byte("GSV"), []byte("RMC"),
	[]byte("GLL"), []byte("VTG"), []byte("ZDA"), []byte("GNS"),
	[]byte("GBS"), []byte("DTM"), []byte("GRS"), []byte("GST"),
}

func isNMEATalker(talker []byte) bool {
	switch string(talker) {
	case "GP", "GN", "GL", "GA", "GB", "BD", "GQ", "GI":
		return true
	default:
		return false
	}
}

func isNMEAType(kind []byte) bool {
	for _, candidate := range nmeaSentenceTypes {
		if bytes.Equal(kind, candidate) {
			return true
		}
	}
	return false
}

func (f *nmeaFilter) Filter(data []byte) []byte {
	if len(data) == 0 {
		return nil
	}
	if len(f.pending) == 0 && bytes.IndexByte(data, '$') < 0 {
		return data
	}

	buf := make([]byte, 0, len(f.pending)+len(data))
	buf = append(buf, f.pending...)
	buf = append(buf, data...)
	f.pending = f.pending[:0]

	out := make([]byte, 0, len(buf))
	for i := 0; i < len(buf); {
		if buf[i] != '$' {
			next := bytes.IndexByte(buf[i:], '$')
			if next < 0 {
				out = append(out, buf[i:]...)
				break
			}
			out = append(out, buf[i:i+next]...)
			i += next
			continue
		}

		// Cần đủ "$XXYYY".
		if i+6 > len(buf) {
			rest := buf[i+1:]
			if len(rest) > 0 && rest[0] != 'G' && rest[0] != 'B' {
				out = append(out, buf[i])
				i++
				continue
			}
			if len(rest) >= 2 && !isNMEATalker(rest[:2]) {
				out = append(out, buf[i])
				i++
				continue
			}
			f.pending = append(f.pending, buf[i:]...)
			break
		}
		if !isNMEATalker(buf[i+1:i+3]) || !isNMEAType(buf[i+3:i+6]) {
			out = append(out, buf[i])
			i++
			continue
		}

		end := bytes.IndexByte(buf[i:], '\n')
		if end < 0 {
			if len(buf)-i > 1024 {
				// Quá dài để là NMEA hợp lệ; giữ nguyên byte '$'.
				out = append(out, buf[i])
				i++
				continue
			}
			f.pending = append(f.pending, buf[i:]...)
			break
		}
		if end > 1024 {
			out = append(out, buf[i])
			i++
			continue
		}
		// Bỏ trọn câu NMEA.
		i += end + 1
	}
	return out
}
