package relay

type EndpointConfig struct {
	Host          string
	Port          int
	Mount         string
	ProxyURL      string
	SSL           bool
	NtripVersion  string
	Username      string
	Password      string
	HasCredential bool
	Key           string
}

type JobConfig struct {
	ID              int64
	ExternalKey     string
	Name            string
	Enabled         bool
	DesiredRevision int64
	Upstream        EndpointConfig
	Downstream      EndpointConfig
	DownstreamMode  string
	Lat             *float64
	Lon             *float64
	UAPrefix        string
	NMEAIntervalSec int
	Origin          string
}

type Edge struct {
	JobID         int64
	UpstreamKey   string
	DownstreamKey string
}
