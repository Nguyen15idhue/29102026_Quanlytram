package config

import "strings"

// UseDBTLS quyết định có bật TLS cho MySQL hay không.
// - MYSQL_TLS=true/false: ép bật/tắt.
// - auto (mặc định): bật khi host là IP public/FQDN; tắt với loopback,
//   RFC1918 và tên service nội bộ Docker (không có dấu chấm).
func (c Config) UseDBTLS() bool {
	mode := strings.ToLower(strings.TrimSpace(c.DBTLS))
	if mode == "true" {
		return true
	}
	if mode == "false" {
		return false
	}
	host := strings.TrimSpace(c.DBHost)
	if host == "" || host == "localhost" || host == "::1" {
		return false
	}
	if strings.HasPrefix(host, "127.") {
		return false
	}
	if strings.HasPrefix(host, "10.") || strings.HasPrefix(host, "192.168.") {
		return false
	}
	if strings.HasPrefix(host, "172.") {
		parts := strings.Split(host, ".")
		if len(parts) >= 2 {
			second := parts[1]
			if len(second) > 0 && second >= "16" && second <= "31" {
				return false
			}
		}
	}
	// Tên service Docker thường không có dấu chấm.
	return strings.Contains(host, ".")
}
