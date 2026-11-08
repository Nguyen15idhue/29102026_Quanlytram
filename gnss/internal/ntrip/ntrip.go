package ntrip

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"cors/gnss/internal/proxy"
)

type Endpoint struct {
	Host        string
	Port        int
	Mount       string
	SSL         bool
	Version     string
	HTTPVersion string
	Connection  string
	Username    string
	Password    string
	ProxyURL    string
	UserAgent   string
	RootCAs     *x509.CertPool
}

type Response struct {
	Proto  string
	Code   int
	Status string
	Header textproto.MIMEHeader
	Body   io.Reader
	Conn   net.Conn
}

func (r *Response) Close() error {
	if r == nil || r.Conn == nil {
		return nil
	}
	return r.Conn.Close()
}

type StatusError struct {
	Proto      string
	Code       int
	Status     string
	RetryAfter time.Duration
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("ntrip status %s %d %s", e.Proto, e.Code, e.Status)
}

type SourceConn struct {
	*Response
	writer io.WriteCloser
}

func (s *SourceConn) Write(p []byte) (int, error) {
	return s.writer.Write(p)
}

func (s *SourceConn) Close() error {
	writerErr := s.writer.Close()
	connErr := s.Response.Close()
	if writerErr != nil {
		return writerErr
	}
	return connErr
}

type rawWriter struct {
	w io.Writer
}

func (r rawWriter) Write(p []byte) (int, error) {
	return r.w.Write(p)
}

func (r rawWriter) Close() error {
	return nil
}

func dialEndpoint(ctx context.Context, endpoint Endpoint, timeout time.Duration) (net.Conn, error) {
	address := net.JoinHostPort(endpoint.Host, strconv.Itoa(endpoint.Port))
	conn, err := proxy.Dial(ctx, endpoint.ProxyURL, address, timeout)
	if err != nil {
		return nil, err
	}
	if !endpoint.SSL {
		return conn, nil
	}

	tlsConn := tls.Client(conn, &tls.Config{
		ServerName: endpoint.Host,
		RootCAs:    endpoint.RootCAs,
		MinVersion: tls.VersionTLS12,
	})
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		conn.Close()
		return nil, err
	}
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		conn.Close()
		return nil, err
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		conn.Close()
		return nil, err
	}
	return tlsConn, nil
}

func readHeaders(br *bufio.Reader) (textproto.MIMEHeader, error) {
	header := make(textproto.MIMEHeader)
	for {
		first, err := br.Peek(1)
		if err != nil {
			return header, err
		}
		if first[0] == '\r' || first[0] == '\n' {
			_, err := br.ReadString('\n')
			return header, err
		}
		if first[0] < 0x20 || first[0] > 0x7E {
			return header, nil
		}
		line, err := br.ReadString('\n')
		if err != nil {
			return header, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			return header, nil
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		header.Add(strings.TrimSpace(key), strings.TrimSpace(value))
	}
}

func bodyReader(br *bufio.Reader, header textproto.MIMEHeader) io.Reader {
	transferEncoding := strings.ToLower(strings.Join(header.Values("Transfer-Encoding"), ","))
	if strings.Contains(transferEncoding, "chunked") {
		return httputil.NewChunkedReader(br)
	}
	if raw := header.Get("Content-Length"); raw != "" {
		if length, err := strconv.ParseInt(raw, 10, 64); err == nil && length >= 0 {
			return io.LimitReader(br, length)
		}
	}
	return br
}

func readResponse(br *bufio.Reader) (*Response, error) {
	var line string
	for {
		raw, err := br.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(raw, "\r\n")
		if line == "" {
			continue
		}
		if strings.HasPrefix(strings.ToLower(line), "error:") {
			return nil, fmt.Errorf("%s", line)
		}
		break
	}
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return nil, fmt.Errorf("invalid NTRIP status line %q", line)
	}

	proto := fields[0]
	switch {
	case proto == "ICY":
	case proto == "SOURCETABLE":
	case strings.HasPrefix(proto, "HTTP/"):
		proto = "HTTP"
	default:
		return nil, fmt.Errorf("unexpected NTRIP status protocol %q", fields[0])
	}

	code, err := strconv.Atoi(fields[1])
	if err != nil {
		return nil, fmt.Errorf("invalid NTRIP status code")
	}
	status := strings.Join(fields[2:], " ")

	header, err := readHeaders(br)
	if err != nil {
		return nil, err
	}
	return &Response{
		Proto:  proto,
		Code:   code,
		Status: status,
		Header: header,
		Body:   bodyReader(br, header),
	}, nil
}

func retryAfter(header textproto.MIMEHeader) time.Duration {
	raw := strings.TrimSpace(header.Get("Retry-After"))
	if raw == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(raw); err == nil {
		if seconds <= 0 {
			return 0
		}
		return time.Duration(seconds) * time.Second
	}
	if when, err := http.ParseTime(raw); err == nil {
		delay := time.Until(when)
		if delay > 0 {
			return delay
		}
	}
	return 0
}

func authorization(endpoint Endpoint) string {
	if endpoint.Username == "" {
		return ""
	}
	raw := endpoint.Username + ":" + endpoint.Password
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(raw))
}

// userAgent chỉ dùng đúng giá trị caller truyền vào (đã resolve từ device
// profile). Rỗng thì bỏ header thay vì gửi chuỗi nội bộ (D19-2).
func userAgent(endpoint Endpoint) string {
	return strings.TrimSpace(endpoint.UserAgent)
}

// ntripVersionHeader map cột ntrip_version sang giá trị header NTRIP.
func ntripVersionHeader(version string) string {
	switch strings.ToLower(strings.TrimSpace(version)) {
	case "v1":
		return "Ntrip/1.0"
	case "", "v2":
		return "Ntrip/2.0"
	default:
		return ""
	}
}

// requestHTTPVersion ưu tiên HTTPVersion do profile quyết định, ngược lại giữ
// hành vi cũ (v2 = HTTP/1.1, còn lại HTTP/1.0).
func requestHTTPVersion(endpoint Endpoint) string {
	if endpoint.HTTPVersion != "" {
		return endpoint.HTTPVersion
	}
	if strings.EqualFold(endpoint.Version, "v2") {
		return "HTTP/1.1"
	}
	return "HTTP/1.0"
}

// connectionHeader mặc định close; chỉ keep-alive khi profile yêu cầu.
func connectionHeader(endpoint Endpoint) string {
	if strings.EqualFold(endpoint.Connection, "keep-alive") {
		return "keep-alive"
	}
	return "close"
}

func writeRequest(w io.Writer, request string) error {
	_, err := io.WriteString(w, request)
	return err
}

func Get(ctx context.Context, endpoint Endpoint, timeout time.Duration) (*Response, error) {
	conn, err := dialEndpoint(ctx, endpoint, timeout)
	if err != nil {
		return nil, err
	}

	httpVersion := requestHTTPVersion(endpoint)
	mount := strings.TrimPrefix(endpoint.Mount, "/")
	host := net.JoinHostPort(endpoint.Host, strconv.Itoa(endpoint.Port))

	var builder strings.Builder
	fmt.Fprintf(&builder, "GET /%s %s\r\n", mount, httpVersion)
	fmt.Fprintf(&builder, "Host: %s\r\n", host)
	if ua := userAgent(endpoint); ua != "" {
		fmt.Fprintf(&builder, "User-Agent: %s\r\n", ua)
	}
	if header := ntripVersionHeader(endpoint.Version); header != "" {
		fmt.Fprintf(&builder, "Ntrip-Version: %s\r\n", header)
	}
	if auth := authorization(endpoint); auth != "" {
		fmt.Fprintf(&builder, "Authorization: %s\r\n", auth)
	}
	fmt.Fprintf(&builder, "Connection: %s\r\n\r\n", connectionHeader(endpoint))

	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		conn.Close()
		return nil, err
	}
	if err := writeRequest(conn, builder.String()); err != nil {
		conn.Close()
		return nil, err
	}

	br := bufio.NewReaderSize(conn, 32*1024)
	response, err := readResponse(br)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if response.Code != 200 {
		conn.Close()
		return nil, &StatusError{
			Proto:      response.Proto,
			Code:       response.Code,
			Status:     response.Status,
			RetryAfter: retryAfter(response.Header),
		}
	}
	if response.Proto == "SOURCETABLE" {
		conn.Close()
		return nil, fmt.Errorf("unexpected sourcetable response for mountpoint GET")
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		conn.Close()
		return nil, err
	}
	response.Conn = conn
	return response, nil
}

func Source(ctx context.Context, endpoint Endpoint, mode string, timeout time.Duration) (*SourceConn, error) {
	switch mode {
	case "source":
		return openSource(ctx, endpoint, false, timeout)
	case "post":
		return openSource(ctx, endpoint, true, timeout)
	case "", "auto":
		conn, err := openSource(ctx, endpoint, true, timeout)
		if err == nil {
			return conn, nil
		}
		if ctx.Err() != nil {
			return nil, err
		}
		conn, sourceErr := openSource(ctx, endpoint, false, timeout)
		if sourceErr != nil {
			return nil, fmt.Errorf("post failed: %w; source failed: %w", err, sourceErr)
		}
		return conn, nil
	default:
		return nil, fmt.Errorf("unsupported downstream mode %q", mode)
	}
}

func openSource(ctx context.Context, endpoint Endpoint, usePost bool, timeout time.Duration) (*SourceConn, error) {
	conn, err := dialEndpoint(ctx, endpoint, timeout)
	if err != nil {
		return nil, err
	}

	mount := strings.TrimPrefix(endpoint.Mount, "/")
	host := net.JoinHostPort(endpoint.Host, strconv.Itoa(endpoint.Port))

	var builder strings.Builder
	if usePost {
		fmt.Fprintf(&builder, "POST /%s %s\r\n", mount, requestHTTPVersion(endpoint))
		fmt.Fprintf(&builder, "Host: %s\r\n", host)
		if header := ntripVersionHeader(endpoint.Version); header != "" {
			fmt.Fprintf(&builder, "Ntrip-Version: %s\r\n", header)
		}
		if ua := userAgent(endpoint); ua != "" {
			fmt.Fprintf(&builder, "User-Agent: %s\r\n", ua)
		}
		if auth := authorization(endpoint); auth != "" {
			fmt.Fprintf(&builder, "Authorization: %s\r\n", auth)
		}
		fmt.Fprintf(&builder, "Content-Type: application/octet-stream\r\n")
		fmt.Fprintf(&builder, "Connection: %s\r\n\r\n", connectionHeader(endpoint))
	} else {
		fmt.Fprintf(&builder, "SOURCE /%s HTTP/1.0\r\n", mount)
		fmt.Fprintf(&builder, "Host: %s\r\n", host)
		if ua := userAgent(endpoint); ua != "" {
			fmt.Fprintf(&builder, "User-Agent: %s\r\n", ua)
		}
		if auth := authorization(endpoint); auth != "" {
			fmt.Fprintf(&builder, "Authorization: %s\r\n", auth)
		}
		fmt.Fprintf(&builder, "Connection: close\r\n\r\n")
	}

	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		conn.Close()
		return nil, err
	}
	if err := writeRequest(conn, builder.String()); err != nil {
		conn.Close()
		return nil, err
	}

	br := bufio.NewReaderSize(conn, 32*1024)
	response, err := readResponse(br)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if response.Code != 200 {
		conn.Close()
		return nil, &StatusError{
			Proto:      response.Proto,
			Code:       response.Code,
			Status:     response.Status,
			RetryAfter: retryAfter(response.Header),
		}
	}
	if response.Proto == "SOURCETABLE" {
		conn.Close()
		return nil, fmt.Errorf("unexpected sourcetable response for source request")
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		conn.Close()
		return nil, err
	}
	response.Conn = conn

	// NTRIP source gửi byte thô sau header, không dùng chunked. CGBAS và
	// nhiều caster thực tế (gồm rtk.taikhoandodac.vn) không nhận chunk framing
	// ở chiều upload.
	return &SourceConn{Response: response, writer: rawWriter{w: conn}}, nil
}
