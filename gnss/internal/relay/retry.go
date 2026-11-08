package relay

import (
	"errors"
	"math/rand"
	"strings"
	"time"

	"cors/gnss/internal/ntrip"
)

// Chính sách retry port từ relay cũ (main.go L592-652): 3 nhánh delay, jitter
// ±10%, reset khi phiên đủ dài. Delay được suy từ RetryMin/RetryMax của job để
// test và môi trường dev vẫn chạy nhanh, nhưng giữ đúng tỷ lệ mặc định:
//
//	permanent (401/403/404/rejected/eof) → 6×min, chặn ở max (mặc định 30 s)
//	phiên < 60 s                          → 4×min (mặc định 20 s)
//	tạm thời (timeout/reset/refused/dial) → min(5 s × 2^(n-1), max)
//	còn lại                               → min(5 s × n, max)
const (
	retryStableSession = 60 * time.Second
	retryPermanentBase = 6
	retryShortBase     = 4
)

func retryBaseDelay(err error, sessionLen time.Duration, retryCount int, minimum, maximum time.Duration) time.Duration {
	if minimum <= 0 {
		minimum = 5 * time.Second
	}
	if maximum < minimum {
		maximum = minimum
	}
	if retryCount < 1 {
		retryCount = 1
	}

	capDelay := func(delay time.Duration) time.Duration {
		if delay > maximum {
			return maximum
		}
		if delay < 0 {
			return minimum
		}
		return delay
	}

	switch {
	case isPermanentError(err):
		return capDelay(minimum * retryPermanentBase)
	case sessionLen < retryStableSession:
		return capDelay(minimum * retryShortBase)
	case isTemporaryError(err):
		delay := minimum
		for i := 1; i < retryCount && delay < maximum; i++ {
			delay *= 2
		}
		return capDelay(delay)
	default:
		return capDelay(minimum * time.Duration(retryCount))
	}
}

// classifyDelay thêm jitter ±10% để tránh nhiều job retry cùng nhịp.
func classifyDelay(err error, sessionLen time.Duration, retryCount int, minimum, maximum time.Duration) time.Duration {
	base := retryBaseDelay(err, sessionLen, retryCount, minimum, maximum)
	if base <= 0 {
		return 0
	}
	jitter := time.Duration(float64(base) * 0.1 * (rand.Float64()*2 - 1))
	return base + jitter
}

func isPermanentError(err error) bool {
	if err == nil {
		return false
	}
	var status *ntrip.StatusError
	if errors.As(err, &status) {
		switch status.Code {
		case 401, 403, 404:
			return true
		}
	}
	message := strings.ToLower(err.Error())
	for _, keyword := range []string{
		"401", "403", "404", "rejected", "unauthorized", "forbidden",
		"authentication failed", "eof", "forcibly closed",
	} {
		if strings.Contains(message, keyword) {
			return true
		}
	}
	return false
}

func isTemporaryError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	for _, keyword := range []string{
		"timeout", "connection reset", "connection refused", "no route to host",
		"network is unreachable", "temporary failure", "dial tcp", "i/o timeout",
	} {
		if strings.Contains(message, keyword) {
			return true
		}
	}
	return false
}
