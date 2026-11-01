package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port       string
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	RuntimeDB  string
	AdminDB    string

	AppEncKey          string
	InternalHMACSecret string

	PollInterval    time.Duration
	FlushInterval   time.Duration
	QueueSize       int
	BatchSize       int
	DialTimeout     time.Duration
	ShutdownTimeout time.Duration

	CasterBindAddr       string
	CasterPollInterval   time.Duration
	CasterHeaderTimeout  time.Duration
	CasterWriteTimeout   time.Duration
	CasterQueueSize      int
	CasterReadBuffer     int
	CasterMaxHeaderBytes int

	ProbePollInterval time.Duration
	ProbeReadBuffer   int
	ProbeNMEAInterval time.Duration

	QualityQueueSize       int
	QualitySampleInterval  time.Duration
	QualityStatsInterval   time.Duration
	QualityEvalInterval    time.Duration
	QualityAlertWindows    int
	QualityGapThreshold    time.Duration
	QualityStaleAfter      time.Duration
	QualityScoreInterval   time.Duration
	QualityBaselineWindow  int
	QualitySampleWindowSec int
	QualityStoreQueueSize  int
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func getenvSeconds(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return time.Duration(value) * time.Second
}

func Load() Config {
	return Config{
		Port:       getenv("GO_PORT", "7080"),
		DBHost:     getenv("MYSQL_HOST", "127.0.0.1"),
		DBPort:     getenv("MYSQL_PORT", "3306"),
		DBUser:     getenv("MYSQL_RELAY_USER", "cors_relay"),
		DBPassword: getenv("MYSQL_RELAY_PASSWORD", ""),
		RuntimeDB:  getenv("MYSQL_RUNTIME_DATABASE", "cors_runtime"),
		AdminDB:    getenv("MYSQL_ADMIN_DATABASE", "cors_admin"),

		AppEncKey:          os.Getenv("APP_ENC_KEY"),
		InternalHMACSecret: os.Getenv("INTERNAL_HMAC_SECRET"),

		PollInterval:    getenvSeconds("RELAY_POLL_INTERVAL_SEC", 10*time.Second),
		FlushInterval:   getenvSeconds("RELAY_FLUSH_INTERVAL_SEC", time.Second),
		QueueSize:       getenvInt("RELAY_QUEUE_SIZE", 10000),
		BatchSize:       getenvInt("RELAY_BATCH_SIZE", 100),
		DialTimeout:     getenvSeconds("RELAY_DIAL_TIMEOUT_SEC", 15*time.Second),
		ShutdownTimeout: getenvSeconds("RELAY_SHUTDOWN_TIMEOUT_SEC", 10*time.Second),

		CasterBindAddr:       getenv("CASTER_BIND_ADDR", "0.0.0.0"),
		CasterPollInterval:   getenvSeconds("CASTER_POLL_INTERVAL_SEC", 10*time.Second),
		CasterHeaderTimeout:  getenvSeconds("CASTER_HEADER_TIMEOUT_SEC", 10*time.Second),
		CasterWriteTimeout:   getenvSeconds("CASTER_WRITE_TIMEOUT_SEC", 10*time.Second),
		CasterQueueSize:      getenvInt("CASTER_QUEUE_SIZE", 64),
		CasterReadBuffer:     getenvInt("CASTER_READ_BUFFER", 32*1024),
		CasterMaxHeaderBytes: getenvInt("CASTER_MAX_HEADER_BYTES", 16*1024),

		ProbePollInterval: getenvSeconds("PROBE_POLL_INTERVAL_SEC", 10*time.Second),
		ProbeReadBuffer:   getenvInt("PROBE_READ_BUFFER", 32*1024),
		ProbeNMEAInterval: getenvSeconds("PROBE_NMEA_INTERVAL_SEC", 10*time.Second),

		QualityQueueSize:       getenvInt("QUALITY_QUEUE_SIZE", 2048),
		QualitySampleInterval:  getenvSeconds("QUALITY_SAMPLE_INTERVAL_SEC", 60*time.Second),
		QualityStatsInterval:   getenvSeconds("QUALITY_STATS_INTERVAL_SEC", 10*time.Second),
		QualityEvalInterval:    getenvSeconds("QUALITY_EVAL_INTERVAL_SEC", 5*time.Second),
		QualityAlertWindows:    getenvInt("QUALITY_ALERT_WINDOWS", 3),
		QualityGapThreshold:    time.Duration(getenvInt("QUALITY_GAP_MS", 2000)) * time.Millisecond,
		QualityStaleAfter:      getenvSeconds("QUALITY_STALE_AFTER_SEC", 5*time.Second),
		QualityScoreInterval:   getenvSeconds("QUALITY_SCORE_INTERVAL_SEC", 5*time.Second),
		QualityBaselineWindow:  getenvInt("QUALITY_BASELINE_WINDOW", 120),
		QualitySampleWindowSec: getenvInt("QUALITY_SAMPLE_WINDOW_SEC", 60),
		QualityStoreQueueSize:  getenvInt("QUALITY_STORE_QUEUE_SIZE", 4096),
	}
}
