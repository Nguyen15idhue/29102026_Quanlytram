package relay

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"cors/gnss/internal/nmea"
	"cors/gnss/internal/ntrip"
	"cors/gnss/internal/quality"
	"cors/gnss/internal/rtcm"
)

type Options struct {
	DialTimeout      time.Duration
	MonitorBuffer    int
	ReadBuffer       int
	DownstreamBuffer int
	NMEAInterval     time.Duration
	RetryMin         time.Duration
	RetryMax         time.Duration
	PollInterval     time.Duration
	OnFirstByte      func()
	Quality          *quality.Analyzer
}

func DefaultOptions() Options {
	return Options{
		DialTimeout:      15 * time.Second,
		MonitorBuffer:    256,
		ReadBuffer:       32 * 1024,
		DownstreamBuffer: 256,
		NMEAInterval:     10 * time.Second,
		RetryMin:         time.Second,
		RetryMax:         30 * time.Second,
		PollInterval:     10 * time.Second,
	}
}

func (o Options) withDefaults() Options {
	defaults := DefaultOptions()
	if o.DialTimeout <= 0 {
		o.DialTimeout = defaults.DialTimeout
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
	return o
}

func toNtripEndpoint(endpoint EndpointConfig, prefix string) ntrip.Endpoint {
	version := endpoint.NtripVersion
	if version == "" {
		version = "v2"
	}
	return ntrip.Endpoint{
		Host:      endpoint.Host,
		Port:      endpoint.Port,
		Mount:     endpoint.Mount,
		SSL:       endpoint.SSL,
		Version:   version,
		Username:  endpoint.Username,
		Password:  endpoint.Password,
		ProxyURL:  endpoint.ProxyURL,
		UserAgent: prefix,
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
	userAgent := cfg.UAPrefix
	if userAgent == "" {
		userAgent = "CORS-MVP"
	}
	userAgent += "-relay"

	upstream, err := ntrip.Get(ctx, toNtripEndpoint(cfg.Upstream, userAgent), opts.DialTimeout)
	if err != nil {
		return err
	}
	defer upstream.Close()

	downstream, err := ntrip.Source(
		ctx,
		toNtripEndpoint(cfg.Downstream, userAgent),
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
	if cfg.Lat != nil && cfg.Lon != nil {
		interval := opts.NMEAInterval
		if cfg.NMEAIntervalSec > 0 {
			interval = time.Duration(cfg.NMEAIntervalSec) * time.Second
		}
		go func() {
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-nmeaCtx.Done():
					return
				case at := <-ticker.C:
					if err := upstream.Conn.SetWriteDeadline(time.Now().Add(2 * time.Second)); err != nil {
						return
					}
					_, writeErr := upstream.Conn.Write(nmea.Join(*cfg.Lat, *cfg.Lon, at))
					_ = upstream.Conn.SetWriteDeadline(time.Time{})
					if writeErr != nil {
						return
					}
				}
			}
		}()
	}

	writeCh := make(chan []byte, opts.DownstreamBuffer)
	writerErr := make(chan error, 1)
	writerDone := make(chan struct{})
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

	buffer := make([]byte, opts.ReadBuffer)
	var firstBytes sync.Once
	for {
		select {
		case err := <-writerErr:
			return err
		default:
		}
		n, readErr := upstream.Body.Read(buffer)
		if n > 0 {
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
