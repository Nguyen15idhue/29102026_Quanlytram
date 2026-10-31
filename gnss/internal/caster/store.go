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

func (s *MySQLStore) LoadConfig(ctx context.Context) (*Config, error) {
	cfg := &Config{
		Mountpoints: make(map[int64]*MountpointConfig),
	}

	listenerRows, err := s.db.QueryContext(ctx,
		`SELECT id, name, port, enabled, role, description FROM caster_listeners ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load caster listeners: %w", err)
	}
	listenersByID := make(map[int64]*ListenerConfig)
	for listenerRows.Next() {
		var (
			listener ListenerConfig
			enabled  int
		)
		if err := listenerRows.Scan(
			&listener.ID,
			&listener.Name,
			&listener.Port,
			&enabled,
			&listener.Role,
			&listener.Description,
		); err != nil {
			listenerRows.Close()
			return nil, err
		}
		listener.Enabled = enabled != 0
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
		`SELECT id, name, COALESCE(station_id, 0), enabled, requires_auth,
		        COALESCE(auth_mode, 'ntrip_account'), COALESCE(password_hash, '')
		   FROM mountpoints ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load mountpoints: %w", err)
	}
	for mountpointRows.Next() {
		var (
			mountpoint   MountpointConfig
			enabled      int
			requiresAuth int
		)
		if err := mountpointRows.Scan(
			&mountpoint.ID,
			&mountpoint.Name,
			&mountpoint.StationID,
			&enabled,
			&requiresAuth,
			&mountpoint.AuthMode,
			&mountpoint.PasswordHash,
		); err != nil {
			mountpointRows.Close()
			return nil, err
		}
		mountpoint.Enabled = enabled != 0
		mountpoint.RequiresAuth = requiresAuth != 0
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
		`SELECT id, username, password_hash, enabled, max_connections FROM ntrip_accounts ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load ntrip accounts: %w", err)
	}
	accountsByID := make(map[int64]*AccountConfig)
	for accountRows.Next() {
		var (
			account AccountConfig
			enabled int
		)
		if err := accountRows.Scan(
			&account.ID,
			&account.Username,
			&account.PasswordHash,
			&enabled,
			&account.MaxConnections,
		); err != nil {
			accountRows.Close()
			return nil, err
		}
		account.Enabled = enabled != 0
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
