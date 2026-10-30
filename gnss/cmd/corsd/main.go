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
	if version < 3 {
		log.Fatalf("runtime schema version %d is not compatible (need >= 3)", version)
	}
	if cfg.AppEncKey == "" {
		log.Printf("warning: APP_ENC_KEY is empty; relay credentials cannot be decrypted")
	}
	if cfg.InternalHMACSecret == "" {
		log.Printf("warning: INTERNAL_HMAC_SECRET is empty; internal API calls will be rejected")
	}

	store := relay.NewMySQLStore(adminDB, cfg.AppEncKey)
	writer := relay.NewBufferedWriter(runtimeDB, cfg.QueueSize, cfg.BatchSize, cfg.FlushInterval)

	options := relay.DefaultOptions()
	options.DialTimeout = cfg.DialTimeout
	options.PollInterval = cfg.PollInterval
	options.RetryMin = time.Second
	options.RetryMax = 30 * time.Second

	manager := relay.NewManager(store, writer, options)

	casterOptions := caster.DefaultOptions()
	casterOptions.BindAddr = cfg.CasterBindAddr
	casterOptions.PollInterval = cfg.CasterPollInterval
	casterOptions.HeaderTimeout = cfg.CasterHeaderTimeout
	casterOptions.WriteTimeout = cfg.CasterWriteTimeout
	casterOptions.QueueSize = cfg.CasterQueueSize
	casterOptions.ReadBuffer = cfg.CasterReadBuffer
	casterOptions.MaxHeader = cfg.CasterMaxHeaderBytes
	casterManager := caster.NewManager(
		caster.NewMySQLStore(adminDB),
		caster.NewMySQLRuntimeStore(runtimeDB),
		casterOptions,
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
	go manager.Run(runCtx)
	go casterManager.Run(runCtx)
	go relay.RunRetention(runCtx, runtimeDB, retentionOptions)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.New(runtimeDB, cfg.AdminDB, manager, casterManager, cfg.InternalHMACSecret).Handler(),
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
	runCancel()

	select {
	case <-writer.Done():
	case <-shutdownCtx.Done():
		log.Printf("runtime writer did not flush before shutdown timeout")
	}
}
