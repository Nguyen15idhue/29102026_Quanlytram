package proxy

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	xproxy "golang.org/x/net/proxy"
)

const (
	// DefaultProxyDialTimeout tách khỏi timeout dial chung: handshake SOCKS5
	// phải fail nhanh (10 s) thay vì chờ hết DialTimeout của relay.
	DefaultProxyDialTimeout = 10 * time.Second
	// DefaultKeepAlive giữ kết nối TCP sống qua NAT/firewall.
	DefaultKeepAlive = 30 * time.Second
)

// DialOptions cho phép caller đổi timeout/keepalive; zero value dùng mặc định.
type DialOptions struct {
	Timeout      time.Duration
	ProxyTimeout time.Duration
	KeepAlive    time.Duration
}

func (o DialOptions) withDefaults() DialOptions {
	if o.Timeout <= 0 {
		o.Timeout = 15 * time.Second
	}
	if o.ProxyTimeout <= 0 {
		o.ProxyTimeout = DefaultProxyDialTimeout
	}
	// Proxy handshake không nên chờ lâu hơn dial chung.
	if o.Timeout > 0 && o.ProxyTimeout > o.Timeout {
		o.ProxyTimeout = o.Timeout
	}
	if o.KeepAlive <= 0 {
		o.KeepAlive = DefaultKeepAlive
	}
	return o
}

// Dial giữ chữ ký cũ: timeout là dial timeout chung, proxy dùng
// DefaultProxyDialTimeout (hoặc timeout nếu nhỏ hơn).
func Dial(ctx context.Context, proxyURL, target string, timeout time.Duration) (net.Conn, error) {
	return DialWithOptions(ctx, proxyURL, target, DialOptions{Timeout: timeout})
}

// DialWithOptions mở kết nối trực tiếp hoặc qua SOCKS5 với TCP keepalive +
// NoDelay. proxyURL nhận 3 định dạng legacy:
//
//	host:port:user:pass
//	host:port
//	socks5://[user:pass@]host:port   (và socks5h://)
func DialWithOptions(ctx context.Context, proxyURL, target string, options DialOptions) (net.Conn, error) {
	options = options.withDefaults()

	if strings.TrimSpace(proxyURL) == "" {
		dialer := &net.Dialer{Timeout: options.Timeout, KeepAlive: options.KeepAlive}
		conn, err := dialer.DialContext(ctx, "tcp", target)
		if err != nil {
			return nil, err
		}
		return tune(conn), nil
	}

	address, auth, err := parseProxy(proxyURL)
	if err != nil {
		return nil, err
	}

	dialer := &net.Dialer{Timeout: options.ProxyTimeout, KeepAlive: options.KeepAlive}
	base, err := xproxy.SOCKS5("tcp", address, auth, dialer)
	if err != nil {
		return nil, fmt.Errorf("create proxy dialer: %w", err)
	}

	proxyCtx := ctx
	if options.ProxyTimeout > 0 {
		var cancel context.CancelFunc
		proxyCtx, cancel = context.WithTimeout(ctx, options.ProxyTimeout)
		defer cancel()
	}

	var conn net.Conn
	if contextDialer, ok := base.(xproxy.ContextDialer); ok {
		conn, err = contextDialer.DialContext(proxyCtx, "tcp", target)
	} else {
		conn, err = dialContextFallback(proxyCtx, base, target)
	}
	if err != nil {
		if proxyCtx.Err() != nil && ctx.Err() == nil {
			return nil, fmt.Errorf("proxy dial timeout: %w", proxyCtx.Err())
		}
		return nil, fmt.Errorf("dial via proxy: %w", err)
	}
	return tune(conn), nil
}

// parseProxy chuẩn hoá 3 định dạng proxy về (host:port, auth). Không bao giờ
// đưa mật khẩu vào thông báo lỗi.
func parseProxy(proxyURL string) (string, *xproxy.Auth, error) {
	raw := strings.TrimSpace(proxyURL)
	if raw == "" {
		return "", nil, fmt.Errorf("empty proxy")
	}

	if strings.HasPrefix(raw, "socks5://") || strings.HasPrefix(raw, "socks5h://") {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Host == "" {
			return "", nil, fmt.Errorf("invalid proxy url")
		}
		var auth *xproxy.Auth
		if parsed.User != nil {
			password, _ := parsed.User.Password()
			auth = &xproxy.Auth{User: parsed.User.Username(), Password: password}
		}
		return parsed.Host, auth, nil
	}

	// Legacy: host:port:user:pass
	if parts := strings.Split(raw, ":"); len(parts) == 4 {
		if parts[0] == "" || parts[1] == "" {
			return "", nil, fmt.Errorf("invalid proxy format")
		}
		if _, err := strconv.Atoi(parts[1]); err != nil {
			return "", nil, fmt.Errorf("invalid proxy format")
		}
		return parts[0] + ":" + parts[1], &xproxy.Auth{User: parts[2], Password: parts[3]}, nil
	}

	// Legacy: host:port (không auth)
	if parts := strings.Split(raw, ":"); len(parts) == 2 {
		if _, err := strconv.Atoi(parts[1]); err != nil {
			return "", nil, fmt.Errorf("invalid proxy format")
		}
		return raw, nil, nil
	}

	return "", nil, fmt.Errorf("invalid proxy format")
}

// dialContextFallback dùng cho dialer không hỗ trợ context (SOCKS5 cũ).
func dialContextFallback(ctx context.Context, dialer xproxy.Dialer, target string) (net.Conn, error) {
	type result struct {
		conn net.Conn
		err  error
	}
	results := make(chan result, 1)
	go func() {
		conn, err := dialer.Dial("tcp", target)
		select {
		case <-ctx.Done():
			if conn != nil {
				_ = conn.Close()
			}
		case results <- result{conn: conn, err: err}:
		}
	}()
	select {
	case out := <-results:
		return out.conn, out.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// tune bật TCP keepalive + NoDelay cho kết nối ra.
func tune(conn net.Conn) net.Conn {
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetKeepAlive(true)
		_ = tcp.SetKeepAlivePeriod(DefaultKeepAlive)
		_ = tcp.SetNoDelay(true)
	}
	return conn
}
