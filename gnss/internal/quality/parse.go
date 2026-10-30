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
}

func normalizeText(value string) string {
	return strings.TrimSpace(strings.Trim(value, "\x00"))
}

func msnKnown(number int) bool {
	switch number {
	case 1005, 1006, 1007, 1008, 1033, 1230:
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
		if info.Number%10 == 7 {
			msg := rtcm3.DeserializeMessageMsm7(payload)
			for _, cnr := range msg.SignalData.Cnrs {
				if cnr == 0 {
					continue
				}
				// RTCM MSM CNR resolution is 0.0625 dBHz.
				info.CNRSum += float64(cnr) * 0.0625
				info.CNRCount++
			}
		}
	}
	return info, nil
}
