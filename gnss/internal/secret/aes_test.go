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
