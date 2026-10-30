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

	SessionRetentionDays int
	EventRetentionDays   int
	HourlyRetentionDays  int
	PruneBatch           int
	PruneInterval        time.Duration
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

		SessionRetentionDays: getenvInt("RELAY_SESSION_RETENTION_DAYS", 90),
		EventRetentionDays:   getenvInt("RELAY_EVENT_RETENTION_DAYS", 30),
		HourlyRetentionDays:  getenvInt("RELAY_HOURLY_RETENTION_DAYS", 90),
		PruneBatch:           getenvInt("RELAY_PRUNE_BATCH", 1000),
		PruneInterval:        getenvSeconds("RELAY_PRUNE_INTERVAL_SEC", time.Hour),
	}
}
