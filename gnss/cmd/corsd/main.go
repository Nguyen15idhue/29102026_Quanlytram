package main

import (
	"context"
	"log"
	"net/http"
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
	ctx := context.Background()

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
	serviceRuns := lifecycle.New(runtimeDB, "go", lifecycle.DefaultInterval)

	qualityStore := quality.NewMySQLStore(runtimeDB)
	qualityAsync := quality.NewAsyncStore(qualityStore, cfg.QualityStoreQueueSize)
	analyzer := quality.NewAnalyzer(quality.Options{
		QueueSize:       cfg.QualityQueueSize,
		SampleInterval:  cfg.QualitySampleInterval,
		StatsInterval:   cfg.QualityStatsInterval,
		EvalInterval:    cfg.QualityEvalInterval,
		AlertWindows:    cfg.QualityAlertWindows,
		GapThreshold:    cfg.QualityGapThreshold,
		StaleAfter:      cfg.QualityStaleAfter,
		ScoreInterval:   cfg.QualityScoreInterval,
		BaselineWindow:  cfg.QualityBaselineWindow,
		SampleWindowSec: cfg.QualitySampleWindowSec,
	}, qualityAsync)

	options := relay.DefaultOptions()
	options.DialTimeout = cfg.DialTimeout
	options.PollInterval = cfg.PollInterval
	options.RetryMin = time.Second
	options.RetryMax = 30 * time.Second
	options.Quality = analyzer

	manager := relay.NewManager(store, writer, options)
	stationSourceManager := relay.NewStationSourceManager(
		relay.NewStationSourceStore(adminDB, cfg.AppEncKey),
		relay.NewStationSourceSessionStore(runtimeDB),
		relay.StationSourceOptions{Options: options},
	)

	casterOptions := caster.DefaultOptions()
	casterOptions.BindAddr = cfg.CasterBindAddr
	casterOptions.PollInterval = cfg.CasterPollInterval
	casterOptions.HeaderTimeout = cfg.CasterHeaderTimeout
	casterOptions.WriteTimeout = cfg.CasterWriteTimeout
	casterOptions.QueueSize = cfg.CasterQueueSize
	casterOptions.ReadBuffer = cfg.CasterReadBuffer
	casterOptions.MaxHeader = cfg.CasterMaxHeaderBytes
	casterOptions.Quality = analyzer
	casterManager := caster.NewManager(
		caster.NewMySQLStore(adminDB),
		caster.NewMySQLRuntimeStore(runtimeDB),
		casterOptions,
	)

	probeOptions := probe.DefaultOptions()
	probeOptions.PollInterval = cfg.ProbePollInterval
	probeOptions.DialTimeout = cfg.DialTimeout
	probeOptions.ReadBuffer = cfg.ProbeReadBuffer
	probeOptions.NMEAInterval = cfg.ProbeNMEAInterval
	probeOptions.Quality = analyzer
	probeManager := probe.NewManager(
		probe.NewMySQLStore(adminDB, cfg.AppEncKey),
		probeOptions,
	)

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
