package caster

import (
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

func ParseBasic(header string) (string, string, bool) {
	if header == "" {
		return "", "", false
	}
	fields := strings.Fields(header)
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Basic") {
		return "", "", false
	}
	raw, err := base64.StdEncoding.DecodeString(fields[1])
	if err != nil {
		return "", "", false
	}
	username, password, ok := strings.Cut(string(raw), ":")
	if !ok || username == "" {
		return "", "", false
	}
	return username, password, true
}

func VerifyPassword(encoded, password string) bool {
	params, salt, expected, err := parsePHC(encoded)
	if err != nil {
		return false
	}
	actual := argon2.IDKey(
		[]byte(password),
		salt,
		params.time,
		params.memory,
		params.parallelism,
		uint32(len(expected)),
	)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

type argonParams struct {
	memory      uint32
	time        uint32
	parallelism uint8
}

func parsePHC(encoded string) (argonParams, []byte, []byte, error) {
	parts := strings.Split(strings.TrimSpace(encoded), "$")
	if len(parts) != 6 || parts[0] != "" {
		return argonParams{}, nil, nil, fmt.Errorf("invalid password hash")
	}
	if parts[1] != "argon2id" {
		return argonParams{}, nil, nil, fmt.Errorf("unsupported password hash algorithm")
	}
	if parts[2] != "v=19" {
		return argonParams{}, nil, nil, fmt.Errorf("unsupported argon2 version")
	}

	params, err := parseParams(parts[3])
	if err != nil {
		return argonParams{}, nil, nil, err
	}
	salt, err := decodeBase64(parts[4])
	if err != nil || len(salt) < 8 {
		return argonParams{}, nil, nil, fmt.Errorf("invalid argon2 salt")
	}
	expected, err := decodeBase64(parts[5])
	if err != nil || len(expected) < 16 {
		return argonParams{}, nil, nil, fmt.Errorf("invalid argon2 hash")
	}
	return params, salt, expected, nil
}

func parseParams(raw string) (argonParams, error) {
	values := make(map[string]uint64)
	for _, item := range strings.Split(raw, ",") {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			return argonParams{}, fmt.Errorf("invalid argon2 params")
		}
		parsed, err := strconv.ParseUint(value, 10, 32)
		if err != nil {
			return argonParams{}, fmt.Errorf("invalid argon2 params")
		}
		values[key] = parsed
	}
	memory := values["m"]
	iterations := values["t"]
	parallelism := values["p"]
	if memory < 8 || memory > 1_048_576 || iterations < 1 || iterations > 16 ||
		parallelism < 1 || parallelism > 16 {
		return argonParams{}, fmt.Errorf("argon2 params out of range")
	}
	return argonParams{
		memory:      uint32(memory),
		time:        uint32(iterations),
		parallelism: uint8(parallelism),
	}, nil
}

func decodeBase64(value string) ([]byte, error) {
	trimmed := strings.TrimRight(value, "=")
	decoded, err := base64.RawStdEncoding.DecodeString(trimmed)
	if err == nil {
		return decoded, nil
	}
	return base64.StdEncoding.DecodeString(value)
}
