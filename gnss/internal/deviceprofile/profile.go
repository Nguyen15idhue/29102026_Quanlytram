// Package deviceprofile mô phỏng dấu vết của thiết bị GNSS thật (User-Agent,
// Ntrip-Version, Connection, chu kỳ NMEA, trạng thái fix) để relay, station
// source và probe không tự khai báo là hệ thống nội bộ.
//
// Baseline port từ relay cũ (relayrtcm/backup/main.go L78-106); không đọc/ghi
// bất kỳ file nào trong relayrtcm/backup. Version UA không lưu DB mà sinh tất
// định từ (code, targetID, role) theo D19-3/D19-19.
package deviceprofile

import "strings"

const (
	TemplateMajorMinorPatch     = "major.minor.patch"
	TemplateMajorMinorPatchDate = "major.minor.patch.date"
	TemplateVMajorMinorPatch    = "vmajor.minor.patch"
	TemplateMajorMinor          = "major.minor"

	NtripV1 = "v1"
	NtripV2 = "v2"

	HTTP10 = "HTTP/1.0"
	HTTP11 = "HTTP/1.1"

	ConnectionClose     = "close"
	ConnectionKeepAlive = "keep-alive"

	MotionStatic = "static"
	MotionRover  = "rover"

	// DefaultCode là profile trung tính khi job/trạm chưa chọn profile (D19-6).
	DefaultCode = "gnss_internet_radio"

	// MaxUserAgentLen khớp ua_prefix VARCHAR(100) + tên/version thiết bị và cột
	// runtime user_agent VARCHAR(160).
	MaxUserAgentLen = 160
)

// Profile là cấu hình ngụy trang của một dòng thiết bị.
type Profile struct {
	Code              string
	Name              string
	Vendor            string
	VersionTemplate   string
	NtripVersion      string
	HTTPVersion       string
	Connection        string
	NMEAIntervalSec   int
	NMEAJitterSec     int
	HDOPMin           float64
	HDOPMax           float64
	SatsMin           int
	SatsMax           int
	SendGSA           bool
	SendRMC           bool
	InitialDelayMS    int
	Motion            string
	ReceiverTypeAlias string
}

// NtripVersionHeader trả giá trị header Ntrip-Version (rỗng nếu không gửi).
func (p Profile) NtripVersionHeader() string {
	switch p.NtripVersion {
	case NtripV1:
		return "Ntrip/1.0"
	case NtripV2:
		return "Ntrip/2.0"
	default:
		return ""
	}
}

// NMEAInterval trả chu kỳ NMEA: override > 0 được ưu tiên, ngược lại theo
// profile. Giới hạn 1..3600 giây giống relay cũ.
func (p Profile) NMEAInterval(override int) int {
	if override > 0 {
		if override > 3600 {
			return 3600
		}
		return override
	}
	p = p.Normalize()
	return p.NMEAIntervalSec
}

// Normalize điền giá trị mặc định an toàn cho profile thiếu dữ liệu (ví dụ
// dòng đọc từ DB cũ hoặc profile custom).
func (p Profile) Normalize() Profile {
	if strings.TrimSpace(p.Code) == "" {
		p.Code = DefaultCode
	}
	if strings.TrimSpace(p.Name) == "" {
		p.Name = "GNSSInternetRadio"
	}
	if !ValidTemplate(p.VersionTemplate) {
		p.VersionTemplate = TemplateMajorMinorPatch
	}
	switch p.NtripVersion {
	case NtripV1, NtripV2:
	default:
		p.NtripVersion = NtripV2
	}
	switch p.HTTPVersion {
	case HTTP10, HTTP11:
	default:
		p.HTTPVersion = HTTP11
	}
	switch p.Connection {
	case ConnectionClose, ConnectionKeepAlive:
	default:
		p.Connection = ConnectionClose
	}
	switch p.Motion {
	case MotionStatic, MotionRover:
	default:
		p.Motion = MotionStatic
	}
	if p.NMEAIntervalSec <= 0 {
		p.NMEAIntervalSec = 10
	}
	if p.NMEAIntervalSec > 3600 {
		p.NMEAIntervalSec = 3600
	}
	if p.NMEAJitterSec < 0 {
		p.NMEAJitterSec = 0
	}
	if max := p.NMEAIntervalSec / 5; p.NMEAJitterSec > max {
		p.NMEAJitterSec = max
	}
	if p.HDOPMin <= 0 {
		p.HDOPMin = 0.8
	}
	if p.HDOPMax <= 0 || p.HDOPMax < p.HDOPMin {
		p.HDOPMax = p.HDOPMin + 0.4
	}
	if p.SatsMin <= 0 {
		p.SatsMin = 10
	}
	if p.SatsMax <= 0 || p.SatsMax < p.SatsMin {
		p.SatsMax = p.SatsMin + 4
	}
	if p.InitialDelayMS < 0 {
		p.InitialDelayMS = 0
	}
	return p
}

// ValidTemplate báo template version có được hỗ trợ.
func ValidTemplate(template string) bool {
	switch template {
	case TemplateMajorMinorPatch, TemplateMajorMinorPatchDate, TemplateVMajorMinorPatch, TemplateMajorMinor:
		return true
	default:
		return false
	}
}

// Baseline trả 12 profile gốc port từ relay cũ. Thứ tự giữ nguyên như
// deviceProfiles của bản cũ.
func Baseline() []Profile {
	return []Profile{
		{
			Code: "gnss_internet_radio", Name: "GNSSInternetRadio", Vendor: "GNSSInternetRadio",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 10, NMEAJitterSec: 2,
			HDOPMin: 0.8, HDOPMax: 1.2, SatsMin: 10, SatsMax: 14,
			SendGSA: true, SendRMC: false, InitialDelayMS: 0, Motion: MotionStatic,
			ReceiverTypeAlias: "GNSSInternetRadio",
		},
		{
			Code: "efix_efield", Name: "EFIX eField", Vendor: "EFIX",
			VersionTemplate: TemplateMajorMinorPatchDate, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 12, NMEAJitterSec: 3,
			HDOPMin: 0.7, HDOPMax: 1.0, SatsMin: 12, SatsMax: 16,
			SendGSA: true, SendRMC: true, InitialDelayMS: 1000, Motion: MotionStatic,
			ReceiverTypeAlias: "EFIX",
		},
		{
			Code: "chc_landstar", Name: "CHC LandStar", Vendor: "CHC Navigation",
			VersionTemplate: TemplateMajorMinorPatchDate, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 11, NMEAJitterSec: 2,
			HDOPMin: 0.9, HDOPMax: 1.3, SatsMin: 9, SatsMax: 13,
			SendGSA: false, SendRMC: true, InitialDelayMS: 0, Motion: MotionStatic,
			ReceiverTypeAlias: "CHC",
		},
		{
			Code: "chc_i83", Name: "CHC i83", Vendor: "CHC Navigation",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 15, NMEAJitterSec: 4,
			HDOPMin: 0.8, HDOPMax: 1.4, SatsMin: 10, SatsMax: 15,
			SendGSA: true, SendRMC: false, InitialDelayMS: 2000, Motion: MotionStatic,
			ReceiverTypeAlias: "CHC",
		},
		{
			Code: "comnav_t300", Name: "COMNAV T300", Vendor: "ComNav Technology",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 9, NMEAJitterSec: 1,
			HDOPMin: 0.7, HDOPMax: 1.1, SatsMin: 11, SatsMax: 15,
			SendGSA: false, SendRMC: false, InitialDelayMS: 1000, Motion: MotionStatic,
			ReceiverTypeAlias: "COMNAV",
		},
		{
			Code: "trimble_da2", Name: "Trimble DA2", Vendor: "Trimble",
			VersionTemplate: TemplateMajorMinor, NtripVersion: NtripV1, HTTPVersion: HTTP11,
			Connection: ConnectionKeepAlive, NMEAIntervalSec: 10, NMEAJitterSec: 2,
			HDOPMin: 0.6, HDOPMax: 0.9, SatsMin: 12, SatsMax: 18,
			SendGSA: true, SendRMC: true, InitialDelayMS: 0, Motion: MotionRover,
			ReceiverTypeAlias: "Trimble",
		},
		{
			Code: "hitarget_v90", Name: "Hi-Target V90", Vendor: "Hi-Target",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 13, NMEAJitterSec: 3,
			HDOPMin: 0.8, HDOPMax: 1.2, SatsMin: 10, SatsMax: 14,
			SendGSA: false, SendRMC: true, InitialDelayMS: 1000, Motion: MotionStatic,
			ReceiverTypeAlias: "Hi-Target",
		},
		{
			Code: "south_s82t", Name: "South S82T", Vendor: "South Surveying",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 11, NMEAJitterSec: 2,
			HDOPMin: 0.9, HDOPMax: 1.3, SatsMin: 9, SatsMax: 13,
			SendGSA: true, SendRMC: false, InitialDelayMS: 0, Motion: MotionStatic,
			ReceiverTypeAlias: "South",
		},
		{
			Code: "stonex_s900a", Name: "Stonex S900A", Vendor: "Stonex",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 14, NMEAJitterSec: 3,
			HDOPMin: 0.8, HDOPMax: 1.4, SatsMin: 10, SatsMax: 14,
			SendGSA: false, SendRMC: false, InitialDelayMS: 2000, Motion: MotionStatic,
			ReceiverTypeAlias: "Stonex",
		},
		{
			Code: "unistrong_g970", Name: "UniStrong G970", Vendor: "UniStrong",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 10, NMEAJitterSec: 2,
			HDOPMin: 0.7, HDOPMax: 1.1, SatsMin: 11, SatsMax: 15,
			SendGSA: true, SendRMC: true, InitialDelayMS: 1000, Motion: MotionStatic,
			ReceiverTypeAlias: "UniStrong",
		},
		{
			Code: "emlid_reachrs2", Name: "Emlid ReachRS2", Vendor: "Emlid",
			VersionTemplate: TemplateVMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 12, NMEAJitterSec: 2,
			HDOPMin: 0.8, HDOPMax: 1.1, SatsMin: 11, SatsMax: 14,
			SendGSA: false, SendRMC: false, InitialDelayMS: 1000, Motion: MotionStatic,
			ReceiverTypeAlias: "Emlid",
		},
		{
			Code: "leica_gs18", Name: "Leica GS18", Vendor: "Leica Geosystems",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionKeepAlive, NMEAIntervalSec: 11, NMEAJitterSec: 3,
			HDOPMin: 0.6, HDOPMax: 0.9, SatsMin: 13, SatsMax: 18,
			SendGSA: true, SendRMC: true, InitialDelayMS: 0, Motion: MotionRover,
			ReceiverTypeAlias: "Leica",
		},
	}
}

// Resolve tìm profile theo code (không phân biệt hoa thường).
func Resolve(code string) (Profile, bool) {
	code = strings.ToLower(strings.TrimSpace(code))
	if code == "" {
		return Profile{}, false
	}
	for _, profile := range Baseline() {
		if profile.Code == code {
			return profile, true
		}
	}
	return Profile{}, false
}

// Default trả profile trung tính khi chưa cấu hình.
func Default() Profile {
	profile, ok := Resolve(DefaultCode)
	if !ok {
		return Profile{
			Code: DefaultCode, Name: "GNSSInternetRadio",
			VersionTemplate: TemplateMajorMinorPatch, NtripVersion: NtripV2, HTTPVersion: HTTP11,
			Connection: ConnectionClose, NMEAIntervalSec: 10, NMEAJitterSec: 2,
			HDOPMin: 0.8, HDOPMax: 1.2, SatsMin: 10, SatsMax: 14,
			SendGSA: true, SendRMC: false, Motion: MotionStatic,
		}
	}
	return profile
}

// IsZero báo profile chưa được khởi tạo.
func (p Profile) IsZero() bool {
	return strings.TrimSpace(p.Code) == ""
}
