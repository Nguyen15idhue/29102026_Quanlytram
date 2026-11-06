package relay

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"sync/atomic"

	"cors/gnss/internal/secret"
)

type ConfigStore interface {
	LoadAll(ctx context.Context) ([]*JobConfig, error)
	LoadJob(ctx context.Context, id int64) (*JobConfig, error)
}

type MySQLStore struct {
	db       *sql.DB
	encKey   string
	degraded atomic.Bool
}

func NewMySQLStore(db *sql.DB, encKey string) *MySQLStore {
	return &MySQLStore{db: db, encKey: encKey}
}

// Degraded báo có job bị bỏ qua do credential không giải mã được.
func (s *MySQLStore) Degraded() bool {
	return s.degraded.Load()
}

const jobColumns = `
  j.id, COALESCE(j.external_key, ''), j.name, j.enabled, j.desired_revision,
  j.upstream_host, j.upstream_port, j.upstream_mount, j.upstream_proxy, j.upstream_ssl, j.upstream_ntrip_version,
  COALESCE(uc.username, ''), COALESCE(uc.password_enc, ''), IFNULL(j.upstream_credential_id, 0),
  IFNULL(j.upstream_station_id, 0), IFNULL(j.upstream_mountpoint_id, 0), COALESCE(uss.source_role, ''),
  j.downstream_host, j.downstream_port, j.downstream_mount, j.downstream_proxy, j.downstream_ssl, j.downstream_ntrip_version,
  COALESCE(dc.username, ''), COALESCE(dc.password_enc, ''), IFNULL(j.downstream_credential_id, 0),
  j.downstream_mode, j.lat, j.lon, j.ua_prefix, j.nmea_interval_sec, j.origin,
  j.upstream_key, j.downstream_key,
  j.deleted_at, j.locked, IFNULL(s.enabled, 1), IFNULL(s.status, '')
FROM relay_jobs j
LEFT JOIN relay_credentials uc ON uc.id = j.upstream_credential_id
LEFT JOIN relay_credentials dc ON dc.id = j.downstream_credential_id
LEFT JOIN station_sources uss ON uss.station_id = j.upstream_station_id
LEFT JOIN mountpoints sm ON sm.name = j.upstream_mount
LEFT JOIN stations s ON s.id = sm.station_id`

type rowScanner interface {
	Scan(dest ...any) error
}

// credentialAAD là AAD dùng cho secret của bảng relay_credentials, đồng nhất
// với Node (`relay_credentials:password_enc:<id>`). id <= 0 nghĩa là job
// không tham chiếu credential nên không có AAD.
func credentialAAD(credentialID int64) string {
	if credentialID <= 0 {
		return ""
	}
	return fmt.Sprintf("relay_credentials:password_enc:%d", credentialID)
}

func (s *MySQLStore) scanJob(scanner rowScanner) (*JobConfig, error) {
	var (
		job                                          JobConfig
		enabled, upstreamSSL, downstreamSSL          int
		lat, lon                                     sql.NullFloat64
		upstreamUsername, upstreamPasswordEnc        string
		downstreamUsername, downstreamPasswordEnc    string
		upstreamCredentialID, downstreamCredentialID int64
		upstreamStationID, upstreamMountpointID      int64
		upstreamStationRole                          string
		dbUpstreamKey, dbDownstreamKey               string
		deletedAt                                    sql.NullTime
		locked, stationEnabled                       int
		stationStatus                                string
	)
	err := scanner.Scan(
		&job.ID,
		&job.ExternalKey,
		&job.Name,
		&enabled,
		&job.DesiredRevision,
		&job.Upstream.Host,
		&job.Upstream.Port,
		&job.Upstream.Mount,
		&job.Upstream.ProxyURL,
		&upstreamSSL,
		&job.Upstream.NtripVersion,
		&upstreamUsername,
		&upstreamPasswordEnc,
		&upstreamCredentialID,
		&upstreamStationID,
		&upstreamMountpointID,
		&upstreamStationRole,
		&job.Downstream.Host,
		&job.Downstream.Port,
		&job.Downstream.Mount,
		&job.Downstream.ProxyURL,
		&downstreamSSL,
		&job.Downstream.NtripVersion,
		&downstreamUsername,
		&downstreamPasswordEnc,
		&downstreamCredentialID,
		&job.DownstreamMode,
		&lat,
		&lon,
		&job.UAPrefix,
		&job.NMEAIntervalSec,
		&job.Origin,
		&dbUpstreamKey,
		&dbDownstreamKey,
		&deletedAt,
		&locked,
		&stationEnabled,
		&stationStatus,
	)
	if err != nil {
		return nil, err
	}

	job.ConfigEnabled = enabled != 0
	job.Locked = locked != 0
	job.Deleted = deletedAt.Valid
	job.StationBlocked = stationEnabled == 0 || stationStatus == "locked"
	job.Enabled = computeEnabled(job.ConfigEnabled, job.Locked, job.Deleted, job.StationBlocked)
	job.Upstream.SSL = upstreamSSL != 0
	job.Downstream.SSL = downstreamSSL != 0
	if lat.Valid {
		value := lat.Float64
		job.Lat = &value
	}
	if lon.Valid {
		value := lon.Float64
		job.Lon = &value
	}

	job.Upstream.Username = upstreamUsername
	job.Downstream.Username = downstreamUsername
	job.Upstream.HasCredential = upstreamUsername != "" || upstreamPasswordEnc != ""
	job.Downstream.HasCredential = downstreamUsername != "" || downstreamPasswordEnc != ""

	if upstreamPasswordEnc != "" {
		password, err := secret.DecryptRecord(
			upstreamPasswordEnc,
			s.encKey,
			credentialAAD(upstreamCredentialID),
		)
		if err != nil {
			return nil, fmt.Errorf("job %d upstream credential: %w", job.ID, err)
		}
		job.Upstream.Password = password
	}
	if downstreamPasswordEnc != "" {
		password, err := secret.DecryptRecord(
			downstreamPasswordEnc,
			s.encKey,
			credentialAAD(downstreamCredentialID),
		)
		if err != nil {
			return nil, fmt.Errorf("job %d downstream credential: %w", job.ID, err)
		}
		job.Downstream.Password = password
	}

	job.Upstream.Key = EndpointKey(job.Upstream)
	job.Downstream.Key = EndpointKey(job.Downstream)
	job.UpstreamStationID = upstreamStationID
	job.UpstreamMountpointID = upstreamMountpointID
	job.UpstreamDirect = upstreamStationID > 0 &&
		upstreamMountpointID > 0 &&
		upstreamStationRole == "ntrip_caster"
	_ = dbUpstreamKey
	_ = dbDownstreamKey
	return &job, nil
}

func (s *MySQLStore) LoadAll(ctx context.Context) ([]*JobConfig, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+jobColumns+`
		WHERE j.deleted_at IS NULL
		ORDER BY j.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []*JobConfig
	s.degraded.Store(false)
	for rows.Next() {
		job, err := s.scanJob(rows)
		if err != nil {
			// Một credential hỏng chỉ bỏ qua job đó, không làm hỏng toàn bộ cấu hình.
			s.degraded.Store(true)
			log.Printf("[relay] bỏ qua job lỗi cấu hình: %v", err)
			continue
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func (s *MySQLStore) LoadJob(ctx context.Context, id int64) (*JobConfig, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+jobColumns+`
		WHERE j.deleted_at IS NULL AND j.id = ?`, id)
	job, err := s.scanJob(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return job, nil
}

func EndpointKey(endpoint EndpointConfig) string {
	scheme := "http"
	if endpoint.SSL {
		scheme = "https"
	}
	port := endpoint.Port
	if port == 0 {
		if endpoint.SSL {
			port = 443
		} else {
			port = 80
		}
	}
	host := strings.ToLower(strings.TrimSpace(endpoint.Host))
	mount := strings.Trim(strings.TrimSpace(endpoint.Mount), "/")
	return fmt.Sprintf("%s://%s:%d/%s", scheme, host, port, mount)
}
