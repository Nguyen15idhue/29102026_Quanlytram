package rtcm

import (
	"bytes"
	"sync"
)

const (
	Preamble   byte = 0xD3
	MaxPayload      = 1023
	MaxFrame        = 3 + MaxPayload + 3
)

type Stats struct {
	Frames       uint64
	CRCErrors    uint64
	LengthErrors uint64
	Dropped      uint64
}

type Monitor struct {
	mu           sync.Mutex
	buf          []byte
	max          int
	frames       uint64
	crcErrors    uint64
	lengthErrors uint64
	dropped      uint64
}

func NewMonitor(maxBuffer int) *Monitor {
	if maxBuffer < MaxFrame {
		maxBuffer = MaxFrame
	}
	return &Monitor{max: maxBuffer}
}

func (m *Monitor) Feed(data []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.buf = append(m.buf, data...)
	if len(m.buf) > m.max {
		drop := len(m.buf) - m.max
		m.buf = append(m.buf[:0], m.buf[drop:]...)
		m.dropped += uint64(drop)
	}

	for {
		if len(m.buf) < 3 {
			return
		}
		index := bytes.IndexByte(m.buf, Preamble)
		if index < 0 {
			m.buf = m.buf[:0]
			return
		}
		if index > 0 {
			m.buf = m.buf[index:]
		}
		if len(m.buf) < 3 {
			return
		}

		length := int(m.buf[1]&0x03)<<8 | int(m.buf[2])
		if length == 0 || length > MaxPayload {
			m.lengthErrors++
			m.buf = m.buf[1:]
			continue
		}

		total := 3 + length + 3
		if len(m.buf) < total {
			return
		}

		crc := CRC24Q(m.buf[:3+length])
		got := uint32(m.buf[3+length])<<16 |
			uint32(m.buf[3+length+1])<<8 |
			uint32(m.buf[3+length+2])
		if crc != got {
			m.crcErrors++
			m.buf = m.buf[1:]
			continue
		}

		m.frames++
		m.buf = m.buf[total:]
	}
}

func (m *Monitor) Snapshot() Stats {
	m.mu.Lock()
	defer m.mu.Unlock()
	return Stats{
		Frames:       m.frames,
		CRCErrors:    m.crcErrors,
		LengthErrors: m.lengthErrors,
		Dropped:      m.dropped,
	}
}

func (m *Monitor) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.buf = m.buf[:0]
}

func CRC24Q(data []byte) uint32 {
	crc := uint32(0)
	for _, b := range data {
		crc ^= uint32(b) << 16
		for i := 0; i < 8; i++ {
			crc <<= 1
			if crc&0x1000000 != 0 {
				crc ^= 0x1864CFB
			}
		}
	}
	return crc & 0xFFFFFF
}
