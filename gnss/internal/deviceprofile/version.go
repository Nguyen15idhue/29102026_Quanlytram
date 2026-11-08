package deviceprofile

import "fmt"

// Version sinh version tất định từ profile + seed. Khoảng giá trị port đúng
// generateUserAgent() của relay cũ (main.go L1180-1220) để version trông thật:
//
//	major.minor.patch       major 1-8,  minor 0-9,  patch 0-19
//	vmajor.minor.patch      major 1-4,  minor 0-29, patch 0-9   (tiền tố "v")
//	major.minor             major 3-10, minor 1-99              (kiểu Trimble)
//	major.minor.patch.date  major 5-9,  minor 0-9,  patch 0-4,
//	                        ngày 2023-2024, tháng 1-12, ngày 1-28
//
// Thứ tự gọi RNG phải giữ nguyên để Node tái tạo đúng cùng vector.
func Version(profile Profile, seed uint64) string {
	profile = profile.Normalize()
	rng := NewRNG(seed)

	switch profile.VersionTemplate {
	case TemplateMajorMinorPatch:
		major := rng.Intn(8) + 1
		minor := rng.Intn(10)
		patch := rng.Intn(20)
		return fmt.Sprintf("%d.%d.%d", major, minor, patch)

	case TemplateVMajorMinorPatch:
		major := rng.Intn(4) + 1
		minor := rng.Intn(30)
		patch := rng.Intn(10)
		return fmt.Sprintf("v%d.%d.%d", major, minor, patch)

	case TemplateMajorMinor:
		major := rng.Intn(8) + 3
		minor := rng.Intn(99) + 1
		return fmt.Sprintf("%d.%d", major, minor)

	case TemplateMajorMinorPatchDate:
		major := rng.Intn(5) + 5
		minor := rng.Intn(10)
		patch := rng.Intn(5)
		year := 2023 + rng.Intn(2)
		month := rng.Intn(12) + 1
		day := rng.Intn(28) + 1
		return fmt.Sprintf("%d.%d.%d.%04d%02d%02d", major, minor, patch, year, month, day)

	default:
		return "1.0.0"
	}
}
