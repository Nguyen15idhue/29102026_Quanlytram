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
	"net/http/httputil"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"cors/gnss/internal/proxy"
)

type Endpoint struct {
	Host      string
	Port      int
	Mount     string
	SSL       bool
	Version   string
	Username  string
	Password  string
	ProxyURL  string
	UserAgent string
	RootCAs   *x509.CertPool
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
	Proto  string
	Code   int
	Status string
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

type chunkWriter struct {
	w io.Writer
}

func (c *chunkWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if _, err := fmt.Fprintf(c.w, "%x\r\n", len(p)); err != nil {
		return 0, err
	}
	n, err := c.w.Write(p)
	if err != nil {
		return n, err
	}
	if _, err := io.WriteString(c.w, "\r\n"); err != nil {
		return n, err
	}
	return n, nil
}

func (c *chunkWriter) Close() error {
	_, err := io.WriteString(c.w, "0\r\n\r\n")
	return err
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
	line, err := br.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimRight(line, "\r\n")
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return nil, fmt.Errorf("invalid NTRIP status line")
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

func authorization(endpoint Endpoint) string {
	if endpoint.Username == "" {
		return ""
	}
	raw := endpoint.Username + ":" + endpoint.Password
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(raw))
}

func userAgent(endpoint Endpoint) string {
	if endpoint.UserAgent != "" {
		return endpoint.UserAgent
	}
	return "CORS-MVP-relay"
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

	httpVersion := "HTTP/1.0"
	if endpoint.Version == "v2" {
		httpVersion = "HTTP/1.1"
	}
	mount := strings.TrimPrefix(endpoint.Mount, "/")
	host := net.JoinHostPort(endpoint.Host, strconv.Itoa(endpoint.Port))

	var builder strings.Builder
	fmt.Fprintf(&builder, "GET /%s %s\r\n", mount, httpVersion)
	fmt.Fprintf(&builder, "Host: %s\r\n", host)
	fmt.Fprintf(&builder, "User-Agent: %s\r\n", userAgent(endpoint))
	if endpoint.Version == "v2" {
		fmt.Fprintf(&builder, "Ntrip-Version: Ntrip/2.0\r\n")
	}
	if auth := authorization(endpoint); auth != "" {
		fmt.Fprintf(&builder, "Authorization: %s\r\n", auth)
	}
	fmt.Fprintf(&builder, "Connection: close\r\n\r\n")

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
		return nil, &StatusError{Proto: response.Proto, Code: response.Code, Status: response.Status}
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
			return nil, fmt.Errorf("post failed (%v); source failed (%w)", err, sourceErr)
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
		fmt.Fprintf(&builder, "POST /%s HTTP/1.1\r\n", mount)
		fmt.Fprintf(&builder, "Host: %s\r\n", host)
		fmt.Fprintf(&builder, "Ntrip-Version: Ntrip/2.0\r\n")
		fmt.Fprintf(&builder, "User-Agent: %s\r\n", userAgent(endpoint))
		if auth := authorization(endpoint); auth != "" {
			fmt.Fprintf(&builder, "Authorization: %s\r\n", auth)
		}
		fmt.Fprintf(&builder, "Content-Type: gnss/data\r\n")
		fmt.Fprintf(&builder, "Transfer-Encoding: chunked\r\n")
		fmt.Fprintf(&builder, "Connection: close\r\n\r\n")
	} else {
		fmt.Fprintf(&builder, "SOURCE /%s HTTP/1.0\r\n", mount)
		fmt.Fprintf(&builder, "Host: %s\r\n", host)
		fmt.Fprintf(&builder, "User-Agent: %s\r\n", userAgent(endpoint))
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
		return nil, &StatusError{Proto: response.Proto, Code: response.Code, Status: response.Status}
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

	if usePost {
		return &SourceConn{Response: response, writer: &chunkWriter{w: conn}}, nil
	}
	return &SourceConn{Response: response, writer: rawWriter{w: conn}}, nil
}
