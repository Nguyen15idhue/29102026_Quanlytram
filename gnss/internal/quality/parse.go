package quality

import (
	"fmt"
	"math/bits"
	"strings"

	"github.com/bamiaux/iobit"
	"github.com/go-gnss/rtcm/rtcm3"
)

type messageInfo struct {
	Number        int
	Unknown       bool
	MSM           bool
	Satellites    int
	Signals       int
	Cells         int
	SatelliteMask uint64
	SignalMask    uint32
	CellMask      uint64
	CNRSum        float64
	CNRCount      int
	Has1005       bool
	Has1006       bool
	Has1007       bool
	Has1008       bool
	Has1033       bool
	HasStation    bool
	StationID     uint16
	HasARP        bool
	ARPX          int64
	ARPY          int64
	ARPZ          int64
	Antenna       string
	Epoch         uint32
	Observations  []observation
	Ephemeris     *ephemeris
}

func normalizeText(value string) string {
	return strings.TrimSpace(strings.Trim(value, "\x00"))
}

func msnKnown(number int) bool {
	switch number {
	case 1005, 1006, 1007, 1008, 1019, 1020, 1033, 1042, 1044, 1045, 1046, 1230:
		return true
	}
	return isMSM(number)
}

func isMSM(number int) bool {
	if number < 1074 || number > 1127 {
		return false
	}
	base := number / 10
	if base < 107 || base > 112 {
		return false
	}
	kind := number % 10
	return kind >= 4 && kind <= 7
}

func decodeMessage(payload []byte) (info messageInfo, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("rtcm parse panic: %v", recovered)
		}
	}()

	number, err := rtcm3.MessageNumber(payload)
	if err != nil {
		return info, err
	}
	info.Number = int(number)
	if !msnKnown(info.Number) {
		info.Unknown = true
		return info, nil
	}

	switch info.Number {
	case 1005:
		msg, decodeErr := rtcm3.DeserializeMessage1005(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Has1005 = true
		info.HasStation = true
		info.StationID = msg.ReferenceStationId
		info.HasARP = true
		info.ARPX = msg.ReferencePointX
		info.ARPY = msg.ReferencePointY
		info.ARPZ = msg.ReferencePointZ
	case 1006:
		msg, decodeErr := rtcm3.DeserializeMessage1006(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Has1006 = true
		info.HasStation = true
		info.StationID = msg.ReferenceStationId
		info.HasARP = true
		info.ARPX = msg.ReferencePointX
		info.ARPY = msg.ReferencePointY
		info.ARPZ = msg.ReferencePointZ
	case 1007:
		msg, decodeErr := rtcm3.DeserializeMessage1007(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Has1007 = true
		info.HasStation = true
		info.StationID = msg.ReferenceStationId
		info.Antenna = normalizeText(msg.AntennaDescriptor)
	case 1008:
		msg, decodeErr := rtcm3.DeserializeMessage1008(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Has1008 = true
		info.HasStation = true
		info.StationID = msg.ReferenceStationId
		info.Antenna = normalizeText(msg.AntennaDescriptor)
	case 1033:
		msg, decodeErr := rtcm3.DeserializeMessage1033(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Has1033 = true
		info.HasStation = true
		info.StationID = msg.ReferenceStationId
		info.Antenna = normalizeText(msg.AntennaDescriptor)
	case 1019:
		msg, decodeErr := rtcm3.DeserializeMessage1019(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Ephemeris = ephemerisFrom1019(msg)
	case 1020:
		msg, decodeErr := rtcm3.DeserializeMessage1020(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Ephemeris = ephemerisFrom1020(msg)
	case 1042:
		msg, decodeErr := rtcm3.DeserializeMessage1042(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Ephemeris = ephemerisFrom1042(msg)
	case 1044:
		msg, decodeErr := rtcm3.DeserializeMessage1044(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Ephemeris = ephemerisFrom1044(msg)
	case 1045:
		msg, decodeErr := rtcm3.DeserializeMessage1045(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Ephemeris = ephemerisFrom1045(msg)
	case 1046:
		msg, decodeErr := rtcm3.DeserializeMessage1046(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.Ephemeris = ephemerisFrom1046(msg)
	case 1230:
		msg, decodeErr := rtcm3.DeserializeMessage1230(payload)
		if decodeErr != nil {
			return info, decodeErr
		}
		info.HasStation = true
		info.StationID = msg.ReferenceStationId
	default:
		if !isMSM(info.Number) {
			return info, nil
		}
		reader := iobit.NewReader(payload)
		header := rtcm3.DeserializeMsmHeader(&reader)
		info.MSM = true
		info.Satellites = header.SatelliteCount()
		info.Signals = bits.OnesCount32(header.SignalMask)
		info.Cells = bits.OnesCount64(header.CellMask)
		info.SatelliteMask = header.SatelliteMask
		info.SignalMask = header.SignalMask
		info.CellMask = header.CellMask
		info.HasStation = true
		info.StationID = header.ReferenceStationId
		info.Epoch = header.Epoch
		switch info.Number % 10 {
		case 4:
			msg := rtcm3.DeserializeMessageMsm4(payload)
			info.Observations = observationsMsm4(msg)
		case 7:
			msg := rtcm3.DeserializeMessageMsm7(payload)
			info.Observations = observationsMsm7(msg)
		}
		for _, observation := range info.Observations {
			if observation.CNR <= 0 {
				continue
			}
			info.CNRSum += observation.CNR
			info.CNRCount++
		}
	}
	return info, nil
}

type observation struct {
	System      int
	Satellite   int
	Signal      int
	Pseudorange float64
	Phase       float64
	Lock        uint16
	HalfCycle   bool
	CNR         float64
}

type cellRef struct {
	Satellite      int
	Signal         int
	SatelliteIndex int
}

const speedOfLightMs = 299792458.0 / 1000.0

func maskBits64(mask uint64) []int {
	values := make([]int, 0, bits.OnesCount64(mask))
	for index := 0; index < 64; index++ {
		if mask&(uint64(1)<<uint(index)) != 0 {
			values = append(values, index+1)
		}
	}
	return values
}

func maskBits32(mask uint32) []int {
	values := make([]int, 0, bits.OnesCount32(mask))
	for index := 0; index < 32; index++ {
		if mask&(uint32(1)<<uint(index)) != 0 {
			values = append(values, index+1)
		}
	}
	return values
}

func msmCellRefs(header rtcm3.MsmHeader) []cellRef {
	satellites := maskBits64(header.SatelliteMask)
	signals := maskBits32(header.SignalMask)
	refs := make([]cellRef, 0, len(satellites)*len(signals))
	index := 0
	for satelliteIndex, satellite := range satellites {
		for _, signal := range signals {
			if header.CellMask&(uint64(1)<<uint(index)) != 0 {
				refs = append(refs, cellRef{
					Satellite:      satellite,
					Signal:         signal,
					SatelliteIndex: satelliteIndex,
				})
			}
			index++
		}
	}
	return refs
}

func observationsMsm4(msg rtcm3.MessageMsm4) []observation {
	refs := msmCellRefs(msg.MsmHeader)
	result := make([]observation, 0, len(refs))
	for index, ref := range refs {
		if index >= len(msg.SignalData.Pseudoranges) ||
			index >= len(msg.SignalData.PhaseRanges) ||
			ref.SatelliteIndex >= len(msg.SatelliteData.RangeMilliseconds) ||
			ref.SatelliteIndex >= len(msg.SatelliteData.Ranges) {
			break
		}
		coarseMs := float64(msg.SatelliteData.RangeMilliseconds[ref.SatelliteIndex]) +
			float64(msg.SatelliteData.Ranges[ref.SatelliteIndex])/1024
		coarseMeters := coarseMs * speedOfLightMs
		result = append(result, observation{
			System:      int(msg.MsmHeader.MessageNumber) / 10,
			Satellite:   ref.Satellite,
			Signal:      ref.Signal,
			Pseudorange: coarseMeters + float64(msg.SignalData.Pseudoranges[index])*speedOfLightMs/float64(uint64(1)<<24),
			Phase:       coarseMeters + float64(msg.SignalData.PhaseRanges[index])*speedOfLightMs/float64(uint64(1)<<29),
			Lock:        uint16(msg.SignalData.PhaseRangeLocks[index]),
			HalfCycle:   msg.SignalData.HalfCycles[index],
			CNR:         float64(msg.SignalData.Cnrs[index]),
		})
	}
	return result
}

func observationsMsm7(msg rtcm3.MessageMsm7) []observation {
	refs := msmCellRefs(msg.MsmHeader)
	result := make([]observation, 0, len(refs))
	for index, ref := range refs {
		if index >= len(msg.SignalData.Pseudoranges) ||
			index >= len(msg.SignalData.PhaseRanges) ||
			ref.SatelliteIndex >= len(msg.SatelliteData.RangeMilliseconds) ||
			ref.SatelliteIndex >= len(msg.SatelliteData.Ranges) {
			break
		}
		coarseMs := float64(msg.SatelliteData.RangeMilliseconds[ref.SatelliteIndex]) +
			float64(msg.SatelliteData.Ranges[ref.SatelliteIndex])/1024
		coarseMeters := coarseMs * speedOfLightMs
		result = append(result, observation{
			System:      int(msg.MsmHeader.MessageNumber) / 10,
			Satellite:   ref.Satellite,
			Signal:      ref.Signal,
			Pseudorange: coarseMeters + float64(msg.SignalData.Pseudoranges[index])*speedOfLightMs/float64(uint64(1)<<29),
			Phase:       coarseMeters + float64(msg.SignalData.PhaseRanges[index])*speedOfLightMs/float64(uint64(1)<<31),
			Lock:        msg.SignalData.PhaseRangeLocks[index],
			HalfCycle:   msg.SignalData.HalfCycles[index],
			CNR:         float64(msg.SignalData.Cnrs[index]) * 0.0625,
		})
	}
	return result
}
