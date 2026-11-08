package relay

import "cors/gnss/internal/deviceprofile"

type EndpointConfig struct {
	Host          string
	Port          int
	Mount         string
	ProxyURL      string
	SSL           bool
	NtripVersion  string
	HTTPVersion   string
	Connection    string
	Username      string
	Password      string
	HasCredential bool
	Key           string
}

type JobConfig struct {
	ID                   int64
	ExternalKey          string
	Name                 string
	Enabled              bool
	ConfigEnabled        bool
	Locked               bool
	Deleted              bool
	StationBlocked       bool
	DesiredRevision      int64
	Upstream             EndpointConfig
	Downstream           EndpointConfig
	UpstreamStationID    int64
	UpstreamMountpointID int64
	UpstreamDirect       bool
	DownstreamMode       string
	Lat                  *float64
	Lon                  *float64
	UAPrefix             string
	DeviceProfileID      int64
	DeviceProfile        deviceprofile.Profile
	UAMode               string
	MotionEnabled        bool
	NMEAIntervalSec      int
	Origin               string
}

type Edge struct {
	JobID         int64
	UpstreamKey   string
	DownstreamKey string
}

// computeEnabled quyết định job có được phép chạy hay không.
// Khóa, xóa mềm hoặc trạm nguồn bị tắt/khóa đều dẫn tới "disabled",
// khác với "deleted" (row không còn tồn tại).
func computeEnabled(configEnabled, locked, deleted, stationBlocked bool) bool {
	return configEnabled && !locked && !deleted && !stationBlocked
}
