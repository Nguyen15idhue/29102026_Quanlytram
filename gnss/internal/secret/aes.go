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

const formatPrefix = "v1"

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

func Decrypt(payload, keyBase64 string) (string, error) {
	key, err := decodeKey(keyBase64)
	if err != nil {
		return "", err
	}
	parts := strings.Split(payload, ":")
	if len(parts) != 4 || parts[0] != formatPrefix {
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
	plaintext, err := gcm.Open(nil, nonce, append(ciphertext, tag...), nil)
	if err != nil {
		return "", errors.New("secret authentication failed")
	}
	return string(plaintext), nil
}

func Encrypt(plain, keyBase64 string) (string, error) {
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
	sealed := gcm.Seal(nil, nonce, []byte(plain), nil)
	ciphertext := sealed[:len(sealed)-gcm.Overhead()]
	tag := sealed[len(sealed)-gcm.Overhead():]
	return strings.Join([]string{
		formatPrefix,
		base64.StdEncoding.EncodeToString(nonce),
		base64.StdEncoding.EncodeToString(ciphertext),
		base64.StdEncoding.EncodeToString(tag),
	}, ":"), nil
}
