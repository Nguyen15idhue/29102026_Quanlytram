package relay

import (
	"database/sql"
	"encoding/base64"
	"reflect"
	"testing"

	"cors/gnss/internal/secret"
)

// fakeRow giả lập một dòng MySQL cho scanJob: gán lần lượt values vào dest.
type fakeRow struct {
	values []any
}

func (f *fakeRow) Scan(dest ...any) error {
	if len(dest) != len(f.values) {
		return &scanArityError{got: len(dest), want: len(f.values)}
	}
	for i, target := range dest {
		ptr := reflect.ValueOf(target)
		src := reflect.ValueOf(f.values[i])
		elem := ptr.Elem()
		if src.Type().AssignableTo(elem.Type()) {
			elem.Set(src)
			continue
		}
		if src.Type().ConvertibleTo(elem.Type()) {
			elem.Set(src.Convert(elem.Type()))
			continue
		}
		return &scanTypeError{index: i}
	}
	return nil
}

type scanArityError struct{ got, want int }

func (e *scanArityError) Error() string { return "scan arity mismatch" }

type scanTypeError struct{ index int }

func (e *scanTypeError) Error() string { return "scan type mismatch" }

func testKey(fill byte) string {
	raw := make([]byte, 32)
	for i := range raw {
		raw[i] = fill
	}
	return base64.StdEncoding.EncodeToString(raw)
}

// jobRow dựng values theo đúng thứ tự cột của jobColumns.
func jobRow(upstreamPasswordEnc string, upstreamCredentialID int64, downstreamPasswordEnc string, downstreamCredentialID int64) []any {
	return []any{
		int64(7), "ext-7", "Job 7", 1, int64(3),
		"up.example", 2101, "UP", "", 0, "v2",
		"up-user", upstreamPasswordEnc, upstreamCredentialID,
		int64(0), int64(0), "",
		"down.example", 2101, "DOWN", "", 0, "v2",
		"down-user", downstreamPasswordEnc, downstreamCredentialID,
		"source", sql.NullFloat64{}, sql.NullFloat64{}, "", sql.NullInt64{}, "profile", 0, 0, "manual",
		"up.example:2101:UP", "down.example:2101:DOWN",
		sql.NullTime{}, 0, 1, "",
	}
}

func TestCredentialAAD(t *testing.T) {
	if got := credentialAAD(0); got != "" {
		t.Fatalf("credentialAAD(0) = %q, want empty", got)
	}
	if got := credentialAAD(12); got != "relay_credentials:password_enc:12" {
		t.Fatalf("credentialAAD(12) = %q", got)
	}
}

func TestScanJobDecryptsV2CredentialWithRecordAAD(t *testing.T) {
	key := testKey(5)
	upstreamEnc, err := secret.EncryptWithAAD("up-secret", key, credentialAAD(12))
	if err != nil {
		t.Fatal(err)
	}
	downstreamEnc, err := secret.EncryptWithAAD("down-secret", key, credentialAAD(13))
	if err != nil {
		t.Fatal(err)
	}

	store := NewMySQLStore(nil, key)
	job, err := store.scanJob(&fakeRow{values: jobRow(upstreamEnc, 12, downstreamEnc, 13)})
	if err != nil {
		t.Fatalf("scanJob: %v", err)
	}
	if job.Upstream.Password != "up-secret" {
		t.Fatalf("upstream password = %q", job.Upstream.Password)
	}
	if job.Downstream.Password != "down-secret" {
		t.Fatalf("downstream password = %q", job.Downstream.Password)
	}
	if !job.Upstream.HasCredential || !job.Downstream.HasCredential {
		t.Fatal("HasCredential phải true")
	}
	if !job.Enabled {
		t.Fatal("job phải enabled")
	}
}

func TestScanJobMarksDirectUpstreamForAnyStation(t *testing.T) {
	store := NewMySQLStore(nil, testKey(8))

	direct := jobRow("", 0, "", 0)
	direct[14] = int64(5)
	direct[15] = int64(9)
	direct[16] = "ntrip_caster"
	job, err := store.scanJob(&fakeRow{values: direct})
	if err != nil {
		t.Fatalf("scanJob direct: %v", err)
	}
	if !job.UpstreamDirect {
		t.Fatal("trạm ntrip_caster phải đọc trực tiếp")
	}
	if job.Upstream.Key != "station://5" {
		t.Fatalf("upstream key = %q", job.Upstream.Key)
	}

	client := jobRow("", 0, "", 0)
	client[14] = int64(5)
	client[15] = int64(0)
	client[16] = "ntrip_client"
	job, err = store.scanJob(&fakeRow{values: client})
	if err != nil {
		t.Fatalf("scanJob client: %v", err)
	}
	if !job.UpstreamDirect {
		t.Fatal("trạm ntrip_client phải đọc trực tiếp station source nội bộ")
	}
	if job.Upstream.Key != "station://5" {
		t.Fatalf("upstream key client = %q", job.Upstream.Key)
	}

	manual := jobRow("", 0, "", 0)
	manual[14] = int64(0)
	manual[15] = int64(0)
	manual[16] = ""
	job, err = store.scanJob(&fakeRow{values: manual})
	if err != nil {
		t.Fatalf("scanJob manual: %v", err)
	}
	if job.UpstreamDirect {
		t.Fatal("job nhập thủ công không được đọc trực tiếp")
	}
}

func TestScanJobKeepsV1Readable(t *testing.T) {
	key := testKey(6)
	upstreamEnc, err := secret.Encrypt("up-secret", key)
	if err != nil {
		t.Fatal(err)
	}

	store := NewMySQLStore(nil, key)
	job, err := store.scanJob(&fakeRow{values: jobRow(upstreamEnc, 12, "", 0)})
	if err != nil {
		t.Fatalf("scanJob: %v", err)
	}
	if job.Upstream.Password != "up-secret" {
		t.Fatalf("upstream password = %q", job.Upstream.Password)
	}
}

func TestScanJobRejectsWrongRecordAAD(t *testing.T) {
	key := testKey(7)
	upstreamEnc, err := secret.EncryptWithAAD("up-secret", key, credentialAAD(12))
	if err != nil {
		t.Fatal(err)
	}

	store := NewMySQLStore(nil, key)
	// Job trỏ credential 99 nhưng ciphertext gắn AAD của credential 12.
	if _, err := store.scanJob(&fakeRow{values: jobRow(upstreamEnc, 99, "", 0)}); err == nil {
		t.Fatal("AAD sai phải làm scanJob lỗi")
	}
}
