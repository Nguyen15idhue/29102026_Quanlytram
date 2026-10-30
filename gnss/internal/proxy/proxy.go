package proxy

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"time"

	xproxy "golang.org/x/net/proxy"
)

func Dial(ctx context.Context, proxyURL, target string, timeout time.Duration) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: timeout}
	if proxyURL == "" {
		return dialer.DialContext(ctx, "tcp", target)
	}

	parsed, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy url")
	}
	if parsed.Scheme != "socks5" && parsed.Scheme != "socks5h" {
		return nil, fmt.Errorf("unsupported proxy scheme %q", parsed.Scheme)
	}

	var auth *xproxy.Auth
	if parsed.User != nil {
		password, _ := parsed.User.Password()
		auth = &xproxy.Auth{User: parsed.User.Username(), Password: password}
	}

	base, err := xproxy.SOCKS5("tcp", parsed.Host, auth, dialer)
	if err != nil {
		return nil, err
	}
	if contextDialer, ok := base.(xproxy.ContextDialer); ok {
		return contextDialer.DialContext(ctx, "tcp", target)
	}
	return base.Dial("tcp", target)
}
