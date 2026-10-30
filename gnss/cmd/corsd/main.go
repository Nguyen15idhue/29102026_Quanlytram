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
	if cfg.AppEncKey == "" {
		log.Printf("warning: APP_ENC_KEY is empty; relay credentials cannot be decrypted")
	}
	if cfg.InternalHMACSecret == "" {
		log.Printf("warning: INTERNAL_HMAC_SECRET is empty; internal API calls will be rejected")
	}

	store := relay.NewMySQLStore(adminDB, cfg.AppEncKey)
	writer := relay.NewBufferedWriter(runtimeDB, cfg.QueueSize, cfg.BatchSize, cfg.FlushInterval)

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

	retentionOptions := relay.RetentionOptions{
		SessionDays: cfg.SessionRetentionDays,
		EventDays:   cfg.EventRetentionDays,
		HourlyDays:  cfg.HourlyRetentionDays,
		Batch:       cfg.PruneBatch,
		Interval:    cfg.PruneInterval,
	}

	runCtx, runCancel := context.WithCancel(context.Background())
	go writer.Run(runCtx)
	go qualityAsync.Run(runCtx)
	go analyzer.Run(runCtx)
	go manager.Run(runCtx)
	go casterManager.Run(runCtx)
	go probeManager.Run(runCtx)
	go relay.RunRetention(runCtx, runtimeDB, retentionOptions)
	go runQualityRetention(runCtx, qualityStore, cfg)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.New(runtimeDB, cfg.AdminDB, manager, casterManager, analyzer, cfg.InternalHMACSecret).Handler(),
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
	casterManager.Shutdown(shutdownCtx)
	probeManager.Shutdown(shutdownCtx)
	analyzer.Flush()
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

func runQualityRetention(ctx context.Context, store *quality.MySQLStore, cfg config.Config) {
	prune := func() {
		pruneCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		sampleBefore := time.Now().UTC().AddDate(0, 0, -cfg.QualitySampleDays)
		alertBefore := time.Now().UTC().AddDate(0, 0, -cfg.QualityAlertDays)
		if err := store.Prune(pruneCtx, sampleBefore, alertBefore, cfg.QualityPruneBatch); err != nil {
			log.Printf("[quality] prune failed: %v", err)
		}
	}
	prune()
	ticker := time.NewTicker(cfg.QualityPruneInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			prune()
		}
	}
}
