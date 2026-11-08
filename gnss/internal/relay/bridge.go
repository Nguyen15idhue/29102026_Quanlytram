package relay

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cors/gnss/internal/deviceprofile"
	"cors/gnss/internal/ntrip"
	"cors/gnss/internal/quality"
	"cors/gnss/internal/rtcm"
)

type sessionUpstream struct {
	body    io.Reader
	conn    net.Conn
	closeFn func() error
}

func (u *sessionUpstream) Read(p []byte) (int, error) {
	return u.body.Read(p)
}

func (u *sessionUpstream) Close() error {
	if u.closeFn == nil {
		return nil
	}
	return u.closeFn()
}

// relayBufferSize là kích thước buffer tái sử dụng giữa các phiên relay.
// Sample gửi sang monitor/quality luôn được copy trước khi trả buffer về pool.
const relayBufferSize = 32 * 1024

var relayBufferPool = sync.Pool{
	New: func() any {
		buffer := make([]byte, relayBufferSize)
		return &buffer
	},
}

type Options struct {
	DialTimeout      time.Duration
	IdleTimeout      time.Duration
	MonitorBuffer    int
	ReadBuffer       int
	DownstreamBuffer int
	NMEAInterval     time.Duration
	RetryMin         time.Duration
	RetryMax         time.Duration
	PollInterval     time.Duration
	StopTimeout      time.Duration
	OnFirstByte      func()
	Quality          *quality.Analyzer
	// StationTap mở luồng đọc trực tiếp source của mountpoint nội bộ cho relay
	// chọn trạm nguồn; nil nghĩa là luôn dùng NTRIP.
	StationTap func(mountpointID int64) (io.ReadCloser, error)
	// StationSourceTap mở luồng đọc trực tiếp source của trạm (theo stationID)
	// cho relay chọn trạm nguồn. Ưu tiên hơn StationTap khi được cấu hình.
	StationSourceTap func(stationID int64) (io.ReadCloser, error)
}

func DefaultOptions() Options {
	return Options{
		DialTimeout:      15 * time.Second,
		IdleTimeout:      60 * time.Second,
		MonitorBuffer:    32,
		ReadBuffer:       8 * 1024,
		DownstreamBuffer: 64,
		NMEAInterval:     10 * time.Second,
		RetryMin:         5 * time.Second,
		RetryMax:         60 * time.Second,
		PollInterval:     10 * time.Second,
		StopTimeout:      15 * time.Second,
	}
}

func (o Options) withDefaults() Options {
	defaults := DefaultOptions()
	if o.DialTimeout <= 0 {
		o.DialTimeout = defaults.DialTimeout
	}
	if o.IdleTimeout <= 0 {
		o.IdleTimeout = defaults.IdleTimeout
	}
	if o.MonitorBuffer <= 0 {
		o.MonitorBuffer = defaults.MonitorBuffer
	}
	if o.ReadBuffer <= 0 {
		o.ReadBuffer = defaults.ReadBuffer
	}
	if o.DownstreamBuffer <= 0 {
		o.DownstreamBuffer = defaults.DownstreamBuffer
	}
	if o.NMEAInterval <= 0 {
		o.NMEAInterval = defaults.NMEAInterval
	}
	if o.RetryMin <= 0 {
		o.RetryMin = defaults.RetryMin
	}
	if o.RetryMax <= 0 {
		o.RetryMax = defaults.RetryMax
	}
	if o.RetryMax < o.RetryMin {
		o.RetryMax = o.RetryMin
	}
	if o.PollInterval <= 0 {
		o.PollInterval = defaults.PollInterval
	}
	if o.StopTimeout <= 0 {
		o.StopTimeout = defaults.StopTimeout
	}
	return o
}

func toNtripEndpoint(endpoint EndpointConfig, userAgent string, profile deviceprofile.Profile) ntrip.Endpoint {
	version := endpoint.NtripVersion
	if version == "" {
		version = profile.NtripVersion
	}
	if version == "" {
		version = "v2"
	}
	httpVersion := endpoint.HTTPVersion
	if httpVersion == "" && profile.HTTPVersion != "" &&
		(endpoint.NtripVersion == "" || strings.EqualFold(endpoint.NtripVersion, profile.NtripVersion)) {
		httpVersion = profile.HTTPVersion
	}
	connection := endpoint.Connection
	if connection == "" {
		connection = profile.Connection
	}
	return ntrip.Endpoint{
		Host:        endpoint.Host,
		Port:        endpoint.Port,
		Mount:       endpoint.Mount,
		SSL:         endpoint.SSL,
		Version:     version,
		HTTPVersion: httpVersion,
		Connection:  connection,
		Username:    endpoint.Username,
		Password:    endpoint.Password,
		ProxyURL:    endpoint.ProxyURL,
		UserAgent:   userAgent,
	}
}

func RunSession(
	ctx context.Context,
	cfg *JobConfig,
	opts Options,
	monitor *rtcm.Monitor,
	metrics *Metrics,
) error {
	opts = opts.withDefaults()
	userAgent := resolveUserAgent(cfg, deviceprofile.RoleRelay, cfg.ID)

	var upstream *sessionUpstream
	if cfg.UpstreamDirect {
		switch {
		case opts.StationSourceTap != nil && cfg.UpstreamStationID > 0:
			tap, err := opts.StationSourceTap(cfg.UpstreamStationID)
			if err != nil {
				return err
			}
			upstream = &sessionUpstream{body: tap, closeFn: tap.Close}
		case opts.StationTap != nil && cfg.UpstreamMountpointID > 0:
			tap, err := opts.StationTap(cfg.UpstreamMountpointID)
			if err != nil {
				return err
			}
			upstream = &sessionUpstream{body: tap, closeFn: tap.Close}
		default:
			return fmt.Errorf("station source tap is not configured")
		}
	} else {
		ntripUpstream, err := ntrip.Get(ctx, toNtripEndpoint(cfg.Upstream, userAgent, cfg.DeviceProfile), opts.DialTimeout)
		if err != nil {
			return err
		}
		upstream = &sessionUpstream{
			body:    ntripUpstream.Body,
			conn:    ntripUpstream.Conn,
			closeFn: ntripUpstream.Close,
		}
	}
	defer upstream.Close()

	// GGA mở hàng phải gửi trước khi mở downstream. Caster VRS chỉ bắt đầu
	// trả dòng RTCM sau khi biết vị trí rover. Relay đọc trực tiếp source nội bộ
	// không có kết nối upstream để gửi GGA.
	var lastData atomic.Int64
	var sender *nmeaSender
	if upstream.conn != nil && cfg.Lat != nil && cfg.Lon != nil {
		profile := cfg.DeviceProfile
		if profile.IsZero() {
			profile = deviceprofile.Default()
		}
		interval := time.Duration(profile.NMEAInterval(cfg.NMEAIntervalSec)) * time.Second
		// Motion chỉ dành cho relay job và mặc định TẮT (D19-23); profile phải
		// khai báo 'rover' mới có hiệu lực.
		motionEnabled := cfg.MotionEnabled && profile.Motion == deviceprofile.MotionRover
		sender = newNMEASender(nmeaSenderConfig{
			JobID:         cfg.ID,
			Lat:           *cfg.Lat,
			Lon:           *cfg.Lon,
			Interval:      interval,
			Profile:       profile,
			MotionEnabled: motionEnabled,
		})
		if err := sender.sendInitial(upstream.conn); err != nil {
			return fmt.Errorf("nmea initial: %w", err)
		}
	}

	downstream, err := ntrip.Source(
		ctx,
		toNtripEndpoint(cfg.Downstream, userAgent, cfg.DeviceProfile),
		cfg.DownstreamMode,
		opts.DialTimeout,
	)
	if err != nil {
		return err
	}
	defer downstream.Close()

	go func() {
		<-ctx.Done()
		upstream.Close()
		downstream.Close()
	}()

	monitorCh := make(chan []byte, opts.MonitorBuffer)
	monitorDone := make(chan struct{})
	go func() {
		defer close(monitorDone)
		for data := range monitorCh {
			monitor.Feed(data)
		}
	}()
	defer func() {
		close(monitorCh)
		<-monitorDone
	}()

	nmeaCtx, stopNMEA := context.WithCancel(ctx)
	defer stopNMEA()
	nmeaErr := make(chan error, 1)
	if sender != nil {
		go sender.run(nmeaCtx, upstream.conn, &lastData, nmeaErr)
	}

	writeCh := make(chan []byte, opts.DownstreamBuffer)
	writerErr := make(chan error, 1)
	writerDone := make(chan struct{})

	// Downstream read probe: caster đích đóng kết nối (hoặc trả body lỗi) thì
	// kết thúc phiên ngay, không tiếp tục đẩy byte vào socket đã chết.
	go func() {
		if downstream.Conn == nil {
			return
		}
		probe := make([]byte, 512)
		for {
			if _, err := downstream.Conn.Read(probe); err != nil {
				if ctx.Err() == nil {
					select {
					case writerErr <- fmt.Errorf("downstream closed: %w", err):
					default:
					}
				}
				return
			}
		}
	}()

	go func() {
		defer close(writerDone)
		for data := range writeCh {
			if downstream.Conn != nil {
				_ = downstream.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			}
			_, writeErr := downstream.Write(data)
			if downstream.Conn != nil {
				_ = downstream.Conn.SetWriteDeadline(time.Time{})
			}
			if writeErr != nil {
				select {
				case writerErr <- writeErr:
				default:
				}
				return
			}
			metrics.AddDown(len(data))
			if opts.Quality != nil {
				opts.Quality.Feed(quality.Target{
					Type:      quality.TargetRelayJob,
					ID:        cfg.ID,
					Direction: quality.DirectionDownstream,
				}, data)
			}
		}
	}()
	defer func() {
		close(writeCh)
		<-writerDone
	}()

	var firstBytes sync.Once
	for {
		select {
		case err := <-writerErr:
			return err
		case err := <-nmeaErr:
			return err
		default:
		}
		if upstream.conn != nil {
			_ = upstream.conn.SetReadDeadline(time.Now().Add(opts.IdleTimeout))
		}
		pooled := relayBufferPool.Get().(*[]byte)
		buffer := *pooled
		if opts.ReadBuffer > 0 && opts.ReadBuffer < len(buffer) {
			buffer = buffer[:opts.ReadBuffer]
		}
		n, readErr := func() (int, error) {
			defer relayBufferPool.Put(pooled)
			return upstream.Read(buffer)
		}()
		if n > 0 {
			lastData.Store(time.Now().UnixNano())
			metrics.AddUp(n)
			if opts.OnFirstByte != nil {
				firstBytes.Do(opts.OnFirstByte)
			}
			sample := append([]byte(nil), buffer[:n]...)
			if opts.Quality != nil {
				opts.Quality.Feed(quality.Target{
					Type:      quality.TargetRelayJob,
					ID:        cfg.ID,
					Direction: quality.DirectionUpstream,
				}, sample)
			}
			select {
			case writeCh <- sample:
			default:
				downstream.Close()
				return fmt.Errorf("downstream backlog")
			}
			select {
			case monitorCh <- sample:
			default:
				metrics.AddMonitorDrop()
			}
		}
		if readErr != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if errors.Is(readErr, io.EOF) {
				return io.EOF
			}
			return readErr
		}
	}
}
