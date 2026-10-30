package nmea

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"
)

func checksum(body string) byte {
	var sum byte
	for i := 0; i < len(body); i++ {
		sum ^= body[i]
	}
	return sum
}

func sentence(body string) string {
	return fmt.Sprintf("$%s*%02X\r\n", body, checksum(body))
}

func coordinate(value float64, latitude bool) (string, string) {
	hemisphere := "N"
	if !latitude {
		hemisphere = "E"
	}
	if value < 0 {
		if latitude {
			hemisphere = "S"
		} else {
			hemisphere = "W"
		}
	}
	absolute := math.Abs(value)
	degrees := int(absolute)
	minutes := (absolute - float64(degrees)) * 60
	if latitude {
		return fmt.Sprintf("%02d%08.5f", degrees, minutes), hemisphere
	}
	return fmt.Sprintf("%03d%08.5f", degrees, minutes), hemisphere
}

func jitter(value float64) float64 {
	return value + (rand.Float64()-0.5)*0.00001
}

func GGA(lat, lon float64, at time.Time) string {
	latValue, latHemisphere := coordinate(jitter(lat), true)
	lonValue, lonHemisphere := coordinate(jitter(lon), false)
	body := fmt.Sprintf(
		"GPGGA,%s,%s,%s,%s,%s,1,08,1.0,10.0,M,0.0,M,,",
		at.UTC().Format("150405.00"),
		latValue, latHemisphere,
		lonValue, lonHemisphere,
	)
	return sentence(body)
}

func GSA(_ float64, _ float64, at time.Time) string {
	return sentence("GPGSA,A,3,01,02,03,04,05,06,07,08,09,10,11,12,1.0,1.0,1.0")
}

func RMC(lat, lon float64, at time.Time) string {
	latValue, latHemisphere := coordinate(jitter(lat), true)
	lonValue, lonHemisphere := coordinate(jitter(lon), false)
	body := fmt.Sprintf(
		"GPRMC,%s,A,%s,%s,%s,%s,0.0,0.0,%s,,,A",
		at.UTC().Format("150405.00"),
		latValue, latHemisphere,
		lonValue, lonHemisphere,
		at.UTC().Format("020106"),
	)
	return sentence(body)
}

func Sentences(lat, lon float64, at time.Time) []string {
	return []string{GGA(lat, lon, at), GSA(lat, lon, at), RMC(lat, lon, at)}
}

func Join(lat, lon float64, at time.Time) []byte {
	return []byte(strings.Join(Sentences(lat, lon, at), ""))
}
