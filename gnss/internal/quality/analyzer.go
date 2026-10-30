package quality

import (
	"context"
	"math/bits"
	"sort"
	"sync"
	"time"
)

const maxTargetBuffer = 128 * 1024

type Options struct {
	QueueSize       int
	SampleInterval  time.Duration
	StatsInterval   time.Duration
	EvalInterval    time.Duration
	AlertWindows    int
	GapThreshold    time.Duration
	StaleAfter      time.Duration
	BaselineWindow  int
	SampleWindowSec int
}

func DefaultOptions() Options {
	return Options{
		QueueSize:       2048,
		SampleInterval:  60 * time.Second,
		StatsInterval:   10 * time.Second,
		EvalInterval:    5 * time.Second,
		AlertWindows:    3,
		GapThreshold:    2 * time.Second,
		StaleAfter:      5 * time.Second,
		BaselineWindow:  120,
		SampleWindowSec: 60,
	}
}

func (o Options) withDefaults() Options {
	defaults := DefaultOptions()
	if o.QueueSize <= 0 {
		o.QueueSize = defaults.QueueSize
	}
	if o.SampleInterval <= 0 {
		o.SampleInterval = defaults.SampleInterval
	}
	if o.StatsInterval <= 0 {
		o.StatsInterval = defaults.StatsInterval
	}
	if o.EvalInterval <= 0 {
		o.EvalInterval = defaults.EvalInterval
	}
	if o.AlertWindows <= 0 {
		o.AlertWindows = defaults.AlertWindows
	}
	if o.GapThreshold <= 0 {
		o.GapThreshold = defaults.GapThreshold
	}
	if o.StaleAfter <= 0 {
		o.StaleAfter = defaults.StaleAfter
	}
	if o.BaselineWindow <= 0 {
		o.BaselineWindow = defaults.BaselineWindow
	}
	if o.SampleWindowSec <= 0 {
		o.SampleWindowSec = defaults.SampleWindowSec
	}
	return o
}

type feedItem struct {
	target Target
	data   []byte
	at     time.Time
}

type rateBucket struct {
	frames uint64
	crc    uint64
	parse  uint64
}

type baselineObs struct {
	satellites int
	cells      int
}

type alertState struct {
	count    int
	okCount  int
	open     bool
	lastEmit time.Time
}

type sampleMark struct {
	frames  uint64
	bytes   uint64
	crc     uint64
	parse   uint64
	unknown uint64
	msm     uint64
	gaps    int
}

type targetState struct {
	target Target

	buf     []byte
	frames  uint64
	bytes   uint64
	crc     uint64
	parse   uint64
	length  uint64
	unknown uint64
	msm     uint64

	messageTypes map[int]uint64
	dirtyTypes   map[int]uint64
	dirtyBytes   map[int]uint64

	satellites int
	signals    int
	cells      int
	satMasks   map[int]uint64
	sigMasks   map[int]uint32
	cellMasks  map[int]uint64
	cnrSum     float64
	cnrCount   int

	has1005 bool
	has1006 bool
	has1007 bool
	has1008 bool
	has1033 bool

	hasStation      bool
	stationID       uint16
	hasFirstStation bool
	firstStationID  uint16

	hasARP      bool
	arpX        int64
	arpY        int64
	arpZ        int64
	arpDeltaM   float64
	hasARPDelta bool
	antenna     string

	lastFeedAt time.Time
	lastDataAt time.Time
	gaps       int

	recent []rateBucket
	base   []baselineObs

	alerts map[string]*alertState
	mark   sampleMark

	evalFrames uint64
	evalCRC    uint64
	evalParse  uint64
}

func newTargetState(target Target) *targetState {
	return &targetState{
		target:       target,
		messageTypes: make(map[int]uint64),
		dirtyTypes:   make(map[int]uint64),
		dirtyBytes:   make(map[int]uint64),
		satMasks:     make(map[int]uint64),
		sigMasks:     make(map[int]uint32),
		cellMasks:    make(map[int]uint64),
		alerts:       make(map[string]*alertState),
	}
}

type Analyzer struct {
	opts  Options
	store Store

	queue  chan feedItem
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu         sync.Mutex
	targets    map[string]*targetState
	dropped    uint64
	openAlerts int
	started    bool
	storeDrops *AsyncStore
}

func NewAnalyzer(opts Options, store Store) *Analyzer {
	opts = opts.withDefaults()
	analyzer := &Analyzer{
		opts:    opts,
		store:   store,
		queue:   make(chan feedItem, opts.QueueSize),
		targets: make(map[string]*targetState),
	}
	if async, ok := store.(*AsyncStore); ok {
		analyzer.storeDrops = async
	}
	return analyzer
}

func (a *Analyzer) Feed(target Target, data []byte) {
	if len(data) == 0 {
		return
	}
	copied := append([]byte(nil), data...)
	select {
	case a.queue <- feedItem{target: target, data: copied, at: time.Now().UTC()}:
	default:
		a.mu.Lock()
		a.dropped++
		a.mu.Unlock()
	}
}

func (a *Analyzer) Run(ctx context.Context) {
	a.mu.Lock()
	if a.started {
		a.mu.Unlock()
		return
	}
	a.started = true
	a.ctx, a.cancel = context.WithCancel(ctx)
	runCtx := a.ctx
	a.mu.Unlock()

	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.consume(runCtx)
	}()

	evalTicker := time.NewTicker(a.opts.EvalInterval)
	statsTicker := time.NewTicker(a.opts.StatsInterval)
	sampleTicker := time.NewTicker(a.opts.SampleInterval)
	defer evalTicker.Stop()
	defer statsTicker.Stop()
	defer sampleTicker.Stop()

	for {
		select {
		case <-runCtx.Done():
			a.Flush()
			return
		case <-evalTicker.C:
			a.evaluate(time.Now().UTC())
		case <-statsTicker.C:
			a.flushStats(time.Now().UTC())
		case <-sampleTicker.C:
			a.emitSamples(time.Now().UTC())
		}
	}
}

// Flush writes pending samples and hourly message stats. It is safe to call
// before the analyzer context is cancelled.
func (a *Analyzer) Flush() {
	now := time.Now().UTC()
	a.flushStats(now)
	a.emitSamples(now)
}

func (a *Analyzer) Shutdown() {
	a.mu.Lock()
	cancel := a.cancel
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	a.wg.Wait()
}

func (a *Analyzer) consume(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case item := <-a.queue:
			a.mu.Lock()
			state := a.targets[item.target.Key()]
			if state == nil {
				state = newTargetState(item.target)
				a.targets[item.target.Key()] = state
			}
			state.ingest(item.data, item.at, a.opts.GapThreshold)
			a.mu.Unlock()
		}
	}
}

func (s *targetState) ingest(data []byte, now time.Time, gapThreshold time.Duration) {
	if !s.lastFeedAt.IsZero() && now.Sub(s.lastFeedAt) > gapThreshold {
		s.gaps++
	}
	s.lastFeedAt = now
	s.lastDataAt = now
	s.bytes += uint64(len(data))
	s.buf = append(s.buf, data...)
	if len(s.buf) > maxTargetBuffer {
		drop := len(s.buf) - maxTargetBuffer
		s.buf = append(s.buf[:0], s.buf[drop:]...)
		s.length++
		s.parse++
		s.evalParse++
	}

	for {
		start := -1
		for index, value := range s.buf {
			if value == 0xD3 {
				start = index
				break
			}
		}
		if start < 0 {
			s.buf = s.buf[:0]
			return
		}
		if start > 0 {
			s.buf = s.buf[start:]
		}
		if len(s.buf) < 3 {
			return
		}
		length := int(s.buf[1]&0x03)<<8 | int(s.buf[2])
		if length == 0 || length > 1023 {
			s.length++
			s.parse++
			s.evalParse++
			s.buf = s.buf[1:]
			continue
		}
		total := 3 + length + 3
		if len(s.buf) < total {
			return
		}
		if crc24q(s.buf[:3+length]) != uint32(s.buf[3+length])<<16|uint32(s.buf[3+length+1])<<8|uint32(s.buf[3+length+2]) {
			s.crc++
			s.evalCRC++
			s.buf = s.buf[1:]
			continue
		}

		frameBytes := uint64(total)
		s.frames++
		s.evalFrames++
		info, err := decodeMessage(s.buf[3 : 3+length])
		if err != nil {
			s.parse++
			s.evalParse++
		} else {
			s.applyMessage(info, frameBytes)
		}
		s.buf = s.buf[total:]
	}
}

func (s *targetState) applyMessage(info messageInfo, frameBytes uint64) {
	s.messageTypes[info.Number]++
	s.dirtyTypes[info.Number]++
	s.dirtyBytes[info.Number] += frameBytes
	if info.Unknown {
		s.unknown++
	}
	if info.MSM {
		s.msm++
		system := info.Number / 10
		s.satMasks[system] = info.SatelliteMask
		s.sigMasks[system] = info.SignalMask
		s.cellMasks[system] = info.CellMask
		s.satellites = 0
		s.signals = 0
		s.cells = 0
		for _, mask := range s.satMasks {
			s.satellites += bits.OnesCount64(mask)
		}
		for _, mask := range s.sigMasks {
			s.signals += bits.OnesCount32(mask)
		}
		for _, mask := range s.cellMasks {
			s.cells += bits.OnesCount64(mask)
		}
		s.cnrSum += info.CNRSum
		s.cnrCount += info.CNRCount
	}
	if info.Has1005 {
		s.has1005 = true
	}
	if info.Has1006 {
		s.has1006 = true
	}
	if info.Has1007 {
		s.has1007 = true
	}
	if info.Has1008 {
		s.has1008 = true
	}
	if info.Has1033 {
		s.has1033 = true
	}
	if info.HasStation {
		s.hasStation = true
		s.stationID = info.StationID
		if !s.hasFirstStation {
			s.hasFirstStation = true
			s.firstStationID = info.StationID
		}
	}
	if info.HasARP {
		if s.hasARP {
			dx := float64(info.ARPX - s.arpX)
			dy := float64(info.ARPY - s.arpY)
			dz := float64(info.ARPZ - s.arpZ)
			s.arpDeltaM = sqrt(dx*dx+dy*dy+dz*dz) / 1000.0
			s.hasARPDelta = true
		}
		s.hasARP = true
		s.arpX = info.ARPX
		s.arpY = info.ARPY
		s.arpZ = info.ARPZ
	}
	if info.Antenna != "" {
		s.antenna = info.Antenna
	}
}

func (s *targetState) averageCNR() float64 {
	if s.cnrCount == 0 {
		return 0
	}
	return s.cnrSum / float64(s.cnrCount)
}

func (s *targetState) constellations() []Constellation {
	names := map[int]string{
		107: "GPS",
		108: "GLONASS",
		109: "Galileo",
		110: "SBAS",
		111: "QZSS",
		112: "BeiDou",
	}
	systems := make([]int, 0, len(s.satMasks))
	for system := range s.satMasks {
		systems = append(systems, system)
	}
	sort.Ints(systems)
	result := make([]Constellation, 0, len(systems))
	for _, system := range systems {
		result = append(result, Constellation{
			System:     names[system],
			Satellites: bits.OnesCount64(s.satMasks[system]),
			Signals:    bits.OnesCount32(s.sigMasks[system]),
			Cells:      bits.OnesCount64(s.cellMasks[system]),
		})
	}
	return result
}

func (s *targetState) baselineMedian() (int, int) {
	if len(s.base) == 0 {
		return 0, 0
	}
	sat := make([]int, 0, len(s.base))
	cells := make([]int, 0, len(s.base))
	for _, observation := range s.base {
		sat = append(sat, observation.satellites)
		cells = append(cells, observation.cells)
	}
	sort.Ints(sat)
	sort.Ints(cells)
	return sat[len(sat)/2], cells[len(cells)/2]
}

func (s *targetState) snapshot(now time.Time, opts Options) Snapshot {
	state := "unknown"
	ageMs := int64(0)
	if !s.lastDataAt.IsZero() {
		ageMs = now.Sub(s.lastDataAt).Milliseconds()
		if ageMs < 0 {
			ageMs = 0
		}
		if s.frames > 0 {
			if ageMs <= opts.StaleAfter.Milliseconds() {
				state = "streaming"
			} else {
				state = "stale"
			}
		}
	}
	baselineSat, baselineCells := s.baselineMedian()
	input := scoreInput{
		State:         state,
		AgeMs:         ageMs,
		Gaps:          s.gaps,
		Frames:        s.frames,
		CRCErrors:     s.crc,
		ParseErrors:   s.parse,
		MSMEpochs:     s.msm,
		Satellites:    s.satellites,
		Signals:       s.signals,
		Cells:         s.cells,
		BaselineSat:   baselineSat,
		BaselineCells: baselineCells,
		AvgCnr:        s.averageCNR(),
		CNRAvailable:  s.cnrCount > 0,
		MetadataOK:    s.has1005 || s.has1006,
		HasAntenna:    s.antenna != "",
		ARPDeltaM:     s.arpDeltaM,
		HasARPDelta:   s.hasARPDelta,
	}
	score, parts := scoreFor(input)
	types := make(map[int]uint64, len(s.messageTypes))
	for key, value := range s.messageTypes {
		types[key] = value
	}
	snapshot := Snapshot{
		TargetType:      s.target.Type,
		TargetID:        s.target.ID,
		MountpointID:    s.target.MountpointID,
		Direction:       s.target.Direction,
		Ts:              now.Format(time.RFC3339Nano),
		Score:           score,
		ScoreParts:      parts,
		State:           state,
		Frames:          s.frames,
		Bytes:           s.bytes,
		CRCErrors:       s.crc,
		ParseErrors:     s.parse,
		LengthErrors:    s.length,
		UnknownMessages: s.unknown,
		MSMEpochs:       s.msm,
		Satellites:      s.satellites,
		Signals:         s.signals,
		Cells:           s.cells,
		Constellations:  s.constellations(),
		AvgCnr:          s.averageCNR(),
		CNRAvailable:    s.cnrCount > 0,
		Antenna:         s.antenna,
		AgeMs:           ageMs,
		Gaps:            s.gaps,
		MetadataOK:      s.has1005 || s.has1006,
		BaselineSat:     baselineSat,
		BaselineCells:   baselineCells,
		MessageTypes:    types,
		Live:            state == "streaming",
	}
	if s.hasStation {
		value := s.stationID
		snapshot.ReportedStation = &value
	}
	if s.hasARP {
		x, y, z := s.arpX, s.arpY, s.arpZ
		snapshot.ARPX = &x
		snapshot.ARPY = &y
		snapshot.ARPZ = &z
	}
	if s.hasARPDelta {
		value := s.arpDeltaM
		snapshot.ARPDeltaM = &value
	}
	return snapshot
}

func (a *Analyzer) Snapshot() []Snapshot {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now().UTC()
	items := make([]Snapshot, 0, len(a.targets))
	byJob := make(map[int64]map[string]Snapshot)
	for _, state := range a.targets {
		snapshot := state.snapshot(now, a.opts)
		items = append(items, snapshot)
		if snapshot.TargetType == TargetRelayJob {
			if byJob[snapshot.TargetID] == nil {
				byJob[snapshot.TargetID] = make(map[string]Snapshot)
			}
			byJob[snapshot.TargetID][snapshot.Direction] = snapshot
		}
	}
	for _, directions := range byJob {
		upstream, hasUp := directions[DirectionUpstream]
		downstream, hasDown := directions[DirectionDownstream]
		if !hasUp || !hasDown {
			continue
		}
		parity := parityFor(upstream, downstream)
		jobScore := upstream.Score
		if downstream.Score < jobScore {
			jobScore = downstream.Score
		}
		for index := range items {
			if items[index].TargetType != TargetRelayJob || items[index].TargetID != upstream.TargetID {
				continue
			}
			parityCopy := parity
			jobScoreCopy := jobScore
			items[index].Parity = &parityCopy
			items[index].JobScore = &jobScoreCopy
		}
	}
	sortSnapshots(items)
	return items
}

func (a *Analyzer) Health() Health {
	a.mu.Lock()
	defer a.mu.Unlock()
	var parseErrors uint64
	for _, state := range a.targets {
		parseErrors += state.parse
	}
	health := Health{
		QueueDepth:  len(a.queue),
		QueueSize:   cap(a.queue),
		Dropped:     a.dropped,
		ParseErrors: parseErrors,
		Targets:     len(a.targets),
		AlertsOpen:  a.openAlerts,
		Time:        time.Now().UTC().Format(time.RFC3339),
	}
	if a.storeDrops != nil {
		health.StoreDrops = a.storeDrops.Dropped()
	}
	return health
}

func (a *Analyzer) evaluate(now time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()

	identities := make(map[string]Target, len(a.targets))
	for key, state := range a.targets {
		identities[key] = state.target
		state.recent = append(state.recent, rateBucket{
			frames: state.evalFrames,
			crc:    state.evalCRC,
			parse:  state.evalParse,
		})
		state.evalFrames = 0
		state.evalCRC = 0
		state.evalParse = 0
		if len(state.recent) > 60 {
			state.recent = state.recent[len(state.recent)-60:]
		}
		if state.satellites > 0 || state.cells > 0 {
			state.base = append(state.base, baselineObs{
				satellites: state.satellites,
				cells:      state.cells,
			})
			if len(state.base) > a.opts.BaselineWindow {
				state.base = state.base[len(state.base)-a.opts.BaselineWindow:]
			}
		}
	}

	snapshots := make(map[string]Snapshot, len(a.targets))
	for key, state := range a.targets {
		snapshots[key] = state.snapshot(now, a.opts)
	}

	for key, state := range a.targets {
		snapshot := snapshots[key]
		var frames, crc, parse uint64
		for _, bucket := range state.recent {
			frames += bucket.frames
			crc += bucket.crc
			parse += bucket.parse
		}
		badRate := 0.0
		if frames > 0 {
			badRate = float64(crc+parse) / float64(frames)
		}
		baselineSat, _ := state.baselineMedian()

		a.applyAlert(state, now, "quality.no_data", "station_alert", LevelMajor,
			state.frames > 0 && snapshot.AgeMs > 30_000, map[string]any{"ageMs": snapshot.AgeMs})
		a.applyAlert(state, now, "quality.integrity", "station_alert", LevelMajor,
			frames > 0 && badRate > 0.05, map[string]any{"rate": badRate, "frames": frames})
		a.applyAlert(state, now, "quality.metadata_missing", "station_alert", LevelMinor,
			state.frames > 50 && !state.has1005 && !state.has1006, map[string]any{"frames": state.frames})
		a.applyAlert(state, now, "quality.cnr_low", "station_alert", LevelMinor,
			state.cnrCount > 0 && state.averageCNR() > 0 && state.averageCNR() < 25,
			map[string]any{"avgCnr": state.averageCNR()})
		a.applyAlert(state, now, "quality.arp_jump", "station_alert", LevelMajor,
			state.hasARPDelta && state.arpDeltaM > 5, map[string]any{"deltaM": state.arpDeltaM})
		a.applyAlert(state, now, "quality.msm_drop", "station_alert", LevelMajor,
			baselineSat > 0 && state.satellites < baselineSat/2,
			map[string]any{"satellites": state.satellites, "baseline": baselineSat})
		mismatch := state.hasFirstStation && state.hasStation && state.stationID != state.firstStationID
		if state.target.ExpectedStationID > 0 && state.hasStation && state.stationID != state.target.ExpectedStationID {
			mismatch = true
		}
		a.applyAlert(state, now, "quality.station_id_mismatch", "station_alert", LevelMajor,
			mismatch, map[string]any{
				"stationId": state.stationID,
				"expected":  state.target.ExpectedStationID,
				"first":     state.firstStationID,
			})
	}

	for key, state := range a.targets {
		if state.target.Type != TargetRelayJob || state.target.Direction != DirectionDownstream {
			continue
		}
		upKey := Target{
			Type:         TargetRelayJob,
			ID:           state.target.ID,
			MountpointID: state.target.MountpointID,
			Direction:    DirectionUpstream,
		}.Key()
		upstreamState := a.targets[upKey]
		if upstreamState == nil {
			continue
		}
		upstream := snapshots[upKey]
		downstream := snapshots[key]
		parity := parityFor(upstream, downstream)
		loss := upstream.Frames > 50 && (downstream.Frames*100 < upstream.Frames*70 || parity < 70)
		a.applyAlert(state, now, "quality.relay_loss", "station_alert", LevelMajor,
			loss, map[string]any{"parity": parity, "upstreamFrames": upstream.Frames, "downstreamFrames": downstream.Frames})
	}
	_ = identities
}

func (a *Analyzer) applyAlert(state *targetState, now time.Time, code, eventType, level string, condition bool, details map[string]any) {
	alert := state.alerts[code]
	if alert == nil {
		alert = &alertState{}
		state.alerts[code] = alert
	}
	if condition {
		alert.okCount = 0
		if alert.open {
			if now.Sub(alert.lastEmit) >= 10*time.Second && a.store != nil {
				alert.lastEmit = now
				a.store.UpsertAlert(context.Background(), AlertRecord{
					Target:    state.target,
					EventType: eventType,
					Code:      code,
					Level:     level,
					FirstSeen: now,
					LastSeen:  now,
					Details:   details,
				})
			}
			return
		}
		alert.count++
		if alert.count >= a.opts.AlertWindows {
			alert.open = true
			alert.lastEmit = now
			a.openAlerts++
			if a.store != nil {
				a.store.UpsertAlert(context.Background(), AlertRecord{
					Target:    state.target,
					EventType: eventType,
					Code:      code,
					Level:     level,
					FirstSeen: now,
					LastSeen:  now,
					Details:   details,
				})
			}
		}
		return
	}

	alert.count = 0
	if !alert.open {
		alert.okCount = 0
		return
	}
	alert.okCount++
	if alert.okCount >= a.opts.AlertWindows {
		alert.open = false
		alert.okCount = 0
		if a.openAlerts > 0 {
			a.openAlerts--
		}
		if a.store != nil {
			a.store.ResolveAlert(context.Background(), state.target, code, now)
		}
	}
}

func (a *Analyzer) flushStats(now time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return
	}
	hourStart := now.UTC().Truncate(time.Hour)
	rows := make([]MessageStat, 0)
	for _, state := range a.targets {
		for messageType, count := range state.dirtyTypes {
			if count == 0 {
				continue
			}
			rows = append(rows, MessageStat{
				Target:       state.target,
				HourStartUTC: hourStart,
				MessageType:  messageType,
				Count:        count,
				Bytes:        state.dirtyBytes[messageType],
				LastSeenAt:   now,
			})
		}
		state.dirtyTypes = make(map[int]uint64)
		state.dirtyBytes = make(map[int]uint64)
	}
	if len(rows) > 0 {
		a.store.SaveMessageStats(context.Background(), rows)
	}
}

func (a *Analyzer) emitSamples(now time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return
	}
	rows := make([]Sample, 0, len(a.targets))
	for _, state := range a.targets {
		snapshot := state.snapshot(now, a.opts)
		delta := Sample{
			Target:       state.target,
			Ts:           now,
			WindowSec:    a.opts.SampleWindowSec,
			Score:        snapshot.Score,
			State:        snapshot.State,
			Frames:       state.frames - state.mark.frames,
			Bytes:        state.bytes - state.mark.bytes,
			CRCErrors:    state.crc - state.mark.crc,
			ParseErrors:  state.parse - state.mark.parse,
			Unknown:      state.unknown - state.mark.unknown,
			MSMEpochs:    state.msm - state.mark.msm,
			Satellites:   state.satellites,
			Signals:      state.signals,
			Cells:        state.cells,
			AvgCnr:       snapshot.AvgCnr,
			StationID:    snapshot.ReportedStation,
			ARPX:         snapshot.ARPX,
			ARPY:         snapshot.ARPY,
			ARPZ:         snapshot.ARPZ,
			ARPDeltaM:    snapshot.ARPDeltaM,
			Antenna:      snapshot.Antenna,
			AgeMs:        snapshot.AgeMs,
			Gaps:         state.gaps - state.mark.gaps,
			CNRAvailable: snapshot.CNRAvailable,
			Details: map[string]any{
				"scoreParts":        snapshot.ScoreParts,
				"metadataOk":        snapshot.MetadataOK,
				"baselineSat":       snapshot.BaselineSat,
				"baselineCells":     snapshot.BaselineCells,
				"lengthErrors":      snapshot.LengthErrors,
				"unknownMessages":   snapshot.UnknownMessages,
				"reportedStationId": snapshot.ReportedStation,
				"constellations":    snapshot.Constellations,
			},
		}
		state.mark = sampleMark{
			frames:  state.frames,
			bytes:   state.bytes,
			crc:     state.crc,
			parse:   state.parse,
			unknown: state.unknown,
			msm:     state.msm,
			gaps:    state.gaps,
		}
		rows = append(rows, delta)
	}
	if len(rows) > 0 {
		a.store.SaveSamples(context.Background(), rows)
	}
}

func sqrt(value float64) float64 {
	if value <= 0 {
		return 0
	}
	guess := value
	for i := 0; i < 20; i++ {
		guess = 0.5 * (guess + value/guess)
	}
	return guess
}

// crc24q mirrors the CRC used by RTCM3 framing. It deliberately lives here so
// the analyzer can validate frames without mutating or re-serializing bytes.
func crc24q(data []byte) uint32 {
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
