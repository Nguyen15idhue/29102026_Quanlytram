package config

import "os"

type Config struct {
	Port       string
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	RuntimeDB  string
	AdminDB    string
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
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
	}
}
