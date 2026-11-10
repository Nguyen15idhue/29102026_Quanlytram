package caster

import (
	"context"
	"database/sql"
	"fmt"
)

type MySQLStore struct {
	db *sql.DB
}

func NewMySQLStore(db *sql.DB) *MySQLStore {
	return &MySQLStore{db: db}
}

// CloseOpenConnections đóng các kết nối caster còn end_ts NULL từ lần chạy
// trước. Nếu bỏ qua, mỗi lần restart lại để lại một tập "đang mở" giả, làm
// trang Danh sách online/bản đồ đếm trùng và query open-set ngày càng nặng
// (D20-8, Plan 20).
// execer tối thiểu để test được câu lệnh dọn dẹp mà không cần MySQL thật.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// CloseOpenConnections trên runtime store (đúng schema cors_runtime).
func (s *MySQLRuntimeStore) CloseOpenConnections(ctx context.Context, reason string) (int64, error) {
	return closeOpenConnections(ctx, s.db, reason)
}

func closeOpenConnections(ctx context.Context, db execer, reason string) (int64, error) {
	result, err := db.ExecContext(ctx,
		`UPDATE caster_connections
		    SET end_ts = UTC_TIMESTAMP(3), disconnect_reason = ?
		  WHERE end_ts IS NULL`,
		reason,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *MySQLStore) LoadConfig(ctx context.Context) (*Config, error) {	cfg := &Config{
		Mountpoints: make(map[int64]*MountpointConfig),
	}

	listenerRows, err := s.db.QueryContext(ctx,
		`SELECT id, name, port, enabled, role, description, company_id
		   FROM caster_listeners ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load caster listeners: %w", err)
	}
	listenersByID := make(map[int64]*ListenerConfig)
	for listenerRows.Next() {
		var (
			listener  ListenerConfig
			enabled   int
			companyID sql.NullInt64
		)
		if err := listenerRows.Scan(
			&listener.ID,
			&listener.Name,
			&listener.Port,
			&enabled,
			&listener.Role,
			&listener.Description,
			&companyID,
		); err != nil {
			listenerRows.Close()
			return nil, err
		}
		listener.Enabled = enabled != 0
		if companyID.Valid {
			value := companyID.Int64
			listener.CompanyID = &value
		}
		listener.Mountpoints = make(map[int64]*MountpointConfig)
		listenersByID[listener.ID] = &listener
		cfg.Listeners = append(cfg.Listeners, &listener)
	}
	if err := listenerRows.Err(); err != nil {
		listenerRows.Close()
		return nil, err
	}
	listenerRows.Close()

	mountpointRows, err := s.db.QueryContext(ctx,
		`SELECT m.id, m.name, COALESCE(m.station_id, 0), m.enabled,
		        COALESCE(ss.caster_requires_auth, 1)
		   FROM mountpoints m
		   LEFT JOIN stations s ON s.id = m.station_id
		   LEFT JOIN station_sources ss ON ss.station_id = m.station_id
		  WHERE s.id IS NULL OR (s.enabled = 1 AND s.status <> 'locked')
		  ORDER BY m.id`)
	if err != nil {
		return nil, fmt.Errorf("load mountpoints: %w", err)
	}
	for mountpointRows.Next() {
		var (
			mountpoint MountpointConfig
			enabled    int
			sourceAuth int
		)
		if err := mountpointRows.Scan(
			&mountpoint.ID,
			&mountpoint.Name,
			&mountpoint.StationID,
			&enabled,
			&sourceAuth,
		); err != nil {
			mountpointRows.Close()
			return nil, err
		}
		mountpoint.Enabled = enabled != 0
		mountpoint.SourceNoAuth = sourceAuth == 0
		cfg.Mountpoints[mountpoint.ID] = &mountpoint
	}
	if err := mountpointRows.Err(); err != nil {
		mountpointRows.Close()
		return nil, err
	}
	mountpointRows.Close()

	mappingRows, err := s.db.QueryContext(ctx,
		`SELECT listener_id, mountpoint_id FROM caster_listener_mountpoints`)
	if err != nil {
		return nil, fmt.Errorf("load caster mappings: %w", err)
	}
	for mappingRows.Next() {
		var listenerID, mountpointID int64
		if err := mappingRows.Scan(&listenerID, &mountpointID); err != nil {
			mappingRows.Close()
			return nil, err
		}
		listener := listenersByID[listenerID]
		mountpoint := cfg.Mountpoints[mountpointID]
		if listener != nil && mountpoint != nil {
			listener.Mountpoints[mountpointID] = mountpoint
		}
	}
	if err := mappingRows.Err(); err != nil {
		mappingRows.Close()
		return nil, err
	}
	mappingRows.Close()

	accountRows, err := s.db.QueryContext(ctx,
		`SELECT id, username, password_hash, enabled, max_connections, company_id,
		        COALESCE(listener_all, 0), COALESCE(mountpoint_all, 0)
		   FROM ntrip_accounts ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load ntrip accounts: %w", err)
	}
	accountsByID := make(map[int64]*AccountConfig)
	for accountRows.Next() {
		var (
			account   AccountConfig
			enabled   int
			companyID sql.NullInt64
			listenerAll, mountpointAll int
		)
		if err := accountRows.Scan(
			&account.ID,
			&account.Username,
			&account.PasswordHash,
			&enabled,
			&account.MaxConnections,
			&companyID,
			&listenerAll,
			&mountpointAll,
		); err != nil {
			accountRows.Close()
			return nil, err
		}
		account.Enabled = enabled != 0
		account.ListenerAll = listenerAll != 0
		account.MountpointAll = mountpointAll != 0
		if companyID.Valid {
			value := companyID.Int64
			account.CompanyID = &value
		}
		if account.MaxConnections <= 0 {
			account.MaxConnections = 1
		}
		account.ACL = make(map[int64]bool)
		account.ListenerACL = make(map[int64]bool)
		accountsByID[account.ID] = &account
		cfg.Accounts = append(cfg.Accounts, &account)
	}
	if err := accountRows.Err(); err != nil {
		accountRows.Close()
		return nil, err
	}
	accountRows.Close()

	aclRows, err := s.db.QueryContext(ctx,
		`SELECT account_id, mountpoint_id FROM account_mountpoint_acl`)
	if err != nil {
		return nil, fmt.Errorf("load account acl: %w", err)
	}
	for aclRows.Next() {
		var accountID, mountpointID int64
		if err := aclRows.Scan(&accountID, &mountpointID); err != nil {
			aclRows.Close()
			return nil, err
		}
		if account := accountsByID[accountID]; account != nil {
			account.ACL[mountpointID] = true
		}
	}
	if err := aclRows.Err(); err != nil {
		aclRows.Close()
		return nil, err
	}
	aclRows.Close()

	listenerAclRows, err := s.db.QueryContext(ctx,
		`SELECT account_id, listener_id FROM account_listener_acl`)
	if err != nil {
		return nil, fmt.Errorf("load account listener acl: %w", err)
	}
	for listenerAclRows.Next() {
		var accountID, listenerID int64
		if err := listenerAclRows.Scan(&accountID, &listenerID); err != nil {
			listenerAclRows.Close()
			return nil, err
		}
		if account := accountsByID[accountID]; account != nil {
			account.ListenerACL[listenerID] = true
		}
	}
	if err := listenerAclRows.Err(); err != nil {
		listenerAclRows.Close()
		return nil, err
	}
	listenerAclRows.Close()

	return cfg, nil
}

type MySQLRuntimeStore struct {
	db *sql.DB
}

func NewMySQLRuntimeStore(db *sql.DB) *MySQLRuntimeStore {
	return &MySQLRuntimeStore{db: db}
}

func (s *MySQLRuntimeStore) Start(ctx context.Context, info StartInfo) (int64, error) {
	result, err := s.db.ExecContext(ctx,
		`INSERT INTO caster_connections
		   (listener_id, mountpoint_id, account_id, direction, remote_addr, user_agent, start_ts)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		info.ListenerID,
		info.MountpointID,
		info.AccountID,
		info.Direction,
		info.RemoteAddr,
		info.UserAgent,
		info.Start.UTC(),
	)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (s *MySQLRuntimeStore) End(ctx context.Context, info EndInfo) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE caster_connections
		    SET end_ts = ?, bytes_in = ?, bytes_out = ?, disconnect_reason = ?
		  WHERE id = ?`,
		info.End.UTC(),
		info.BytesIn,
		info.BytesOut,
		info.DisconnectReason,
		info.ID,
	)
	return err
}
