package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/go-sql-driver/mysql"

	"cors/gnss/internal/config"
)

func Open(ctx context.Context, cfg config.Config) (*sql.DB, error) {
	mysqlConfig := mysql.Config{
		User:                 cfg.DBUser,
		Passwd:               cfg.DBPassword,
		Net:                  "tcp",
		Addr:                 fmt.Sprintf("%s:%s", cfg.DBHost, cfg.DBPort),
		DBName:               cfg.RuntimeDB,
		ParseTime:            true,
		Loc:                  time.UTC,
		AllowNativePasswords: true,
		Params: map[string]string{
			"charset": "utf8mb4",
		},
	}
	dsn := mysqlConfig.FormatDSN()

	database, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(5)
	database.SetMaxIdleConns(2)
	database.SetConnMaxLifetime(30 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := database.PingContext(pingCtx); err != nil {
		database.Close()
		return nil, fmt.Errorf("ping mysql: %w", err)
	}
	return database, nil
}

func SchemaVersion(ctx context.Context, database *sql.DB, adminDB string) (int, error) {
	query := fmt.Sprintf("SELECT COALESCE(MAX(version), 0) FROM `%s`.schema_migrations WHERE scope = 'runtime'", adminDB)
	var version int
	if err := database.QueryRowContext(ctx, query).Scan(&version); err != nil {
		return 0, err
	}
	return version, nil
}
