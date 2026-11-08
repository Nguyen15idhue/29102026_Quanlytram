package deviceprofile

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const vectorFile = "testdata/device-profile-vectors.json"

type vectorCase struct {
	Code         string `json:"code"`
	TargetID     int64  `json:"targetId"`
	Role         string `json:"role"`
	Seed         string `json:"seed"`
	Prefix       string `json:"prefix"`
	Version      string `json:"version"`
	UserAgent    string `json:"userAgent"`
	NtripVersion string `json:"ntripVersion"`
	Connection   string `json:"connection"`
}

type vectorFileData struct {
	Note    string       `json:"note"`
	Vectors []vectorCase `json:"vectors"`
}

func TestBaseline(t *testing.T) {
	profiles := Baseline()
	if len(profiles) != 12 {
		t.Fatalf("baseline phải có 12 profile, có %d", len(profiles))
	}
	seen := map[string]bool{}
	for _, profile := range profiles {
		if profile.Code == "" || profile.Name == "" {
			t.Fatalf("profile thiếu code/name: %+v", profile)
		}
		if seen[profile.Code] {
			t.Fatalf("profile code trùng: %s", profile.Code)
		}
		seen[profile.Code] = true
		if !ValidTemplate(profile.VersionTemplate) {
			t.Fatalf("%s có version_template lạ: %s", profile.Code, profile.VersionTemplate)
		}
		if profile.NtripVersionHeader() == "" {
			t.Fatalf("%s có ntrip_version lạ: %s", profile.Code, profile.NtripVersion)
		}
		if profile.Connection != ConnectionClose && profile.Connection != ConnectionKeepAlive {
			t.Fatalf("%s có connection lạ: %s", profile.Code, profile.Connection)
		}
		if profile.Motion != MotionStatic && profile.Motion != MotionRover {
			t.Fatalf("%s có motion lạ: %s", profile.Code, profile.Motion)
		}
		if profile.HDOPMax < profile.HDOPMin {
			t.Fatalf("%s có HDOP range ngược", profile.Code)
		}
		if profile.SatsMax < profile.SatsMin {
			t.Fatalf("%s có sats range ngược", profile.Code)
		}
	}
	if !seen[DefaultCode] {
		t.Fatalf("baseline thiếu profile mặc định %s", DefaultCode)
	}
}

func TestResolve(t *testing.T) {
	profile, ok := Resolve("CHC_LANDSTAR")
	if !ok || profile.Code != "chc_landstar" {
		t.Fatalf("Resolve phải không phân biệt hoa thường: %+v %v", profile, ok)
	}
	if _, ok := Resolve("khong_ton_tai"); ok {
		t.Fatal("Resolve không được trả profile lạ")
	}
	if ResolveOrDefault("").Code != DefaultCode {
		t.Fatal("ResolveOrDefault phải trả profile mặc định")
	}
	if Default().NtripVersionHeader() != "Ntrip/2.0" {
		t.Fatal("profile mặc định phải là Ntrip/2.0")
	}
}

func TestNormalizeDefaults(t *testing.T) {
	normalized := Profile{}.Normalize()
	if normalized.Code != DefaultCode || normalized.Name == "" {
		t.Fatalf("Normalize thiếu code/name: %+v", normalized)
	}
	if normalized.NtripVersion != NtripV2 || normalized.HTTPVersion != HTTP11 {
		t.Fatalf("Normalize thiếu version HTTP: %+v", normalized)
	}
	if normalized.Connection != ConnectionClose {
		t.Fatalf("Normalize phải mặc định Connection=close: %+v", normalized)
	}

	tooMuchJitter := Profile{NMEAIntervalSec: 10, NMEAJitterSec: 9}.Normalize()
	if tooMuchJitter.NMEAJitterSec != 2 {
		t.Fatalf("jitter phải bị giới hạn 20%% của interval, có %d", tooMuchJitter.NMEAJitterSec)
	}
}

func TestVersionRanges(t *testing.T) {
	patterns := map[string]*regexp.Regexp{
		TemplateMajorMinorPatch:     regexp.MustCompile(`^[1-8]\.[0-9]\.(?:[0-9]|1[0-9])$`),
		TemplateVMajorMinorPatch:    regexp.MustCompile(`^v[1-4]\.(?:[0-9]|[12][0-9])\.[0-9]$`),
		TemplateMajorMinor:          regexp.MustCompile(`^(?:[3-9]|10)\.(?:[1-9]|[1-9][0-9])$`),
		TemplateMajorMinorPatchDate: regexp.MustCompile(`^[5-9]\.[0-9]\.[0-4]\.20(?:23|24)(?:0[1-9]|1[0-2])(?:0[1-9]|1[0-9]|2[0-8])$`),
	}
	for template, pattern := range patterns {
		profile := Profile{Code: "test", Name: "Test", VersionTemplate: template}
		for seed := uint64(1); seed <= 500; seed++ {
			version := Version(profile, seed)
			if !pattern.MatchString(version) {
				t.Fatalf("%s seed %d cho version ngoài khoảng: %s", template, seed, version)
			}
		}
	}
}

func TestVersionDeterministic(t *testing.T) {
	profile := ResolveOrDefault("chc_landstar")
	seed := Seed(profile.Code, 42, RoleRelay)
	if Version(profile, seed) != Version(profile, seed) {
		t.Fatal("cùng seed phải cho cùng version")
	}
	distinct := map[string]bool{}
	for target := int64(1); target <= 20; target++ {
		distinct[Version(profile, Seed(profile.Code, target, RoleRelay))] = true
	}
	if len(distinct) < 10 {
		t.Fatalf("20 target phải cho >=10 version khác nhau, chỉ có %d", len(distinct))
	}
}

func TestSeed(t *testing.T) {
	first := Seed("chc_landstar", 7, RoleRelay)
	if first == 0 {
		t.Fatal("seed không được bằng 0")
	}
	if first != Seed("CHC_LANDSTAR ", 7, RoleRelay) {
		t.Fatal("seed phải chuẩn hoá code")
	}
	if first == Seed("chc_landstar", 8, RoleRelay) {
		t.Fatal("target khác phải cho seed khác")
	}
	if first == Seed("chc_landstar", 7, RoleStation) {
		t.Fatal("role khác phải cho seed khác")
	}
	if first == Seed("chc_landstar", 7, RoleProbe) {
		t.Fatal("role probe phải cho seed khác")
	}
}

func TestUserAgent(t *testing.T) {
	profile := ResolveOrDefault("chc_landstar")
	seed := Seed(profile.Code, 7, RoleRelay)

	plain := UserAgent(profile, "", seed)
	wantPrefix := "CHC LandStar/"
	if !strings.HasPrefix(plain, wantPrefix) {
		t.Fatalf("UA phải bắt đầu bằng %q, có %q", wantPrefix, plain)
	}
	for _, banned := range []string{"relay", "station", "probe", "CORS-MVP"} {
		if strings.Contains(strings.ToLower(plain), banned) {
			t.Fatalf("UA chứa hậu tố nội bộ %q: %s", banned, plain)
		}
	}

	prefixed := UserAgent(profile, "  NTRIP  ", seed)
	if prefixed != "NTRIP "+plain {
		t.Fatalf("prefix ghép sai: %q", prefixed)
	}
	if len(plain) > MaxUserAgentLen {
		t.Fatalf("UA dài quá giới hạn: %d", len(plain))
	}
	if UserAgent(Profile{}, "", seed) == "" {
		t.Fatal("UA không được rỗng")
	}
}

func TestNMEAInterval(t *testing.T) {
	profile := ResolveOrDefault("chc_landstar")
	if got := profile.NMEAInterval(0); got != 11 {
		t.Fatalf("interval theo profile phải là 11, có %d", got)
	}
	if got := profile.NMEAInterval(30); got != 30 {
		t.Fatalf("override phải được ưu tiên, có %d", got)
	}
	if got := profile.NMEAInterval(99999); got != 3600 {
		t.Fatalf("override phải bị chặn 3600, có %d", got)
	}
}

func buildVectors() []vectorCase {
	profiles := Baseline()
	vectors := make([]vectorCase, 0, len(profiles)+2)
	for index, profile := range profiles {
		target := int64(index + 1)
		seed := Seed(profile.Code, target, RoleRelay)
		vectors = append(vectors, vectorCase{
			Code:         profile.Code,
			TargetID:     target,
			Role:         string(RoleRelay),
			Seed:         uint64String(seed),
			Prefix:       "",
			Version:      Version(profile, seed),
			UserAgent:    UserAgent(profile, "", seed),
			NtripVersion: profile.NtripVersionHeader(),
			Connection:   profile.Connection,
		})
	}
	landstar := ResolveOrDefault("chc_landstar")
	stationSeed := Seed(landstar.Code, 7, RoleStation)
	vectors = append(vectors, vectorCase{
		Code:         landstar.Code,
		TargetID:     7,
		Role:         string(RoleStation),
		Seed:         uint64String(stationSeed),
		Prefix:       "NTRIP",
		Version:      Version(landstar, stationSeed),
		UserAgent:    UserAgent(landstar, "NTRIP", stationSeed),
		NtripVersion: landstar.NtripVersionHeader(),
		Connection:   landstar.Connection,
	})
	trimble := ResolveOrDefault("trimble_da2")
	probeSeed := Seed(trimble.Code, 1, RoleProbe)
	vectors = append(vectors, vectorCase{
		Code:         trimble.Code,
		TargetID:     1,
		Role:         string(RoleProbe),
		Seed:         uint64String(probeSeed),
		Prefix:       "",
		Version:      Version(trimble, probeSeed),
		UserAgent:    UserAgent(trimble, "", probeSeed),
		NtripVersion: trimble.NtripVersionHeader(),
		Connection:   trimble.Connection,
	})
	return vectors
}

func uint64String(value uint64) string {
	const digits = "0123456789"
	if value == 0 {
		return "0"
	}
	var buffer [20]byte
	position := len(buffer)
	for value > 0 {
		position--
		buffer[position] = digits[value%10]
		value /= 10
	}
	return string(buffer[position:])
}

func readVectors(t *testing.T) vectorFileData {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(vectorFile))
	if err != nil {
		t.Fatalf("không đọc được %s: %v", vectorFile, err)
	}
	var data vectorFileData
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatalf("JSON vector lỗi: %v", err)
	}
	return data
}

// TestVectors giữ fixture dùng chung với Node luôn khớp thuật toán Go.
// Cập nhật fixture: DEVICE_PROFILE_UPDATE=1 go test ./internal/deviceprofile -run TestVectors
func TestVectors(t *testing.T) {
	expected := buildVectors()

	if os.Getenv("DEVICE_PROFILE_UPDATE") == "1" {
		payload := vectorFileData{
			Note:    "Vector dùng chung Go/Node; sinh bởi DEVICE_PROFILE_UPDATE=1 go test ./internal/deviceprofile -run TestVectors",
			Vectors: expected,
		}
		encoded, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			t.Fatalf("không encode được vector: %v", err)
		}
		if err := os.MkdirAll(filepath.Dir(vectorFile), 0o755); err != nil {
			t.Fatalf("không tạo được thư mục testdata: %v", err)
		}
		if err := os.WriteFile(vectorFile, append(encoded, '\n'), 0o644); err != nil {
			t.Fatalf("không ghi được vector: %v", err)
		}
		return
	}

	actual := readVectors(t)
	if len(actual.Vectors) != len(expected) {
		t.Fatalf("fixture có %d vector, cần %d", len(actual.Vectors), len(expected))
	}
	for index, want := range expected {
		got := actual.Vectors[index]
		if got != want {
			t.Fatalf("vector %d lệch:\n got %+v\nwant %+v", index, got, want)
		}
	}
}
