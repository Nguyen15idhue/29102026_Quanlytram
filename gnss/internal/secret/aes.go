package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

const (
	formatPrefixV1 = "v1"
	formatPrefixV2 = "v2"
)

func decodeKey(keyBase64 string) ([]byte, error) {
	if keyBase64 == "" {
		return nil, errors.New("APP_ENC_KEY is not configured")
	}
	key, err := base64.StdEncoding.DecodeString(keyBase64)
	if err != nil {
		return nil, errors.New("APP_ENC_KEY is not valid base64")
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("APP_ENC_KEY must decode to 32 bytes, got %d", len(key))
	}
	return key, nil
}

// Decrypt giải mã payload v1 (không AAD) hoặc v2 (có AAD rỗng không hợp lệ).
func Decrypt(payload, keyBase64 string) (string, error) {
	return decrypt(payload, keyBase64, "")
}

// DecryptWithAAD giải mã payload v2 có gắn AAD table:column:recordId.
func DecryptWithAAD(payload, keyBase64, aad string) (string, error) {
	return decrypt(payload, keyBase64, aad)
}

// DecryptRecord giải mã secret gắn với một bản ghi: v2 (có AAD) hoặc v1
// (không AAD, dữ liệu cũ). Giai đoạn chuyển tiếp v1 → v2 dùng hàm này để
// không phải rotate toàn bộ trước khi deploy.
func DecryptRecord(payload, keyBase64, aad string) (string, error) {
	if strings.HasPrefix(payload, formatPrefixV2+":") {
		return decrypt(payload, keyBase64, aad)
	}
	return decrypt(payload, keyBase64, "")
}

func decrypt(payload, keyBase64, aad string) (string, error) {
	key, err := decodeKey(keyBase64)
	if err != nil {
		return "", err
	}
	parts := strings.Split(payload, ":")
	switch parts[0] {
	case formatPrefixV1:
		if len(parts) != 4 {
			return "", errors.New("unsupported secret format")
		}
	case formatPrefixV2:
		if len(parts) != 5 || parts[1] != "0" {
			return "", errors.New("unsupported secret format")
		}
		if aad == "" {
			return "", errors.New("secret v2 requires AAD")
		}
		parts = append(parts[:1], parts[2:]...)
	default:
		return "", errors.New("unsupported secret format")
	}

	nonce, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("invalid secret nonce")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", errors.New("invalid secret ciphertext")
	}
	tag, err := base64.StdEncoding.DecodeString(parts[3])
	if err != nil {
		return "", errors.New("invalid secret tag")
	}
	if len(nonce) != 12 || len(tag) != 16 {
		return "", errors.New("invalid secret envelope")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	var additional []byte
	if aad != "" {
		additional = []byte(aad)
	}
	plaintext, err := gcm.Open(nil, nonce, append(ciphertext, tag...), additional)
	if err != nil {
		return "", errors.New("secret authentication failed")
	}
	return string(plaintext), nil
}

func Encrypt(plain, keyBase64 string) (string, error) {
	return encryptVersion(plain, keyBase64, "", formatPrefixV1)
}

// EncryptWithAAD tạo payload v2 gắn AAD table:column:recordId.
func EncryptWithAAD(plain, keyBase64, aad string) (string, error) {
	if aad == "" {
		return "", errors.New("secret v2 requires AAD")
	}
	return encryptVersion(plain, keyBase64, aad, formatPrefixV2)
}

func encryptVersion(plain, keyBase64, aad, prefix string) (string, error) {
	key, err := decodeKey(keyBase64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	var additional []byte
	if aad != "" {
		additional = []byte(aad)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plain), additional)
	ciphertext := sealed[:len(sealed)-gcm.Overhead()]
	tag := sealed[len(sealed)-gcm.Overhead():]
	parts := []string{
		prefix,
		base64.StdEncoding.EncodeToString(nonce),
		base64.StdEncoding.EncodeToString(ciphertext),
		base64.StdEncoding.EncodeToString(tag),
	}
	if prefix == formatPrefixV2 {
		parts = []string{
			prefix, "0",
			base64.StdEncoding.EncodeToString(nonce),
			base64.StdEncoding.EncodeToString(ciphertext),
			base64.StdEncoding.EncodeToString(tag),
		}
	}
	return strings.Join(parts, ":"), nil
}
