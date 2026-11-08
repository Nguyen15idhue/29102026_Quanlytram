package deviceprofile

import "strings"

// Role tách seed giữa các đối tượng để hai bản ghi cùng ID (relay job id 7 và
// trạm id 7) không trùng version (D19-19).
type Role string

const (
	RoleRelay   Role = "relay"
	RoleStation Role = "station"
	RoleProbe   Role = "probe"
)

// fnv1a64 là FNV-1a 64-bit, dễ port sang JavaScript bằng BigInt.
func fnv1a64(value string) uint64 {
	const (
		offset uint64 = 0xcbf29ce484222325
		prime  uint64 = 0x100000001b3
	)
	hash := offset
	for i := 0; i < len(value); i++ {
		hash ^= uint64(value[i])
		hash *= prime
	}
	return hash
}

// Seed sinh seed tất định từ (profile code, target id, role). Cùng đầu vào
// luôn cho cùng User-Agent, kể cả sau khi restart service (D19-3).
func Seed(code string, targetID int64, role Role) uint64 {
	seed := fnv1a64(strings.ToLower(strings.TrimSpace(code)))
	seed ^= uint64(targetID)
	seed ^= fnv1a64(string(role))
	if seed == 0 {
		seed = rngFallbackSeed
	}
	return seed
}

// UserAgent ghép User-Agent theo đúng buildUserAgent() của relay cũ
// (main.go L1170-1179): prefix rỗng thì chỉ trả "TênThiếtBị/Version", ngược
// lại là "prefix TênThiếtBị/Version". Không bao giờ thêm hậu tố nội bộ như
// "-relay", "-station" hay "-probe".
func UserAgent(profile Profile, prefix string, seed uint64) string {
	profile = profile.Normalize()
	base := strings.TrimSpace(profile.Name) + "/" + Version(profile, seed)
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return base
	}
	return prefix + " " + base
}

// ResolveOrDefault trả profile theo code, rỗng/không tồn tại thì dùng mặc định.
func ResolveOrDefault(code string) Profile {
	if profile, ok := Resolve(code); ok {
		return profile
	}
	return Default()
}
