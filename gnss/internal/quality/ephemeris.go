package quality

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/go-gnss/rtcm/rtcm3"
)

const (
	gpsMu     = 3.986005e14
	gpsOmega  = 7.2921151467e-5
	piValue   = math.Pi
	glonassMu = 398600.4418e9
	glonassJ2 = 1.0826257e-3
	glonassRe = 6378137.0
)

type ephemeris struct {
	system    int
	satellite int
	week      int
	toe       float64
	af0       float64
	af1       float64
	af2       float64
	crs       float64
	deltaN    float64
	m0        float64
	cuc       float64
	ecc       float64
	cus       float64
	sqrtA     float64
	cic       float64
	omega0    float64
	cis       float64
	i0        float64
	crc       float64
	omega     float64
	omegaDot  float64
	idot      float64

	glonass bool
	x       float64
	y       float64
	z       float64
	vx      float64
	vy      float64
	vz      float64
	tb      float64
}

func scale(value float64, exponent int) float64 {
	return value * math.Pow(2, float64(exponent))
}

func ephemerisFrom1019(msg rtcm3.Message1019) *ephemeris {
	return &ephemeris{
		system:    107,
		satellite: int(msg.SatelliteID),
		week:      int(msg.WeekNumber),
		toe:       float64(msg.Toe) * 16,
		af0:       scale(float64(msg.Af0), -31),
		af1:       scale(float64(msg.Af1), -43),
		af2:       scale(float64(msg.Af2), -55),
		crs:       scale(float64(msg.Crs), -5),
		deltaN:    scale(float64(msg.DeltaN), -43) * piValue,
		m0:        scale(float64(msg.M0), -31) * piValue,
		cuc:       scale(float64(msg.Cuc), -29),
		ecc:       scale(float64(msg.Eccentricity), -33),
		cus:       scale(float64(msg.Cus), -29),
		sqrtA:     scale(float64(msg.SrA), -19),
		cic:       scale(float64(msg.Cic), -29),
		omega0:    scale(float64(msg.Omega0), -31) * piValue,
		cis:       scale(float64(msg.Cis), -29),
		i0:        scale(float64(msg.I0), -31) * piValue,
		crc:       scale(float64(msg.Crc), -5),
		omega:     scale(float64(msg.Perigee), -31) * piValue,
		omegaDot:  scale(float64(msg.OmegaDot), -43) * piValue,
		idot:      scale(float64(msg.IDOT), -43) * piValue,
	}
}

func ephemerisFrom1020(msg rtcm3.Message1020) *ephemeris {
	position := func(high rtcm3.Sint, low rtcm3.Sint) float64 {
		return (float64(high)*32 + float64(low)) * math.Pow(2, -11) * 1000
	}
	velocity := func(value rtcm3.Sint) float64 {
		return float64(value) * math.Pow(2, -20) * 1000
	}
	return &ephemeris{
		system:    108,
		satellite: int(msg.SatelliteId),
		glonass:   true,
		x:         position(msg.XnTb, msg.XnTb2),
		y:         position(msg.YnTb, msg.YnTb2),
		z:         position(msg.ZnTb, msg.ZnTb2),
		vx:        velocity(msg.XnTb1),
		vy:        velocity(msg.YnTb1),
		vz:        velocity(msg.ZnTb1),
		tb:        float64(msg.Tb) * 900,
	}
}

func ephemerisFrom1042(msg rtcm3.Message1042) *ephemeris {
	return &ephemeris{
		system:    112,
		satellite: int(msg.SatelliteId),
		week:      int(msg.WeekNumber),
		toe:       float64(msg.Toe) * 8,
		af0:       scale(float64(msg.A0), -33),
		af1:       scale(float64(msg.A1), -50),
		af2:       scale(float64(msg.A2), -66),
		crs:       scale(float64(msg.Crs), -6),
		deltaN:    scale(float64(msg.DeltaN), -43) * piValue,
		m0:        scale(float64(msg.M0), -31) * piValue,
		cuc:       scale(float64(msg.Cuc), -31),
		ecc:       scale(float64(msg.E), -33),
		cus:       scale(float64(msg.Cus), -31),
		sqrtA:     scale(float64(msg.ASquared), -19),
		cic:       scale(float64(msg.Cic), -31),
		omega0:    scale(float64(msg.Omega0), -31) * piValue,
		cis:       scale(float64(msg.Cis), -31),
		i0:        scale(float64(msg.I0), -31) * piValue,
		crc:       scale(float64(msg.Crc), -6),
		omega:     scale(float64(msg.Omega), -31) * piValue,
		omegaDot:  scale(float64(msg.OmegaDot), -43) * piValue,
		idot:      scale(float64(msg.IDOT), -43) * piValue,
	}
}

func ephemerisFrom1044(msg rtcm3.Message1044) *ephemeris {
	return &ephemeris{
		system:    111,
		satellite: int(msg.SatelliteId),
		week:      int(msg.WeekNumber),
		toe:       float64(msg.Toe) * 16,
		af0:       scale(float64(msg.Af0), -31),
		af1:       scale(float64(msg.Af1), -43),
		af2:       scale(float64(msg.Af2), -55),
		crs:       scale(float64(msg.Crs), -5),
		deltaN:    scale(float64(msg.DeltaN0), -43) * piValue,
		m0:        scale(float64(msg.M0), -31) * piValue,
		cuc:       scale(float64(msg.Cuc), -29),
		ecc:       scale(float64(msg.E), -33),
		cus:       scale(float64(msg.Cus), -29),
		sqrtA:     scale(float64(msg.ASquared), -19),
		cic:       scale(float64(msg.Cic), -29),
		omega0:    scale(float64(msg.Omega0), -31) * piValue,
		cis:       scale(float64(msg.Cis), -29),
		i0:        scale(float64(msg.I0), -31) * piValue,
		crc:       scale(float64(msg.Crc), -5),
		omega:     scale(float64(msg.OmegaN), -31) * piValue,
		omegaDot:  scale(float64(msg.OmegaDot), -43) * piValue,
		idot:      scale(float64(msg.I0Dot), -43) * piValue,
	}
}

func ephemerisFrom1045(msg rtcm3.Message1045) *ephemeris {
	return &ephemeris{
		system:    109,
		satellite: int(msg.SatelliteId),
		week:      int(msg.WeekNumber),
		toe:       float64(msg.Toe) * 60,
		af0:       scale(float64(msg.Af0), -34),
		af1:       scale(float64(msg.Af1), -46),
		af2:       scale(float64(msg.Af2), -59),
		crs:       scale(float64(msg.Crs), -5),
		deltaN:    scale(float64(msg.DeltaN0), -43) * piValue,
		m0:        scale(float64(msg.M0), -31) * piValue,
		cuc:       scale(float64(msg.Cuc), -29),
		ecc:       scale(float64(msg.E), -33),
		cus:       scale(float64(msg.Cus), -29),
		sqrtA:     scale(float64(msg.ASquared), -19),
		cic:       scale(float64(msg.Cic), -29),
		omega0:    scale(float64(msg.Omega0), -31) * piValue,
		cis:       scale(float64(msg.Cis), -29),
		i0:        scale(float64(msg.I0), -31) * piValue,
		crc:       scale(float64(msg.Crc), -5),
		omega:     scale(float64(msg.Omega), -31) * piValue,
		omegaDot:  scale(float64(msg.OmegaDot), -43) * piValue,
		idot:      scale(float64(msg.IDot), -43) * piValue,
	}
}

func ephemerisFrom1046(msg rtcm3.Message1046) *ephemeris {
	return &ephemeris{
		system:    109,
		satellite: int(msg.SatelliteId),
		week:      int(msg.WeekNumber),
		toe:       float64(msg.Toe) * 60,
		af0:       scale(float64(msg.Af0), -34),
		af1:       scale(float64(msg.Af1), -46),
		af2:       scale(float64(msg.Af2), -59),
		crs:       scale(float64(msg.Crs), -5),
		deltaN:    scale(float64(msg.DeltaN0), -43) * piValue,
		m0:        scale(float64(msg.M0), -31) * piValue,
		cuc:       scale(float64(msg.Cuc), -29),
		ecc:       scale(float64(msg.E), -33),
		cus:       scale(float64(msg.Cus), -29),
		sqrtA:     scale(float64(msg.ASquared), -19),
		cic:       scale(float64(msg.Cic), -29),
		omega0:    scale(float64(msg.Omega0), -31) * piValue,
		cis:       scale(float64(msg.Cis), -29),
		i0:        scale(float64(msg.I0), -31) * piValue,
		crc:       scale(float64(msg.Crc), -5),
		omega:     scale(float64(msg.Omega), -31) * piValue,
		omegaDot:  scale(float64(msg.OmegaDot), -43) * piValue,
		idot:      scale(float64(msg.IDot), -43) * piValue,
	}
}

func (e *ephemeris) key() string {
	return fmt.Sprintf("%d:%d", e.system, e.satellite)
}

func systemName(system int) string {
	switch system {
	case 107:
		return "GPS"
	case 108:
		return "GLONASS"
	case 109:
		return "Galileo"
	case 110:
		return "SBAS"
	case 111:
		return "QZSS"
	case 112:
		return "BeiDou"
	default:
		return fmt.Sprintf("S%d", system)
	}
}

func signalBand(system, signal int) string {
	fallback := fmt.Sprintf("SIG%d", signal)
	switch system {
	case 107, 111:
		switch signal {
		case 1, 2, 3, 7, 8:
			return "L1"
		case 4, 5:
			return "L2"
		case 6:
			return "L5"
		case 9:
			return "L6"
		}
	case 108:
		switch signal {
		case 1, 2, 5, 8:
			return "G1"
		case 3, 4, 6:
			return "G2"
		case 7:
			return "G3"
		}
	case 109:
		switch signal {
		case 1, 6:
			return "E1"
		case 2:
			return "E6"
		case 3, 7:
			return "E5a"
		case 4, 8:
			return "E5b"
		case 5:
			return "E5a+b"
		}
	case 112:
		switch signal {
		case 1, 2:
			return "B1"
		case 3, 4:
			return "B2"
		case 5, 6:
			return "B3"
		case 7:
			return "B1C"
		case 8, 10:
			return "B2a"
		case 9:
			return "B2b"
		}
	case 110:
		if signal == 2 || signal == 4 || signal == 5 {
			return "L5"
		}
		return "L1"
	}
	return fallback
}

func (e *ephemeris) position(now time.Time) (float64, float64, float64, bool) {
	if e.glonass {
		return e.glonassPosition(now)
	}
	if e.sqrtA <= 0 {
		return 0, 0, 0, false
	}
	gpsSeconds := float64(now.Unix()) + 18 - 315964800
	weekSeconds := math.Mod(gpsSeconds, 604800)
	tk := weekSeconds - e.toe
	if tk > 302400 {
		tk -= 604800
	} else if tk < -302400 {
		tk += 604800
	}
	a := e.sqrtA * e.sqrtA
	n := math.Sqrt(gpsMu/(a*a*a)) + e.deltaN
	m := e.m0 + n*tk
	ecc := e.ecc
	ek := m
	for index := 0; index < 12; index++ {
		ek = m + ecc*math.Sin(ek)
	}
	sinE := math.Sin(ek)
	cosE := math.Cos(ek)
	v := math.Atan2(math.Sqrt(1-ecc*ecc)*sinE, cosE-ecc)
	phi := v + e.omega
	sin2 := math.Sin(2 * phi)
	cos2 := math.Cos(2 * phi)
	u := phi + e.cus*sin2 + e.cuc*cos2
	r := a*(1-ecc*cosE) + e.crs*sin2 + e.crc*cos2
	i := e.i0 + e.idot*tk + e.cis*sin2 + e.cic*cos2
	xOrbit := r * math.Cos(u)
	yOrbit := r * math.Sin(u)
	omega := e.omega0 + (e.omegaDot-gpsOmega)*tk - gpsOmega*e.toe
	cosO := math.Cos(omega)
	sinO := math.Sin(omega)
	cosI := math.Cos(i)
	sinI := math.Sin(i)
	x := xOrbit*cosO - yOrbit*cosI*sinO
	y := xOrbit*sinO + yOrbit*cosI*cosO
	z := yOrbit * sinI
	return x, y, z, true
}

func (e *ephemeris) glonassPosition(now time.Time) (float64, float64, float64, bool) {
	if e.x == 0 && e.y == 0 && e.z == 0 {
		return 0, 0, 0, false
	}
	secondsOfDay := math.Mod(float64(now.Unix())+3*3600, 86400)
	dt := secondsOfDay - e.tb
	if dt > 43200 {
		dt -= 86400
	} else if dt < -43200 {
		dt += 86400
	}
	if dt > 3600 {
		dt = 3600
	} else if dt < -3600 {
		dt = -3600
	}
	x, y, z := e.x/1000, e.y/1000, e.z/1000
	vx, vy, vz := e.vx/1000, e.vy/1000, e.vz/1000
	acceleration := func(x, y, z float64) (float64, float64, float64) {
		r2 := x*x + y*y + z*z
		r := math.Sqrt(r2)
		if r == 0 {
			return 0, 0, 0
		}
		factor := -glonassMu / (r * r * r)
		j2 := 1.5 * glonassJ2 * (glonassRe * glonassRe) / (r2 * r2)
		ax := factor * x * (1 - j2*(5*z*z/r2-1))
		ay := factor * y * (1 - j2*(5*z*z/r2-1))
		az := factor * z * (1 - j2*(5*z*z/r2-3))
		return ax, ay, az
	}
	step := dt
	ax1, ay1, az1 := acceleration(x, y, z)
	ax2, ay2, az2 := acceleration(x+vx*step/2, y+vy*step/2, z+vz*step/2)
	ax3, ay3, az3 := acceleration(x+vx*step/2, y+vy*step/2, z+vz*step/2)
	ax4, ay4, az4 := acceleration(x+vx*step, y+vy*step, z+vz*step)
	x += (vx + (ax1+ax2+ax3)*step/6) * step
	y += (vy + (ay1+ay2+ay3)*step/6) * step
	z += (vz + (az1+az2+az3)*step/6) * step
	vx += (ax1 + 2*ax2 + 2*ax3 + ax4) * step / 6
	vy += (ay1 + 2*ay2 + 2*ay3 + ay4) * step / 6
	vz += (az1 + 2*az2 + 2*az3 + az4) * step / 6
	return x * 1000, y * 1000, z * 1000, true
}

func ecefToGeodetic(x, y, z float64) (lat, lon float64) {
	lon = math.Atan2(y, x)
	p := math.Sqrt(x*x + y*y)
	const a = 6378137.0
	const e2 = 6.69437999014e-3
	lat = math.Atan2(z, p*(1-e2))
	for index := 0; index < 6; index++ {
		sinLat := math.Sin(lat)
		n := a / math.Sqrt(1-e2*sinLat*sinLat)
		h := p/math.Cos(lat) - n
		lat = math.Atan2(z, p*(1-e2*n/(n+h)))
	}
	return lat, lon
}

func skyPlotFor(ephemerides map[string]*ephemeris, signals []SignalObservation, arpX, arpY, arpZ int64, now time.Time) ([]SkyPlotPoint, string) {
	if arpX == 0 && arpY == 0 && arpZ == 0 {
		return nil, "Chưa có 1005/1006 để tính vị trí trạm"
	}
	if len(ephemerides) == 0 {
		return nil, "Nguồn RTCM chưa phát ephemeris 1019/1020/1042/1044/1045/1046 để tính azimuth/elevation"
	}
	best := make(map[string]SignalObservation)
	for _, item := range signals {
		key := fmt.Sprintf("%s:%d", item.System, item.Satellite)
		if previous, ok := best[key]; !ok || item.Cnr > previous.Cnr {
			best[key] = item
		}
	}
	recX := float64(arpX) / 10000
	recY := float64(arpY) / 10000
	recZ := float64(arpZ) / 10000
	lat, lon := ecefToGeodetic(recX, recY, recZ)
	sinLat, cosLat := math.Sin(lat), math.Cos(lat)
	sinLon, cosLon := math.Sin(lon), math.Cos(lon)
	points := make([]SkyPlotPoint, 0, len(ephemerides))
	for _, eph := range ephemerides {
		x, y, z, ok := eph.position(now)
		if !ok {
			continue
		}
		dx, dy, dz := x-recX, y-recY, z-recZ
		east := -sinLon*dx + cosLon*dy
		north := -sinLat*cosLon*dx - sinLat*sinLon*dy + cosLat*dz
		up := cosLat*cosLon*dx + cosLat*sinLon*dy + sinLat*dz
		rangeM := math.Sqrt(dx*dx + dy*dy + dz*dz)
		if rangeM == 0 {
			continue
		}
		elevation := math.Asin(up/rangeM) * 180 / piValue
		if elevation < 0 {
			continue
		}
		azimuth := math.Atan2(east, north) * 180 / piValue
		if azimuth < 0 {
			azimuth += 360
		}
		signal, ok := best[fmt.Sprintf("%s:%d", systemName(eph.system), eph.satellite)]
		point := SkyPlotPoint{
			System:    systemName(eph.system),
			Satellite: eph.satellite,
			Azimuth:   math.Round(azimuth*10) / 10,
			Elevation: math.Round(elevation*10) / 10,
		}
		if ok {
			point.Band = signal.Band
			point.Cnr = signal.Cnr
		}
		points = append(points, point)
	}
	sort.Slice(points, func(i, j int) bool {
		if points[i].System != points[j].System {
			return points[i].System < points[j].System
		}
		return points[i].Satellite < points[j].Satellite
	})
	if len(points) == 0 {
		return nil, "Có ephemeris nhưng không có vệ tinh trên đường chân trời"
	}
	return points, ""
}
