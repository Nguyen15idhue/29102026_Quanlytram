package caster

import (
	"bytes"
	"testing"
)

func TestNMEAFilterStripsSentencesAcrossChunks(t *testing.T) {
	filter := &nmeaFilter{}
	rtcm := []byte{0xD3, 0x00, 0x03, 0x3E, 0x00, 0x01, 0xAA, 0xBB, 0xCC}
	nmea := []byte("$GPGGA,171521.78,2139.59332,N,10534.93200,E,5,12,1.4,100.0,M,0.0,M,1.6,*74\r\n")

	var got []byte
	got = append(got, filter.Filter(append(append([]byte{}, rtcm...), nmea[:17]...))...)
	got = append(got, filter.Filter(nmea[17:])...)
	got = append(got, filter.Filter([]byte{0x3E, 0x00, 0x02})...)

	if !bytes.Equal(got, append(append([]byte{}, rtcm...), []byte{0x3E, 0x00, 0x02}...)) {
		t.Fatalf("filtered = %x", got)
	}
}

func TestNMEAFilterKeepsNonNMEADollarBytes(t *testing.T) {
	filter := &nmeaFilter{}
	input := []byte{0xD3, '$', 0x00, 0xFF, 0xD3, 0x01}
	if got := filter.Filter(input); !bytes.Equal(got, input) {
		t.Fatalf("filtered = %x, want %x", got, input)
	}
}

func TestNMEAFilterHandlesMultipleSentences(t *testing.T) {
	filter := &nmeaFilter{}
	input := []byte("$GPGGA,1,2,3\r\n$GPGSA,A,3\r\nRTCM")
	got := filter.Filter(input)
	if !bytes.Equal(got, []byte("RTCM")) {
		t.Fatalf("filtered = %q", got)
	}
}

func TestNMEAFilterKeepsRTCMContainingDollarGGA(t *testing.T) {
	filter := &nmeaFilter{}
	// Chuỗi giống NMEA nhưng không có newline trong 1KB: phải giữ nguyên.
	input := []byte{0xD3, '$', 'G', 'P', 'G', 'G', 'A', ',', 0x01, 0x02}
	got := filter.Filter(input)
	got = append(got, filter.Filter(bytes.Repeat([]byte{0x00}, 1100))...)
	if !bytes.HasPrefix(got, input) {
		t.Fatalf("filtered prefix = %x", got[:len(input)])
	}
}
