package quality

import (
	"context"
	"sort"
	"time"
)

const (
	TargetStation  = "station"
	TargetRelayJob = "relay_job"

	DirectionIngest     = "ingest"
	DirectionUpstream   = "upstream"
	DirectionDownstream = "downstream"

	LevelCritical = "critical"
	LevelMajor    = "major"
	LevelMinor    = "minor"
	LevelInfo     = "info"
)

type Target struct {
	Type         string `json:"targetType"`
	ID           int64  `json:"targetId"`
	MountpointID int64  `json:"mountpointId"`
	Direction    string `json:"direction"`
	// ExpectedStationID is the configured station id (when known). It is not
	// serialized because the value is internal configuration, not live data.
	ExpectedStationID uint16 `json:"-"`
}

func (t Target) Key() string {
	return t.Type + ":" + itoa(t.ID) + ":" + itoa(t.MountpointID) + ":" + t.Direction
}

func itoa(value int64) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var buf [24]byte
	index := len(buf)
	for value > 0 {
		index--
		buf[index] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		index--
		buf[index] = '-'
	}
	return string(buf[index:])
}

type ScoreParts struct {
	Transport int `json:"transport"`
	Integrity int `json:"integrity"`
	MSM       int `json:"msm"`
	Metadata  int `json:"metadata"`
	Signal    int `json:"signal"`
	Latency   int `json:"latency"`
}

type Snapshot struct {
	TargetType      string         `json:"targetType"`
	TargetID        int64          `json:"targetId"`
	MountpointID    int64          `json:"mountpointId"`
	Direction       string         `json:"direction"`
	Ts              string         `json:"ts"`
	Score           int            `json:"score"`
	ScoreParts      ScoreParts     `json:"scoreParts"`
	State           string         `json:"state"`
	Frames          uint64         `json:"frames"`
	Bytes           uint64         `json:"bytes"`
	CRCErrors       uint64         `json:"crcErrors"`
	ParseErrors     uint64         `json:"parseErrors"`
	LengthErrors    uint64         `json:"lengthErrors"`
	UnknownMessages uint64         `json:"unknownMessages"`
	MSMEpochs       uint64         `json:"msmEpochs"`
	Satellites      int            `json:"satellites"`
	Signals         int            `json:"signals"`
	Cells           int            `json:"cells"`
	AvgCnr          float64        `json:"avgCnr"`
	CNRAvailable    bool           `json:"cnrAvailable"`
	ReportedStation *uint16        `json:"reportedStationId,omitempty"`
	ARPX            *int64         `json:"arpX,omitempty"`
	ARPY            *int64         `json:"arpY,omitempty"`
	ARPZ            *int64         `json:"arpZ,omitempty"`
	ARPDeltaM       *float64       `json:"arpDeltaM,omitempty"`
	Antenna         string         `json:"antenna,omitempty"`
	AgeMs           int64          `json:"ageMs"`
	Gaps            int            `json:"gaps"`
	MetadataOK      bool           `json:"metadataOk"`
	BaselineSat     int            `json:"baselineSatellites"`
	BaselineCells   int            `json:"baselineCells"`
	MessageTypes    map[int]uint64 `json:"messageTypes"`
	Parity          *int           `json:"parity,omitempty"`
	JobScore        *int           `json:"jobScore,omitempty"`
	Live            bool           `json:"live"`
}

type Health struct {
	QueueDepth  int    `json:"queueDepth"`
	QueueSize   int    `json:"queueSize"`
	Dropped     uint64 `json:"dropped"`
	ParseErrors uint64 `json:"parseErrors"`
	Targets     int    `json:"targets"`
	AlertsOpen  int    `json:"alertsOpen"`
	StoreDrops  uint64 `json:"storeDrops"`
	Time        string `json:"time"`
}

type Sample struct {
	Target       Target
	Ts           time.Time
	WindowSec    int
	Score        int
	State        string
	Frames       uint64
	Bytes        uint64
	CRCErrors    uint64
	ParseErrors  uint64
	Unknown      uint64
	MSMEpochs    uint64
	Satellites   int
	Signals      int
	Cells        int
	AvgCnr       float64
	StationID    *uint16
	ARPX         *int64
	ARPY         *int64
	ARPZ         *int64
	ARPDeltaM    *float64
	Antenna      string
	AgeMs        int64
	Gaps         int
	CNRAvailable bool
	Details      map[string]any
}

type MessageStat struct {
	Target       Target
	HourStartUTC time.Time
	MessageType  int
	Count        uint64
	Bytes        uint64
	LastSeenAt   time.Time
}

type AlertRecord struct {
	Target    Target
	EventType string
	Code      string
	Level     string
	FirstSeen time.Time
	LastSeen  time.Time
	Details   map[string]any
}

type ResolveAlert struct {
	Target     Target
	Code       string
	ResolvedAt time.Time
}

type Store interface {
	SaveMessageStats(ctx context.Context, rows []MessageStat) error
	SaveSamples(ctx context.Context, rows []Sample) error
	UpsertAlert(ctx context.Context, alert AlertRecord) error
	ResolveAlert(ctx context.Context, target Target, code string, resolvedAt time.Time) error
}

type PruneStore interface {
	Prune(ctx context.Context, sampleBefore time.Time, alertBefore time.Time, batch int) error
}

type sortableSnapshots []Snapshot

func (s sortableSnapshots) Len() int      { return len(s) }
func (s sortableSnapshots) Swap(i, j int) { s[i], s[j] = s[j], s[i] }
func (s sortableSnapshots) Less(i, j int) bool {
	if s[i].TargetType != s[j].TargetType {
		return s[i].TargetType < s[j].TargetType
	}
	if s[i].TargetID != s[j].TargetID {
		return s[i].TargetID < s[j].TargetID
	}
	if s[i].MountpointID != s[j].MountpointID {
		return s[i].MountpointID < s[j].MountpointID
	}
	return s[i].Direction < s[j].Direction
}

func sortSnapshots(items []Snapshot) {
	sort.Sort(sortableSnapshots(items))
}
