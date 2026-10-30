package caster

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
)

var errHeaderTooLarge = errors.New("request header too large")

type request struct {
	Method           string
	Path             string
	Mount            string
	Proto            string
	Version          string
	Header           map[string]string
	UserAgent        string
	Authorization    string
	TransferEncoding string
	ContentLength    int64
}

func readLine(br *bufio.Reader, remaining *int) (string, error) {
	var builder strings.Builder
	for {
		chunk, err := br.ReadSlice('\n')
		builder.Write(chunk)
		*remaining -= len(chunk)
		if *remaining < 0 {
			return "", errHeaderTooLarge
		}
		if err == nil {
			break
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		return "", err
	}
	return strings.TrimRight(builder.String(), "\r\n"), nil
}

func readRequest(conn net.Conn, maxHeader int) (*request, *bufio.Reader, error) {
	br := bufio.NewReaderSize(conn, 32*1024)
	remaining := maxHeader

	line, err := readLine(br, &remaining)
	if err != nil {
		return nil, br, err
	}
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return nil, br, fmt.Errorf("invalid request line")
	}

	req := &request{
		Method:        strings.ToUpper(fields[0]),
		Path:          fields[1],
		Proto:         "HTTP/1.0",
		Header:        make(map[string]string),
		ContentLength: -1,
	}
	if len(fields) >= 3 {
		req.Proto = strings.ToUpper(fields[2])
	}
	if index := strings.IndexByte(req.Path, '?'); index >= 0 {
		req.Path = req.Path[:index]
	}

	for {
		headerLine, err := readLine(br, &remaining)
		if err != nil {
			return nil, br, err
		}
		if headerLine == "" {
			break
		}
		key, value, ok := strings.Cut(headerLine, ":")
		if !ok {
			continue
		}
		lower := strings.ToLower(strings.TrimSpace(key))
		trimmed := strings.TrimSpace(value)
		if existing, exists := req.Header[lower]; exists && existing != "" {
			req.Header[lower] = existing + "," + trimmed
		} else {
			req.Header[lower] = trimmed
		}
	}

	req.UserAgent = truncate(req.Header["user-agent"], 255)
	req.Authorization = req.Header["authorization"]
	req.TransferEncoding = strings.ToLower(req.Header["transfer-encoding"])
	if raw := req.Header["content-length"]; raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed >= 0 {
			req.ContentLength = parsed
		}
	}

	mount, err := url.PathUnescape(strings.TrimPrefix(req.Path, "/"))
	if err != nil {
		return nil, br, fmt.Errorf("invalid mountpoint path")
	}
	req.Mount = strings.TrimSpace(mount)

	versionHeader := strings.ToLower(req.Header["ntrip-version"])
	if strings.Contains(versionHeader, "2.0") {
		req.Version = "v2"
	} else if req.Method == "POST" || req.Proto == "HTTP/1.1" {
		req.Version = "v2"
	} else {
		req.Version = "v1"
	}
	return req, br, nil
}

func (r *request) bodyReader(br *bufio.Reader) io.Reader {
	if strings.Contains(r.TransferEncoding, "chunked") {
		return httputil.NewChunkedReader(br)
	}
	if r.ContentLength >= 0 {
		return io.LimitReader(br, r.ContentLength)
	}
	return br
}

func (r *request) useHTTPStatus() bool {
	return r.Proto == "HTTP/1.1" || r.Version == "v2"
}

func writeStatus(conn net.Conn, req *request, code int, reason string, headers string) error {
	var builder strings.Builder
	if req != nil && req.useHTTPStatus() {
		fmt.Fprintf(&builder, "HTTP/1.1 %d %s\r\n", code, reason)
	} else {
		fmt.Fprintf(&builder, "ICY %d %s\r\n", code, reason)
	}
	builder.WriteString("Server: CORS-MVP-Caster\r\n")
	if headers != "" {
		builder.WriteString(headers)
	}
	builder.WriteString("Connection: close\r\n\r\n")
	_, err := io.WriteString(conn, builder.String())
	return err
}

func writeAuthRequired(conn net.Conn, req *request) error {
	return writeStatus(conn, req, 401, "Unauthorized", "WWW-Authenticate: Basic realm=\"NTRIP Caster\"\r\n")
}

func writeRequestError(conn net.Conn, req *request, code int, reason string) error {
	return writeStatus(conn, req, code, reason, "")
}

func writeSuccess(conn net.Conn, req *request) error {
	var builder strings.Builder
	if req.useHTTPStatus() {
		builder.WriteString("HTTP/1.1 200 OK\r\n")
		builder.WriteString("Ntrip-Version: Ntrip/2.0\r\n")
	} else {
		builder.WriteString("ICY 200 OK\r\n")
	}
	builder.WriteString("Server: CORS-MVP-Caster\r\n")
	builder.WriteString("\r\n")
	_, err := io.WriteString(conn, builder.String())
	return err
}

func buildSourcetable(mountpoints []*MountpointConfig, host string) string {
	var builder strings.Builder
	for _, mountpoint := range mountpoints {
		if mountpoint == nil || !mountpoint.Enabled {
			continue
		}
		auth := "B"
		if !mountpoint.RequiresAuth {
			auth = "N"
		}
		fmt.Fprintf(
			&builder,
			"STR;%s;%s;RTCM 3.3;1005(1),1074(1);2;GPS+GLO+GAL+BDS;%s;VNM;0.00;0.00;0;0;CORS-MVP;none;%s;N;0;\r\n",
			mountpoint.Name,
			host,
			host,
			auth,
		)
	}
	builder.WriteString("ENDSOURCETABLE\r\n")
	return builder.String()
}

func writeSourcetable(conn net.Conn, req *request, mountpoints []*MountpointConfig, host string) error {
	body := buildSourcetable(mountpoints, host)
	var builder strings.Builder
	builder.WriteString("SOURCETABLE 200 OK\r\n")
	builder.WriteString("Server: CORS-MVP-Caster\r\n")
	builder.WriteString("Content-Type: text/plain\r\n")
	fmt.Fprintf(&builder, "Content-Length: %d\r\n", len(body))
	builder.WriteString("Connection: close\r\n\r\n")
	builder.WriteString(body)
	_, err := io.WriteString(conn, builder.String())
	return err
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
