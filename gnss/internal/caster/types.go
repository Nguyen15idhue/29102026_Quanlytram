package caster

import (
	"context"
	"time"
)

const (
	RoleBoth   = "both"
	RoleSource = "source"
	RoleRover  = "rover"

	DirectionSource = "source"
	DirectionRover  = "rover"
)

type MountpointConfig struct {
	ID           int64
	Name         string
	StationID    int64
	Enabled      bool
	RequiresAuth bool
	AuthMode     string
	PasswordHash string
}

type ListenerConfig struct {
	ID          int64
	Name        string
	Port        int
	Enabled     bool
	Role        string
	Description string
	Mountpoints map[int64]*MountpointConfig
}

type AccountConfig struct {
	ID             int64
	Username       string
	PasswordHash   string
	Enabled        bool
	MaxConnections int
	ACL            map[int64]bool
}

type Config struct {
	Listeners   []*ListenerConfig
	Accounts    []*AccountConfig
	Mountpoints map[int64]*MountpointConfig
}

type StartInfo struct {
	ListenerID   int64
	MountpointID int64
	AccountID    *int64
	RemoteAddr   string
	UserAgent    string
	Start        time.Time
}

type EndInfo struct {
	ID               int64
	End              time.Time
	BytesIn          uint64
	BytesOut         uint64
	DisconnectReason string
}

type ConnectionSnapshot struct {
	ID           int64  `json:"id"`
	Direction    string `json:"direction"`
	ListenerID   int64  `json:"listenerId"`
	MountpointID int64  `json:"mountpointId"`
	AccountID    *int64 `json:"accountId"`
	RemoteAddr   string `json:"remoteAddr"`
	UserAgent    string `json:"userAgent"`
	StartTs      string `json:"startTs"`
	BytesIn      uint64 `json:"bytesIn"`
	BytesOut     uint64 `json:"bytesOut"`
}

type ListenerSnapshot struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Port        int    `json:"port"`
	Role        string `json:"role"`
	Enabled     bool   `json:"enabled"`
	Running     bool   `json:"running"`
	ActualPort  int    `json:"actualPort"`
	Mountpoints int    `json:"mountpoints"`
	LastError   string `json:"lastError,omitempty"`
}

type ConfigStore interface {
	LoadConfig(ctx context.Context) (*Config, error)
}

type RuntimeStore interface {
	Start(ctx context.Context, info StartInfo) (int64, error)
	End(ctx context.Context, info EndInfo) error
}
