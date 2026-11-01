package relay

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	"cors/gnss/internal/nmea"
	"cors/gnss/internal/ntrip"
	"cors/gnss/internal/quality"
	"cors/gnss/internal/secret"
)

const (
	// defaultStationIdleTimeout: nguồn không gửi byte quá khoảng này thì coi như treo
	// và kết nối lại. Luồng RTCM bình thường ~1 frame/giây nên 30s là ngưỡng an toàn.
	defaultStationIdleTimeout = 30 * time.Second
	// stableStreamAfter: phiên nhận dữ liệu đủ lâu mới reset backoff; tránh vòng lặp
	// nguồn "mở rồi đóng ngay" làm kết nối lại liên tục.
	stableStreamAfter = 10 * time.Second
)

// StationSourceConfig là nguồn NTRIP client của một trạm
// (station_sources.source_role = 'ntrip_client'). Kết nối upstream dùng lại
// toNtripEndpoint/ntrip.Get/backoff/classify của relay; khác relay ở chỗ
// không có downstream: byte nhận được chỉ đẩy vào bộ đo chất lượng của trạm.
type StationSourceConfig struct {
	StationID       int64
	MountpointID    int64
	StationName     string
	Endpoint        EndpointConfig
	SendGGA         bool
	Lat             *float64
	Lon             *float64
	NMEAIntervalSec int
}

// StationSourceOptions gồm Options dùng chung với relay và IdleTimeout riêng của nguồn trạm.
type StationSourceOptions struct {
	Options
	IdleTimeout time.Duration
}

func (o StationSourceOptions) withDefaults() StationSourceOptions {
	o.Options = o.Options.withDefaults()
	if o.IdleTimeout <= 0 {
		o.IdleTimeout = defaultStationIdleTimeout
	}
	return o
}

// stationSessionHooks được gọi đồng bộ trong goroutine của phiên.
type stationSessionHooks struct {
	feed      func([]byte)
	streaming func()
}

type StationSourceStore interface {
	LoadAll(ctx context.Context) ([]*StationSourceConfig, error)
}

type StationSourceSessionStore interface {
	Start(ctx context.Context, stationID int64) (int64, error)
	End(ctx context.Context, id int64, reason, message string) error
	CloseOpen(ctx context.Context, reason string) error
}

type stationSourceSessionMySQLStore struct {
	db *sql.DB
}

func NewStationSourceSessionStore(db *sql.DB) StationSourceSessionStore {
	return &stationSourceSessionMySQLStore{db: db}
}

func (s *stationSourceSessionMySQLStore) Start(ctx context.Context, stationID int64) (int64, error) {
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO station_source_sessions (station_id, start_ts)
		VALUES (?, UTC_TIMESTAMP(3))`, stationID)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	return id, err
}

func (s *stationSourceSessionMySQLStore) End(ctx context.Context, id int64, reason, message string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE station_source_sessions
		   SET end_ts = UTC_TIMESTAMP(3), close_reason = ?, message = ?
		 WHERE id = ? AND end_ts IS NULL`, reason, message, id)
	return err
}

func (s *stationSourceSessionMySQLStore) CloseOpen(ctx context.Context, reason string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE station_source_sessions
		   SET end_ts = UTC_TIMESTAMP(3), close_reason = ?
		 WHERE end_ts IS NULL`, reason)
	return err
}

type stationSourceMySQLStore struct {
	db     *sql.DB
	encKey string
}

func NewStationSourceStore(db *sql.DB, encKey string) StationSourceStore {
	return &stationSourceMySQLStore{db: db, encKey: encKey}
}

const stationSourceQuery = `
SELECT s.id, s.name,
       COALESCE((SELECT m.id FROM mountpoints m WHERE m.station_id = s.id ORDER BY m.id LIMIT 1), 0),
       ss.client_host, ss.client_port, ss.client_mount, ss.client_tls,
       ss.client_username, COALESCE(ss.client_password_enc, ''),
       s.ntrip_version, s.lat, s.lon,
       ss.client_send_gga, ss.client_gga_lat, ss.client_gga_lon, ss.client_nmea_interval_sec
  FROM station_sources ss
  JOIN stations s ON s.id = ss.station_id
 WHERE ss.source_role = 'ntrip_client'
   AND ss.client_host <> ''
   AND ss.client_mount <> ''
   AND s.enabled = 1 AND s.status <> 'locked'
 ORDER BY s.id`

func (s *stationSourceMySQLStore) LoadAll(ctx context.Context) ([]*StationSourceConfig, error) {
	rows, err := s.db.QueryContext(ctx, stationSourceQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var configs []*StationSourceConfig
	for rows.Next() {
		var (
			cfg             StationSourceConfig
			tls, sendGGA    int
			passwordEnc     string
			ntripVersion    string
			stationLat      sql.NullFloat64
			stationLon      sql.NullFloat64
			ggaLat, ggaLon  sql.NullFloat64
			nmeaIntervalSec int
			username        string
		)
		if err := rows.Scan(
			&cfg.StationID,
			&cfg.StationName,
			&cfg.MountpointID,
			&cfg.Endpoint.Host,
			&cfg.Endpoint.Port,
			&cfg.Endpoint.Mount,
			&tls,
			&username,
			&passwordEnc,
			&ntripVersion,
			&stationLat,
			&stationLon,
			&sendGGA,
			&ggaLat,
			&ggaLon,
			&nmeaIntervalSec,
		); err != nil {
			return nil, err
		}
		cfg.Endpoint.SSL = tls != 0
		cfg.Endpoint.NtripVersion = ntripVersion
		cfg.Endpoint.Username = username
		cfg.Endpoint.HasCredential = username != "" || passwordEnc != ""
		if passwordEnc != "" {
			password, err := secret.Decrypt(passwordEnc, s.encKey)
			if err != nil {
				return nil, fmt.Errorf("station %d source credential: %w", cfg.StationID, err)
			}
			cfg.Endpoint.Password = password
		}
		cfg.SendGGA = sendGGA != 0
		cfg.NMEAIntervalSec = nmeaIntervalSec
		if cfg.SendGGA {
			// Ưu tiên toạ độ GGA đã cấu hình, sau đó toạ độ trạm; nếu vẫn chưa có
			// thì runner sẽ lấy toạ độ từ 1005/1006 của chính luồng nguồn.
			if ggaLat.Valid && ggaLon.Valid {
				lat, lon := ggaLat.Float64, ggaLon.Float64
				cfg.Lat = &lat
				cfg.Lon = &lon
			} else if stationLat.Valid && stationLon.Valid {
				lat, lon := stationLat.Float64, stationLon.Float64
				cfg.Lat = &lat
				cfg.Lon = &lon
			}
		}
		configs = append(configs, &cfg)
	}
	return configs, rows.Err()
}

// RunStationSource mở một phiên GET upstream (cùng đường với relay upstream)
// và chuyển từng đoạn byte cho hooks.feed. Trả lỗi khi phiên kết thúc
// (đóng kết nối, lỗi mạng, hết thời gian chờ byte = idle timeout).
func RunStationSource(
	ctx context.Context,
	cfg *StationSourceConfig,
	opts StationSourceOptions,
	hooks stationSessionHooks,
) error {
	opts = opts.withDefaults()
	upstream, err := ntrip.Get(ctx, toNtripEndpoint(cfg.Endpoint, "CORS-MVP-station"), opts.DialTimeout)
	if err != nil {
		return err
	}
	defer upstream.Close()

	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			upstream.Close()
		case <-done:
		}
	}()

	var scanner *framePositionScanner
	if cfg.SendGGA && upstream.Conn != nil {
		position := newPositionTracker(cfg.Lat, cfg.Lon)
		if _, _, ready := position.get(); !ready {
			scanner = newFramePositionScanner(position)
		}
		interval := opts.NMEAInterval
		if cfg.NMEAIntervalSec > 0 {
			interval = time.Duration(cfg.NMEAIntervalSec) * time.Second
		}
		go func() {
			lat, lon, ok := position.get()
			if !ok {
				select {
				case <-position.readyCh():
					lat, lon, _ = position.get()
				case <-done:
					return
				case <-ctx.Done():
					return
				}
			}
			log.Printf("[station-source] station %d (%s) GGA position %.6f,%.6f",
				cfg.StationID, cfg.StationName, lat, lon)
			writeGGA := func(at time.Time) bool {
				if err := upstream.Conn.SetWriteDeadline(time.Now().Add(2 * time.Second)); err != nil {
					return false
				}
				_, writeErr := upstream.Conn.Write(nmea.Join(lat, lon, at))
				_ = upstream.Conn.SetWriteDeadline(time.Time{})
				return writeErr == nil
			}
			// Gửi ngay để caster có GGA sớm, không đợi hết chu kỳ đầu.
			if !writeGGA(time.Now()) {
				return
			}
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case at := <-ticker.C:
					if !writeGGA(at) {
						return
					}
				}
			}
		}()
	}

	buffer := make([]byte, opts.ReadBuffer)
	streaming := false
	for {
		if upstream.Conn != nil {
			if err := upstream.Conn.SetReadDeadline(time.Now().Add(opts.IdleTimeout)); err != nil {
				return err
			}
		}
		n, readErr := upstream.Body.Read(buffer)
		if n > 0 {
			if !streaming {
				streaming = true
				if hooks.streaming != nil {
					hooks.streaming()
				}
			}
			if scanner != nil && !scanner.done {
				scanner.Feed(buffer[:n])
			}
			if hooks.feed != nil {
				hooks.feed(append([]byte(nil), buffer[:n]...))
			}
		}
		if readErr != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return readErr
		}
	}
}

type StationSourceManager struct {
	store        StationSourceStore
	sessionStore StationSourceSessionStore
	opts         StationSourceOptions
	feedFor      func(cfg *StationSourceConfig) func([]byte)

	mu           sync.Mutex
	rootCtx      context.Context
	sessions     map[int64]context.CancelFunc
	fingerprints map[int64]string
	wg           sync.WaitGroup
}

func NewStationSourceManager(
	store StationSourceStore,
	sessionStore StationSourceSessionStore,
	opts StationSourceOptions,
) *StationSourceManager {
	m := &StationSourceManager{
		store:        store,
		sessionStore: sessionStore,
		opts:         opts.withDefaults(),
		sessions:     make(map[int64]context.CancelFunc),
		fingerprints: make(map[int64]string),
	}
	m.feedFor = func(cfg *StationSourceConfig) func([]byte) {
		return func(data []byte) {
			if m.opts.Quality == nil {
				return
			}
			m.opts.Quality.Feed(quality.Target{
				Type:         quality.TargetStation,
				ID:           cfg.StationID,
				MountpointID: cfg.MountpointID,
				Direction:    quality.DirectionIngest,
			}, data)
		}
	}
	return m
}

func (m *StationSourceManager) Run(ctx context.Context) {
	m.mu.Lock()
	m.rootCtx = ctx
	m.mu.Unlock()

	if m.sessionStore != nil {
		if err := m.sessionStore.CloseOpen(ctx, "service_restart"); err != nil {
			log.Printf("[station-source] close stale sessions: %v", err)
		}
	}
	m.reconcile(ctx)
	ticker := time.NewTicker(m.opts.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.reconcile(ctx)
		}
	}
}

func (m *StationSourceManager) Shutdown(ctx context.Context) {
	m.mu.Lock()
	for id, cancel := range m.sessions {
		cancel()
		delete(m.sessions, id)
		delete(m.fingerprints, id)
	}
	m.mu.Unlock()
	done := make(chan struct{})
	go func() {
		m.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

func (m *StationSourceManager) reconcile(ctx context.Context) {
	loadCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	configs, err := m.store.LoadAll(loadCtx)
	if err != nil {
		log.Printf("[station-source] load config failed: %v", err)
		return
	}

	desired := make(map[int64]*StationSourceConfig, len(configs))
	for _, cfg := range configs {
		desired[cfg.StationID] = cfg
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	for id, cancelSession := range m.sessions {
		if desired[id] == nil {
			cancelSession()
			delete(m.sessions, id)
			delete(m.fingerprints, id)
		}
	}
	for id, cfg := range desired {
		fingerprint := stationSourceFingerprint(cfg)
		if m.sessions[id] != nil && m.fingerprints[id] == fingerprint {
			continue
		}
		if cancelSession := m.sessions[id]; cancelSession != nil {
			cancelSession()
			delete(m.sessions, id)
		}
		sessionCtx, cancelSession := context.WithCancel(m.rootCtx)
		m.sessions[id] = cancelSession
		m.fingerprints[id] = fingerprint
		m.wg.Add(1)
		go func(cfg *StationSourceConfig, ctx context.Context) {
			defer m.wg.Done()
			m.runSession(ctx, cfg)
		}(cfg, sessionCtx)
	}
}

// runSession giữ nguồn trạm luôn kết nối: khi phiên kết thúc thì chờ backoff rồi
// kết nối lại, cho tới khi ctx bị hủy (cấu hình đổi, trạm tắt, dịch vụ dừng).
func (m *StationSourceManager) Reconcile(ctx context.Context) {
	m.reconcile(ctx)
}

func (m *StationSourceManager) runSession(ctx context.Context, cfg *StationSourceConfig) {
	backoff := NewBackoff(m.opts.RetryMin, m.opts.RetryMax)
	var streamStart time.Time
	hooks := stationSessionHooks{
		feed: m.feedFor(cfg),
		streaming: func() {
			streamStart = time.Now()
			log.Printf("[station-source] station %d (%s) streaming", cfg.StationID, cfg.StationName)
		},
	}
	for {
		if ctx.Err() != nil {
			return
		}
		streamStart = time.Time{}
		sessionID := int64(0)
		if m.sessionStore != nil {
			id, startErr := m.sessionStore.Start(ctx, cfg.StationID)
			if startErr != nil {
				log.Printf("[station-source] station %d start session: %v", cfg.StationID, startErr)
			} else {
				sessionID = id
			}
		}
		err := RunStationSource(ctx, cfg, m.opts, hooks)
		if m.sessionStore != nil && sessionID > 0 {
			if endErr := m.sessionStore.End(
				context.Background(),
				sessionID,
				classify(err),
				messageFor(err),
			); endErr != nil {
				log.Printf("[station-source] station %d end session: %v", cfg.StationID, endErr)
			}
		}
		if ctx.Err() != nil {
			return
		}
		if !streamStart.IsZero() && time.Since(streamStart) >= stableStreamAfter {
			backoff.Reset()
		}
		log.Printf("[station-source] station %d (%s) reason=%s: %s",
			cfg.StationID, cfg.StationName, classify(err), messageFor(err))
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff.Next()):
		}
	}
}

func stationSourceFingerprint(cfg *StationSourceConfig) string {
	lat, lon := 0.0, 0.0
	if cfg.Lat != nil {
		lat = *cfg.Lat
	}
	if cfg.Lon != nil {
		lon = *cfg.Lon
	}
	e := cfg.Endpoint
	return fmt.Sprintf("%d|%d|%s|%d|%t|%s|%s|%s|%s|%t|%d|%.10f|%.10f",
		cfg.StationID, cfg.MountpointID, e.Host, e.Port, e.SSL, e.Mount, e.NtripVersion,
		e.Username, e.Password, cfg.SendGGA, cfg.NMEAIntervalSec, lat, lon)
}
