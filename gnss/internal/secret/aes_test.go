package secret

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testKey(fill byte) string {
	return base64.StdEncoding.EncodeToString([]byte{
		fill, fill, fill, fill, fill, fill, fill, fill,
		fill, fill, fill, fill, fill, fill, fill, fill,
		fill, fill, fill, fill, fill, fill, fill, fill,
		fill, fill, fill, fill, fill, fill, fill, fill,
	})
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key := testKey(7)
	payload, err := Encrypt("relay-secret", key)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if !strings.HasPrefix(payload, "v1:") {
		t.Fatalf("unexpected prefix: %q", payload)
	}
	plain, err := Decrypt(payload, key)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if plain != "relay-secret" {
		t.Fatalf("round-trip = %q", plain)
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	payload, err := Encrypt("relay-secret", testKey(7))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Decrypt(payload, testKey(8)); err == nil {
		t.Fatal("expected decryption failure with a different key")
	}
}

func TestDecryptRejectsBadFormat(t *testing.T) {
	if _, err := Decrypt("plaintext", testKey(7)); err == nil {
		t.Fatal("expected invalid format error")
	}
}

func TestEncryptDecryptWithAAD(t *testing.T) {
	key := testKey(9)
	aad := "station_sources:client_password_enc:42"
	payload, err := EncryptWithAAD("mat-khau", key, aad)
	if err != nil {
		t.Fatalf("EncryptWithAAD: %v", err)
	}
	if !strings.HasPrefix(payload, "v2:0:") {
		t.Fatalf("unexpected prefix: %q", payload)
	}
	plain, err := DecryptWithAAD(payload, key, aad)
	if err != nil || plain != "mat-khau" {
		t.Fatalf("DecryptWithAAD = %q, %v", plain, err)
	}
	if _, err := DecryptWithAAD(payload, key, "station_sources:client_password_enc:43"); err == nil {
		t.Fatal("AAD khác phải decrypt fail")
	}
	if _, err := Decrypt(payload, key); err == nil {
		t.Fatal("v2 thiếu AAD phải fail")
	}
}
