package main

import (
	"context"
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cors/gnss/internal/api"
	"cors/gnss/internal/caster"
	"cors/gnss/internal/config"
	"cors/gnss/internal/db"
	"cors/gnss/internal/lifecycle"
	"cors/gnss/internal/maintenance"
	"cors/gnss/internal/probe"
	"cors/gnss/internal/quality"
	"cors/gnss/internal/relay"
)

func main() {
	cfg := config.Load()
	allowedPorts, err := caster.ParsePortSpec(cfg.CasterPublicPorts)
	if err != nil {
		log.Fatalf("invalid CASTER_PUBLIC_PORTS: %v", err)
	}
	ctx := context.Background()
	// Plan 20 (D20-11): pprof chỉ bật khi PPROF_ADDR được đặt (loopback),
	// phục vụ đo CPU/heap trên staging mà không mở thêm cổng công khai.
	if cfg.PprofAddr != "" {
		go func() {
			log.Printf("[pprof] listening on %s", cfg.PprofAddr)
			if err := http.ListenAndServe(cfg.PprofAddr, nil); err != nil {
				log.Printf("[pprof] stopped: %v", err)
			}
		}()
	}

	runtimeDB, err := db.Open(ctx, cfg)
	if err != nil {
		log.Fatalf("open runtime database: %v", err)
	}
	defer runtimeDB.Close()

	adminDB, err := db.OpenAdmin(ctx, cfg)
	if err != nil {
		log.Fatalf("open admin database: %v", err)
	}
	defer adminDB.Close()

	version, err := db.SchemaVersion(ctx, runtimeDB, cfg.AdminDB)
	if err != nil {
		log.Fatalf("check schema: %v", err)
	}
	if version < 4 {
		log.Fatalf("runtime schema version %d is not compatible (need >= 4)", version)
	}
	adminVersion, err := db.AdminSchemaVersion(ctx, adminDB)
	if err != nil {
		log.Fatalf("check admin schema: %v", err)
	}
	if adminVersion < maintenance.MinAdminSchemaVersion {
		log.Fatalf(
			"admin schema version %d is not compatible (need >= %d)",
			adminVersion,
			maintenance.MinAdminSchemaVersion,
		)
	}
	maintenanceRunner, err := maintenance.NewRunner(ctx, adminDB, runtimeDB)
	if err != nil {
		log.Fatalf("load maintenance config: %v", err)
	}
	if cfg.AppEncKey == "" {
		log.Printf("warning: APP_ENC_KEY is empty; relay credentials cannot be decrypted")
	}
	if cfg.InternalHMACSecret == "" {
		log.Printf("warning: INTERNAL_HMAC_SECRET is empty; internal API calls will be rejected")
	}

	store := relay.NewMySQLStore(adminDB, cfg.AppEncKey)
	writer := relay.NewBufferedWriter(runtimeDB, cfg.QueueSize, cfg.BatchSize, cfg.FlushInterval)
	if closed, err := relay.CloseStaleSessions(ctx, runtimeDB); err != nil {
		log.Printf("[relay] close stale sessions failed: %v", err)
	} else if closed > 0 {
		log.Printf("[relay] closed %d stale sessions from previous run", closed)
	}
	serviceRuns := lifecycle.New(runtimeDB, "go", lifecycle.DefaultInterval)

	qualityStore := quality.NewMySQLStore(runtimeDB)
	// D20-8: Go mất state alert sau restart; đóng alert cũ để alert còn đúng
	// được analyzer tạo lại, alert không còn đúng không tồn tại mãi.
	if resolved, err := qualityStore.ResolveAllOpen(ctx); err != nil {
		log.Printf("[quality] resolve stale alerts failed: %v", err)
	} else if resolved > 0 {
		log.Printf("[quality] resolved %d stale alerts from previous run", resolved)
	}
	qualityAsync := quality.NewAsyncStore(qualityStore, cfg.QualityStoreQueueSize)
	analyzer := quality.NewAnalyzer(quality.Options{
		QueueSize:       cfg.QualityQueueSize,
		QueueBytes:      cfg.QualityQueueBytes,
		TargetTTL:       cfg.QualityTargetTTL,
		SampleInterval:  cfg.QualitySampleInterval,
		StatsInterval:   cfg.QualityStatsInterval,
		EvalInterval:    cfg.QualityEvalInterval,
		AlertWindows:    cfg.QualityAlertWindows,
		GapThreshold:    cfg.QualityGapThreshold,
		StaleAfter:      cfg.QualityStaleAfter,
		ScoreInterval:   cfg.QualityScoreInterval,
		BaselineWindow:  cfg.QualityBaselineWindow,
		SampleWindowSec: cfg.QualitySampleWindowSec,
		DetailInterval:  cfg.QualityDetailInterval,
	}, qualityAsync)

	options := relay.DefaultOptions()
	options.DialTimeout = cfg.DialTimeout
	options.IdleTimeout = cfg.RelayIdleTimeout
	options.PollInterval = cfg.PollInterval
	options.RetryMin = time.Second
	options.RetryMax = 30 * time.Second
	options.Quality = analyzer

	casterOptions := caster.DefaultOptions()
	casterOptions.BindAddr = cfg.CasterBindAddr
	casterOptions.PollInterval = cfg.CasterPollInterval
	casterOptions.HeaderTimeout = cfg.CasterHeaderTimeout
	casterOptions.WriteTimeout = cfg.CasterWriteTimeout
	casterOptions.SourceIdleTimeout = cfg.CasterSourceIdleTimeout
	casterOptions.RoverIdleTimeout = cfg.CasterRoverIdleTimeout
	casterOptions.TLSCert = cfg.CasterTLSCert
	casterOptions.TLSKey = cfg.CasterTLSKey
	casterOptions.SourceGrace = cfg.CasterSourceGrace
	casterOptions.QueueSize = cfg.CasterQueueSize
	casterOptions.ReadBuffer = cfg.CasterReadBuffer
	casterOptions.MaxHeader = cfg.CasterMaxHeaderBytes
	casterOptions.MaxConnections = cfg.CasterMaxConnections
	casterOptions.MaxConnectionsPerIP = cfg.CasterMaxConnectionsPerIP
	casterOptions.AllowedPorts = allowedPorts
	casterOptions.Quality = analyzer
	casterStore := caster.NewMySQLStore(adminDB)
	casterRuntimeStore := caster.NewMySQLRuntimeStore(runtimeDB)
	// D20-8: đóng kết nối caster mở từ lần chạy trước để không đếm trùng
	// "online" và không làm nặng query open-set sau mỗi lần restart.
	// Dùng runtime store vì bảng nằm trong cors_runtime.
	if closed, err := casterRuntimeStore.CloseOpenConnections(ctx, "service_restart"); err != nil {
		log.Printf("[caster] close stale connections failed: %v", err)
	} else if closed > 0 {
		log.Printf("[caster] closed %d stale connections from previous run", closed)
	}
	casterManager := caster.NewManager(
		casterStore,
		casterRuntimeStore,
		casterOptions,
	)
	options.StationTap = casterManager.OpenStationTap
	stationSourceManager := relay.NewStationSourceManager(
		relay.NewStationSourceStore(adminDB, cfg.AppEncKey),
		relay.NewStationSourceSessionStore(runtimeDB),
		relay.StationSourceOptions{
			Options:     options,
			IdleTimeout: cfg.StationSourceIdleTimeout,
			Publish:     casterManager.PublishStationSource,
			SessionEnd:  casterManager.DetachStationSource,
		},
	)
	options.StationSourceTap = stationSourceManager.OpenTap
	manager := relay.NewManager(store, writer, options)

	probeStore := probe.NewMySQLStore(adminDB, cfg.AppEncKey)
	probeOptions := probe.DefaultOptions()
	probeOptions.PollInterval = cfg.ProbePollInterval
	probeOptions.DialTimeout = cfg.DialTimeout
	probeOptions.IdleTimeout = cfg.ProbeIdleTimeout
	probeOptions.ReadBuffer = cfg.ProbeReadBuffer
	probeOptions.NMEAInterval = cfg.ProbeNMEAInterval
	probeOptions.Quality = analyzer
	probeOptions.Profile = probeStore.LoadDeviceProfile(ctx)
	probeManager := probe.NewManager(probeStore, probeOptions)

	runCtx, runCancel := context.WithCancel(context.Background())
	go writer.Run(runCtx)
	go qualityAsync.Run(runCtx)
	go analyzer.Run(runCtx)
	go manager.Run(runCtx)
	go stationSourceManager.Run(runCtx)
	go casterManager.Run(runCtx)
	go probeManager.Run(runCtx)
	go maintenanceRunner.Run(runCtx)
	go serviceRuns.Run(runCtx)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.New(runtimeDB, cfg.AdminDB, manager, casterManager, analyzer, probeManager, stationSourceManager, maintenanceRunner, cfg.InternalHMACSecret).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}

	go func() {
		log.Printf("gnss service listening on :%s (runtime schema v%d)", cfg.Port, version)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown: %v", err)
	}
	manager.Shutdown(shutdownCtx)
	stationSourceManager.Shutdown(shutdownCtx)
	casterManager.Shutdown(shutdownCtx)
	probeManager.Shutdown(shutdownCtx)
	analyzer.Flush()
	if err := serviceRuns.Stop(shutdownCtx, "service_stop"); err != nil {
		log.Printf("service lifecycle stop: %v", err)
	}
	runCancel()

	select {
	case <-writer.Done():
	case <-shutdownCtx.Done():
		log.Printf("runtime writer did not flush before shutdown timeout")
	}
	select {
	case <-qualityAsync.Done():
	case <-shutdownCtx.Done():
		log.Printf("quality writer did not flush before shutdown timeout")
	}
}
