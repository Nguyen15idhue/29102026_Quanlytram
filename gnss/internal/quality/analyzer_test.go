package quality

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func readFrame(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name+".bin"))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return data
}

func payloadOf(t *testing.T, frame []byte) []byte {
	t.Helper()
	if len(frame) < 6 || frame[0] != 0xD3 {
		t.Fatalf("invalid frame length %d", len(frame))
	}
	length := int(frame[1]&0x03)<<8 | int(frame[2])
	if len(frame) < length+6 {
		t.Fatalf("truncated fixture: frame=%d length=%d", len(frame), length)
	}
	return frame[3 : 3+length]
}

func encodeFrame(payload []byte) []byte {
	frame := []byte{0xD3, byte(len(payload)>>8) & 0x03, byte(len(payload))}
	frame = append(frame, payload...)
	crc := crc24q(frame)
	return append(frame, byte(crc>>16), byte(crc>>8), byte(crc))
}

func addState(analyzer *Analyzer, target Target) *targetState {
	analyzer.mu.Lock()
	defer analyzer.mu.Unlock()
	state := newTargetState(target)
	analyzer.targets[target.Key()] = state
	return state
}

func ingestState(state *targetState, now time.Time, chunks ...[]byte) {
	for _, chunk := range chunks {
		state.ingest(chunk, now, DefaultOptions().GapThreshold)
	}
}

func Test6T1ParseKnownMessages(t *testing.T) {
	cases := []struct {
		name string
		want int
	}{
		{"1005", 1005},
		{"1006", 1006},
		{"1007", 1007},
		{"1008", 1008},
		{"1033", 1033},
		{"1077", 1077},
		{"1087", 1087},
		{"1097", 1097},
		{"1127", 1127},
		{"1230", 1230},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			frame := readFrame(t, testCase.name)
			info, err := decodeMessage(payloadOf(t, frame))
			if err != nil {
				t.Fatalf("decode: %v", err)
			}
			if info.Number != testCase.want {
				t.Fatalf("number = %d, want %d", info.Number, testCase.want)
			}
			if testCase.want >= 1074 && testCase.want <= 1127 {
				if !info.MSM {
					t.Fatalf("expected MSM for %d", testCase.want)
				}
				if info.Satellites == 0 {
					t.Fatalf("expected satellites for %d", testCase.want)
				}
				if testCase.want%10 == 7 && info.CNRCount > 0 {
					avg := info.CNRSum / float64(info.CNRCount)
					if avg < 10 || avg > 70 {
						t.Fatalf("CNR %d looks unscaled (avg %.2f)", testCase.want, avg)
					}
				}
			}
			if testCase.want == 1005 || testCase.want == 1006 {
				if !info.HasARP || !info.HasStation {
					t.Fatalf("expected ARP/station for %d", testCase.want)
				}
			}
			if testCase.want == 1007 || testCase.want == 1008 || testCase.want == 1033 {
				if !info.HasStation {
					t.Fatalf("expected station id for %d", testCase.want)
				}
			}
		})
	}
}

func Test6T2InvalidTruncatedUnknownAndMultiFrame(t *testing.T) {
	now := time.Now().UTC()
	analyzer := NewAnalyzer(Options{QueueSize: 8}, nil)
	state := addState(analyzer, Target{Type: TargetStation, ID: 1, Direction: DirectionIngest})

	valid := readFrame(t, "1005")
	badCRC := append([]byte(nil), valid...)
	badCRC[len(badCRC)-1] ^= 0xFF
	ingestState(state, now, badCRC)
	if state.crc != 1 || state.frames != 0 {
		t.Fatalf("bad CRC counters = crc %d frames %d", state.crc, state.frames)
	}

	truncated := valid[:5]
	ingestState(state, now, truncated)
	if state.frames != 0 {
		t.Fatalf("truncated frame counted as valid")
	}
	state.buf = state.buf[:0]

	unknownPayload := []byte{0x3E, 0x70, 0x00, 0x00}
	ingestState(state, now, encodeFrame(unknownPayload))
	if state.unknown != 1 {
		t.Fatalf("unknown = %d, want 1", state.unknown)
	}

	combined := append([]byte(nil), readFrame(t, "1005")...)
	combined = append(combined, readFrame(t, "1006")...)
	combined = append(combined, readFrame(t, "1077")...)
	ingestState(state, now, combined)
	if state.frames != 4 {
		t.Fatalf("frames = %d, want 4 (unknown + 3 valid)", state.frames)
	}
	if state.msm != 1 {
		t.Fatalf("msm = %d, want 1", state.msm)
	}

	fragmented := NewAnalyzer(Options{QueueSize: 8}, nil)
	fragState := addState(fragmented, Target{Type: TargetStation, ID: 2, Direction: DirectionIngest})
	for _, value := range combined {
		ingestState(fragState, now, []byte{value})
	}
	if fragState.frames != 3 {
		t.Fatalf("fragmented frames = %d, want 3", fragState.frames)
	}
}

func Test6T2QueueFullNeverBlocks(t *testing.T) {
	analyzer := NewAnalyzer(Options{QueueSize: 1}, nil)
	analyzer.Feed(Target{Type: TargetStation, ID: 1, Direction: DirectionIngest}, []byte{1, 2, 3})
	start := time.Now()
	analyzer.Feed(Target{Type: TargetStation, ID: 1, Direction: DirectionIngest}, []byte{4, 5, 6})
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("Feed blocked for %s", elapsed)
	}
	if health := analyzer.Health(); health.Dropped != 1 {
		t.Fatalf("dropped = %d, want 1", health.Dropped)
	}
}

func Test6T5ScoreAndParity(t *testing.T) {
	good, _ := scoreFor(scoreInput{
		State:         "streaming",
		AgeMs:         200,
		Frames:        1000,
		MSMEpochs:     100,
		Satellites:    24,
		Signals:       48,
		Cells:         96,
		BaselineSat:   24,
		BaselineCells: 96,
		AvgCnr:        42,
		CNRAvailable:  true,
		MetadataOK:    true,
		HasAntenna:    true,
		ARPDeltaM:     0.2,
		HasARPDelta:   true,
	})
	if good < 90 {
		t.Fatalf("good score = %d, want >= 90", good)
	}
	bad, _ := scoreFor(scoreInput{
		State:        "stale",
		AgeMs:        25000,
		Gaps:         4,
		Frames:       100,
		CRCErrors:    20,
		ParseErrors:  5,
		MSMEpochs:    0,
		Satellites:   0,
		CNRAvailable: false,
		MetadataOK:   false,
	})
	if bad >= good {
		t.Fatalf("bad score %d should be lower than good score %d", bad, good)
	}

	upstream := Snapshot{
		Frames: 100,
		MessageTypes: map[int]uint64{
			1005: 10,
			1077: 80,
			1087: 10,
		},
	}
	downstream := Snapshot{
		Frames: 60,
		MessageTypes: map[int]uint64{
			1005: 10,
			1077: 50,
		},
	}
	if parity := parityFor(upstream, downstream); parity >= 70 {
		t.Fatalf("parity = %d, expected degradation < 70", parity)
	}
	if parity := parityFor(upstream, upstream); parity != 100 {
		t.Fatalf("identical parity = %d, want 100", parity)
	}
}

func Test6T7StationIngestAndRelayParitySnapshot(t *testing.T) {
	analyzer := NewAnalyzer(Options{QueueSize: 8}, nil)
	now := time.Now().UTC()
	station := addState(analyzer, Target{
		Type:         TargetStation,
		ID:           10,
		MountpointID: 20,
		Direction:    DirectionIngest,
	})
	ingestState(station, now, readFrame(t, "1005"), readFrame(t, "1077"))

	upstream := addState(analyzer, Target{
		Type:      TargetRelayJob,
		ID:        30,
		Direction: DirectionUpstream,
	})
	downstream := addState(analyzer, Target{
		Type:      TargetRelayJob,
		ID:        30,
		Direction: DirectionDownstream,
	})
	ingestState(upstream, now, readFrame(t, "1005"), readFrame(t, "1077"), readFrame(t, "1087"))
	ingestState(downstream, now, readFrame(t, "1005"))

	snapshots := analyzer.Snapshot()
	if len(snapshots) != 3 {
		t.Fatalf("snapshots = %d, want 3", len(snapshots))
	}
	var stationSnapshot *Snapshot
	var relaySnapshot *Snapshot
	for index := range snapshots {
		if snapshots[index].TargetType == TargetStation {
			stationSnapshot = &snapshots[index]
		}
		if snapshots[index].TargetType == TargetRelayJob && snapshots[index].Direction == DirectionDownstream {
			relaySnapshot = &snapshots[index]
		}
	}
	if stationSnapshot == nil || stationSnapshot.Frames != 2 {
		t.Fatalf("station snapshot missing or wrong frames")
	}
	if relaySnapshot == nil || relaySnapshot.Parity == nil {
		t.Fatalf("relay parity missing")
	}
	if *relaySnapshot.Parity >= 70 {
		t.Fatalf("relay parity = %d, expected degradation", *relaySnapshot.Parity)
	}
	if relaySnapshot.JobScore == nil {
		t.Fatalf("job score missing")
	}
}

type fakeStore struct {
	mu       sync.Mutex
	alerts   []AlertRecord
	resolved []string
	samples  []Sample
	stats    []MessageStat
}

func (f *fakeStore) SaveMessageStats(_ context.Context, rows []MessageStat) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stats = append(f.stats, rows...)
	return nil
}

func (f *fakeStore) SaveSamples(_ context.Context, rows []Sample) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.samples = append(f.samples, rows...)
	return nil
}

func (f *fakeStore) UpsertAlert(_ context.Context, alert AlertRecord) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.alerts = append(f.alerts, alert)
	return nil
}

func (f *fakeStore) ResolveAlert(_ context.Context, target Target, code string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resolved = append(f.resolved, target.Key()+":"+code)
	return nil
}

func (f *fakeStore) alertCount(code string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	count := 0
	for _, alert := range f.alerts {
		if alert.Code == code {
			count++
		}
	}
	return count
}

func (f *fakeStore) resolvedCount(code string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	count := 0
	for _, value := range f.resolved {
		if len(value) >= len(code) && value[len(value)-len(code):] == code {
			count++
		}
	}
	return count
}

func Test6T6AlertDebounceAndResolve(t *testing.T) {
	store := &fakeStore{}
	analyzer := NewAnalyzer(Options{QueueSize: 8, AlertWindows: 3}, store)
	state := addState(analyzer, Target{Type: TargetStation, ID: 1, Direction: DirectionIngest})
	state.frames = 10
	state.lastDataAt = time.Now().UTC().Add(-31 * time.Second)
	state.lastFeedAt = state.lastDataAt

	now := time.Now().UTC()
	for index := 0; index < 2; index++ {
		analyzer.evaluate(now.Add(time.Duration(index) * time.Second))
	}
	if store.alertCount("quality.no_data") != 0 {
		t.Fatalf("alert opened before debounce window")
	}
	analyzer.evaluate(now.Add(2 * time.Second))
	if store.alertCount("quality.no_data") != 1 {
		t.Fatalf("alert not opened after debounce window")
	}

	state.lastDataAt = time.Now().UTC()
	for index := 0; index < 3; index++ {
		analyzer.evaluate(now.Add(time.Duration(10+index) * time.Second))
	}
	if store.resolvedCount("quality.no_data") != 1 {
		t.Fatalf("alert not resolved after recovery window")
	}
}

func Test6T9AsyncStoreQueueFullAndFlush(t *testing.T) {
	store := &fakeStore{}
	async := NewAsyncStore(store, 1)
	if err := async.SaveSamples(context.Background(), []Sample{{Score: 1}}); err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	start := time.Now()
	if err := async.SaveSamples(context.Background(), []Sample{{Score: 2}}); err != nil {
		t.Fatalf("second enqueue: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
		t.Fatalf("enqueue blocked for %s", elapsed)
	}
	if async.Dropped() != 1 {
		t.Fatalf("dropped = %d, want 1", async.Dropped())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	async.Run(ctx)
	if len(store.samples) != 1 {
		t.Fatalf("flushed samples = %d, want 1", len(store.samples))
	}
}
func TestSatelliteAggregationAcrossConstellations(t *testing.T) {
	state := newTargetState(Target{Type: TargetStation, ID: 1})
	state.applyMessage(messageInfo{
		Number: 1074, MSM: true,
		SatelliteMask: 0b111,
		SignalMask:    0b0001, CellMask: 0b111,
	}, 0)
	state.applyMessage(messageInfo{
		Number: 1084, MSM: true,
		SatelliteMask: 0b11,
		SignalMask:    0b0010, CellMask: 0b11,
	}, 0)
	state.applyMessage(messageInfo{
		Number: 1094, MSM: true,
		SatelliteMask: 0b111,
		SignalMask:    0b0100, CellMask: 0b111,
	}, 0)
	if state.satellites != 8 {
		t.Fatalf("satellites = %d, want 8", state.satellites)
	}
	if state.signals != 3 {
		t.Fatalf("signals = %d, want 3", state.signals)
	}
	if state.cells != 8 {
		t.Fatalf("cells = %d, want 8", state.cells)
	}
	if len(state.constellations()) != 3 {
		t.Fatalf("constellations = %d, want 3", len(state.constellations()))
	}
}

func Test6T8MsmObservationMetrics(t *testing.T) {
	analyzer := NewAnalyzer(Options{QueueSize: 8}, nil)
	state := addState(analyzer, Target{Type: TargetStation, ID: 40, Direction: DirectionIngest})
	now := time.Now().UTC()
	ingestState(state, now, readFrame(t, "1077"), readFrame(t, "1087"))
	if state.observationCount == 0 {
		t.Fatalf("observations = 0, want > 0")
	}
	ingestState(state, now.Add(time.Second), readFrame(t, "1077"), readFrame(t, "1087"))
	if state.codePhaseSamples == 0 {
		t.Fatalf("code phase samples = 0, want > 0")
	}
	snapshot := state.snapshot(now.Add(2*time.Second), DefaultOptions())
	if snapshot.Observations == 0 {
		t.Fatalf("snapshot observations = 0")
	}
	if snapshot.LatencyMs < 0 {
		t.Fatalf("latency = %d", snapshot.LatencyMs)
	}
}
