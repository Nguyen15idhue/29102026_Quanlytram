package probe

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"cors/gnss/internal/secret"
)

type Config struct {
	ID           int64
	StationID    int64
	MountpointID int64
	StationRef   string
	Host         string
	Port         int
	Mount        string
	Username     string
	Password     string
	Interval     time.Duration
	Lat          *float64
	Lon          *float64
}

type Store interface {
	LoadAll(ctx context.Context) ([]*Config, error)
}

type MySQLStore struct {
	db     *sql.DB
	encKey string
}

func NewMySQLStore(db *sql.DB, encKey string) *MySQLStore {
	return &MySQLStore{db: db, encKey: encKey}
}

const query = `
SELECT p.id, p.station_id, COALESCE(p.mountpoint_id, 0),
       CAST(s.id AS CHAR), s.host, s.port, COALESCE(m.name, ''),
       COALESCE(rc.username, ''), COALESCE(rc.password_enc, ''),
       p.probe_interval_sec, s.lat, s.lon
  FROM station_probes p
  JOIN stations s ON s.id = p.station_id
  LEFT JOIN mountpoints m ON m.id = p.mountpoint_id
  LEFT JOIN relay_credentials rc ON rc.id = p.credential_id
 WHERE p.enabled = 1 AND s.enabled = 1 AND s.status <> 'locked'
 ORDER BY p.id`

func (s *MySQLStore) LoadAll(ctx context.Context) ([]*Config, error) {
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var configs []*Config
	for rows.Next() {
		var (
			cfg                Config
			intervalSec        int
			username, password string
			lat, lon           sql.NullFloat64
		)
		if err := rows.Scan(
			&cfg.ID,
			&cfg.StationID,
			&cfg.MountpointID,
			&cfg.StationRef,
			&cfg.Host,
			&cfg.Port,
			&cfg.Mount,
			&username,
			&password,
			&intervalSec,
			&lat,
			&lon,
		); err != nil {
			return nil, err
		}
		cfg.Username = username
		if password != "" {
			plain, err := secret.Decrypt(password, s.encKey)
			if err != nil {
				return nil, fmt.Errorf("probe %d credential: %w", cfg.ID, err)
			}
			cfg.Password = plain
		}
		if intervalSec > 0 {
			cfg.Interval = time.Duration(intervalSec) * time.Second
		}
		if lat.Valid {
			value := lat.Float64
			cfg.Lat = &value
		}
		if lon.Valid {
			value := lon.Float64
			cfg.Lon = &value
		}
		configs = append(configs, &cfg)
	}
	return configs, rows.Err()
}
