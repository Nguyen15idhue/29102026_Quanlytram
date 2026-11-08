package relay

import (
	"strings"

	"cors/gnss/internal/deviceprofile"
)

// resolveUserAgent chọn User-Agent gửi tới caster.
//   - ua_mode = "literal": dùng nguyên văn ua_prefix (caster whitelist UA).
//   - còn lại: prefix (nếu có) + "TênThiếtBị/Version" theo device profile.
//
// Không bao giờ nối thêm hậu tố nội bộ như "-relay" / "-relay-test" (D19-2).
func resolveUserAgent(cfg *JobConfig, role deviceprofile.Role, targetID int64) string {
	if cfg == nil {
		return ""
	}
	profile := cfg.DeviceProfile
	if profile.IsZero() {
		profile = deviceprofile.Default()
	}
	if targetID <= 0 {
		targetID = cfg.ID
	}

	if strings.EqualFold(strings.TrimSpace(cfg.UAMode), "literal") {
		if literal := strings.TrimSpace(cfg.UAPrefix); literal != "" {
			return literal
		}
		// Literal rỗng là cấu hình lỗi: vẫn gửi UA thiết bị thay vì UA rỗng.
		return deviceprofile.UserAgent(profile, "", deviceprofile.Seed(profile.Code, targetID, role))
	}

	return deviceprofile.UserAgent(
		profile,
		cfg.UAPrefix,
		deviceprofile.Seed(profile.Code, targetID, role),
	)
}

// resolveStationUserAgent chọn UA cho nguồn NTRIP client của trạm. Station
// source chỉ dùng profile (chưa có literal mode — D19-20), seed theo station ID
// và role riêng để không trùng UA với relay job cùng ID.
func resolveStationUserAgent(cfg *StationSourceConfig) string {
	if cfg == nil {
		return ""
	}
	profile := cfg.DeviceProfile
	if profile.IsZero() {
		profile = deviceprofile.Default()
	}
	return deviceprofile.UserAgent(
		profile,
		cfg.UAPrefix,
		deviceprofile.Seed(profile.Code, cfg.StationID, deviceprofile.RoleStation),
	)
}
