package quality

import (
	"math"
)

type scoreInput struct {
	State         string
	AgeMs         int64
	Gaps          int
	Frames        uint64
	CRCErrors     uint64
	ParseErrors   uint64
	MSMEpochs     uint64
	Satellites    int
	Signals       int
	Cells         int
	BaselineSat   int
	BaselineCells int
	AvgCnr        float64
	CNRAvailable  bool
	MetadataOK    bool
	HasAntenna    bool
	ARPDeltaM     float64
	HasARPDelta   bool
}

func clamp(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func scoreFor(input scoreInput) (int, ScoreParts) {
	parts := ScoreParts{}

	if input.State == "streaming" {
		parts.Transport = 25
	} else if input.State == "stale" {
		age := input.AgeMs
		if age < 0 {
			age = 0
		}
		ratio := 1.0 - float64(age)/30000.0
		if ratio < 0 {
			ratio = 0
		}
		parts.Transport = int(math.Round(25 * ratio))
	}
	if input.Gaps > 0 {
		parts.Transport -= clamp(input.Gaps*3, 0, 15)
	}
	parts.Transport = clamp(parts.Transport, 0, 25)

	totalFrames := input.Frames + input.CRCErrors + input.ParseErrors
	if totalFrames > 0 {
		bad := float64(input.CRCErrors+input.ParseErrors) / float64(totalFrames)
		parts.Integrity = int(math.Round(20 * (1 - bad)))
	}
	parts.Integrity = clamp(parts.Integrity, 0, 20)

	if input.MSMEpochs > 0 {
		parts.MSM = 18
		if input.BaselineSat > 0 {
			ratio := float64(input.Satellites) / float64(input.BaselineSat)
			parts.MSM = int(math.Round(25 * math.Min(1, ratio)))
		} else if input.Satellites > 0 {
			parts.MSM = 22
		}
		if input.BaselineCells > 0 {
			ratio := float64(input.Cells) / float64(input.BaselineCells)
			cellPart := int(math.Round(25 * math.Min(1, ratio)))
			if cellPart < parts.MSM {
				parts.MSM = cellPart
			}
		}
	}
	parts.MSM = clamp(parts.MSM, 0, 25)

	if input.MetadataOK {
		parts.Metadata = 11
	}
	if input.HasAntenna {
		parts.Metadata += 2
	}
	if !input.HasARPDelta || input.ARPDeltaM <= 5 {
		parts.Metadata += 2
	}
	parts.Metadata = clamp(parts.Metadata, 0, 15)

	if input.CNRAvailable && input.AvgCnr > 0 {
		ratio := (input.AvgCnr - 15) / 25
		if ratio > 1 {
			ratio = 1
		}
		if ratio < 0 {
			ratio = 0
		}
		parts.Signal = int(math.Round(10 * ratio))
	} else if input.MSMEpochs > 0 && input.Cells > 0 {
		parts.Signal = 5
	}
	parts.Signal = clamp(parts.Signal, 0, 10)

	switch {
	case input.State == "streaming" && input.AgeMs <= 2000:
		parts.Latency = 5
	case input.State == "streaming":
		parts.Latency = 4
	case input.AgeMs > 0 && input.AgeMs <= 10000:
		parts.Latency = 3
	case input.AgeMs > 0 && input.AgeMs <= 30000:
		parts.Latency = 1
	}
	parts.Latency = clamp(parts.Latency, 0, 5)

	return parts.Transport + parts.Integrity + parts.MSM + parts.Metadata + parts.Signal + parts.Latency, parts
}

func parityFor(upstream, downstream Snapshot) int {
	if upstream.Frames == 0 {
		return 0
	}
	rateRatio := float64(downstream.Frames) / float64(upstream.Frames)
	if rateRatio > 1 {
		rateRatio = 1
	}
	lost := 0
	total := 0
	for messageType, upCount := range upstream.MessageTypes {
		if upCount == 0 {
			continue
		}
		total++
		downCount := downstream.MessageTypes[messageType]
		if float64(downCount) < float64(upCount)*0.7 {
			lost++
		}
	}
	typeRatio := 1.0
	if total > 0 {
		typeRatio = 1 - float64(lost)/float64(total)
	}
	value := int(math.Round(100 * (0.6*rateRatio + 0.4*typeRatio)))
	return clamp(value, 0, 100)
}
