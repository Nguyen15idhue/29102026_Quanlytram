package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http/httputil"
	"os"
	"strings"
	"time"
)

type options struct {
	addr     string
	payload  []byte
	chunked  bool
	fragment int
	delay    time.Duration
	repeat   bool
	capture  string
	timeout  time.Duration
	mount    string
	username string
	password string
}

func main() {
	mode := flag.String("mode", "caster", "caster, source or rover")
	addr := flag.String("addr", "127.0.0.1:0", "listen address for caster/source, target address for rover")
	fixture := flag.String("fixture", "scripts/fixtures/rtcm3-valid.hex", "hex fixture file")
	chunked := flag.Bool("chunked", false, "use HTTP chunked transfer encoding")
	fragment := flag.Int("fragment", 0, "bytes per write; 0 writes the whole fixture")
	delay := flag.Duration("delay", 0, "delay between writes")
	repeat := flag.Bool("repeat", false, "loop the fixture until the client disconnects")
	capture := flag.String("capture", "", "append downstream body to this file")
	out := flag.String("out", "", "write rover body to this file")
	expect := flag.String("expect", "", "rover expected fixture for byte comparison")
	timeout := flag.Duration("timeout", 30*time.Second, "connection deadline")
	mount := flag.String("mount", "UP", "mountpoint used by rover")
	username := flag.String("user", "", "NTRIP username")
	password := flag.String("pass", "", "NTRIP password")
	flag.Parse()

	payload, err := loadFixture(*fixture)
	if err != nil {
		log.Fatalf("fixture: %v", err)
	}
	if *repeat && *delay <= 0 {
		*delay = 10 * time.Millisecond
	}
	if *capture != "" {
		_ = os.Remove(*capture)
	}

	opts := options{
		addr:     *addr,
		payload:  payload,
		chunked:  *chunked,
		fragment: *fragment,
		delay:    *delay,
		repeat:   *repeat,
		capture:  *capture,
		timeout:  *timeout,
		mount:    strings.TrimPrefix(*mount, "/"),
		username: *username,
		password: *password,
	}

	switch *mode {
	case "caster":
		serve(opts, true)
	case "source":
		serve(opts, false)
	case "push":
		if err := runSource(opts); err != nil {
			log.Fatal(err)
		}
	case "rover":
		if err := runRover(opts, *out, *expect); err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatalf("unknown mode %q", *mode)
	}
}

func loadFixture(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var builder strings.Builder
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		builder.WriteString(line)
	}
	return hex.DecodeString(builder.String())
}

func serve(opts options, allowGet bool) {
	listener, err := net.Listen("tcp", opts.addr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	fmt.Printf("LISTEN %s\n", listener.Addr().String())
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("accept: %v", err)
			return
		}
		go handleServer(conn, opts, allowGet)
	}
}

func handleServer(conn net.Conn, opts options, allowGet bool) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(opts.timeout))
	reader := bufio.NewReader(conn)
	method, path, headers, err := readRequest(reader)
	if err != nil {
		return
	}
	log.Printf("%s %s", method, path)

	switch {
	case method == "GET" && allowGet:
		if strings.Contains(strings.ToUpper(path), "SOURCETABLE") {
			_, _ = io.WriteString(conn, "SOURCETABLE 200 OK\r\nContent-Type: text/plain\r\n\r\nSTR;MOCK;MOCK\r\nENDSOURCETABLE\r\n")
			return
		}
		if opts.chunked {
			_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nNtrip-Version: Ntrip/2.0\r\nTransfer-Encoding: chunked\r\n\r\n")
		} else {
			_, _ = io.WriteString(conn, "ICY 200 OK\r\nNtrip-Version: Ntrip/2.0\r\n\r\n")
		}
		stream(conn, opts)
	case method == "POST" || method == "SOURCE":
		if method == "POST" {
			_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\n\r\n")
		} else {
			_, _ = io.WriteString(conn, "ICY 200 OK\r\n\r\n")
		}
		var body io.Reader = reader
		if strings.Contains(strings.ToLower(headers["transfer-encoding"]), "chunked") {
			body = httputil.NewChunkedReader(reader)
		}
		handleUpload(conn, body, opts.capture)
	default:
		_, _ = io.WriteString(conn, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
	}
}

func readRequest(reader *bufio.Reader) (string, string, map[string]string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", "", nil, err
	}
	parts := strings.Fields(strings.TrimRight(line, "\r\n"))
	if len(parts) < 2 {
		return "", "", nil, fmt.Errorf("bad request line %q", line)
	}
	headers := map[string]string{}
	for {
		header, err := reader.ReadString('\n')
		if err != nil {
			return "", "", nil, err
		}
		header = strings.TrimRight(header, "\r\n")
		if header == "" {
			break
		}
		if key, value, ok := strings.Cut(header, ":"); ok {
			headers[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
		}
	}
	return parts[0], parts[1], headers, nil
}

func stream(conn net.Conn, opts options) {
	for {
		if err := writeFixture(conn, opts); err != nil {
			return
		}
		if !opts.repeat {
			return
		}
	}
}

func writeFixture(conn net.Conn, opts options) error {
	payload := opts.payload
	fragment := opts.fragment
	if fragment <= 0 {
		fragment = len(payload)
	}
	for start := 0; start < len(payload); start += fragment {
		end := start + fragment
		if end > len(payload) {
			end = len(payload)
		}
		chunk := payload[start:end]
		if opts.chunked {
			if _, err := fmt.Fprintf(conn, "%x\r\n", len(chunk)); err != nil {
				return err
			}
			if _, err := conn.Write(chunk); err != nil {
				return err
			}
			if _, err := io.WriteString(conn, "\r\n"); err != nil {
				return err
			}
		} else if _, err := conn.Write(chunk); err != nil {
			return err
		}
		if opts.delay > 0 {
			time.Sleep(opts.delay)
		}
	}
	if opts.chunked && !opts.repeat {
		_, err := io.WriteString(conn, "0\r\n\r\n")
		return err
	}
	return nil
}

func handleUpload(conn net.Conn, body io.Reader, capture string) {
	var target io.Writer = io.Discard
	var file *os.File
	if capture != "" {
		opened, err := os.OpenFile(capture, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			log.Printf("capture: %v", err)
		} else {
			file = opened
			target = opened
			defer file.Close()
		}
	}
	written, err := io.Copy(target, body)
	if err != nil {
		log.Printf("upload: %v after %d bytes", err, written)
	}
	log.Printf("CAPTURE %s %d bytes", capture, written)
}

func runSource(opts options) error {
	conn, err := net.DialTimeout("tcp", opts.addr, 10*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(opts.timeout))

	auth := ""
	if opts.username != "" || opts.password != "" {
		auth = fmt.Sprintf(
			"Authorization: Basic %s\r\n",
			base64.StdEncoding.EncodeToString([]byte(opts.username+":"+opts.password)),
		)
	}
	request := fmt.Sprintf(
		"SOURCE /%s HTTP/1.0\r\nHost: %s\r\nNtrip-Version: Ntrip/2.0\r\nUser-Agent: cors-mock-source\r\n%s\r\n",
		opts.mount,
		opts.addr,
		auth,
	)
	if _, err := io.WriteString(conn, request); err != nil {
		return err
	}
	reader := bufio.NewReader(conn)
	status, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	status = strings.TrimRight(status, "\r\n")
	if !strings.HasPrefix(status, "ICY 200") && !strings.HasPrefix(status, "HTTP/1.1 200") {
		return fmt.Errorf("unexpected status %q", status)
	}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return err
		}
		if strings.TrimSpace(line) == "" {
			break
		}
	}
	for {
		if err := writeFixture(conn, opts); err != nil {
			return err
		}
		if !opts.repeat {
			return nil
		}
	}
}

func runRover(opts options, out, expect string) error {
	conn, err := net.DialTimeout("tcp", opts.addr, 10*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(opts.timeout))

	auth := ""
	if opts.username != "" || opts.password != "" {
		auth = fmt.Sprintf(
			"Authorization: Basic %s\r\n",
			base64.StdEncoding.EncodeToString([]byte(opts.username+":"+opts.password)),
		)
	}
	request := fmt.Sprintf(
		"GET /%s HTTP/1.1\r\nHost: %s\r\nNtrip-Version: Ntrip/2.0\r\nUser-Agent: cors-mock-rover\r\n%s\r\n",
		opts.mount,
		opts.addr,
		auth,
	)
	if _, err := io.WriteString(conn, request); err != nil {
		return err
	}

	reader := bufio.NewReader(conn)
	status, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	status = strings.TrimRight(status, "\r\n")
	if !strings.HasPrefix(status, "ICY 200") && !strings.HasPrefix(status, "HTTP/1.1 200") {
		return fmt.Errorf("unexpected status %q", status)
	}
	headers := map[string]string{}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if key, value, ok := strings.Cut(line, ":"); ok {
			headers[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
		}
	}

	var body io.Reader = reader
	if strings.Contains(strings.ToLower(headers["transfer-encoding"]), "chunked") {
		body = httputil.NewChunkedReader(reader)
	}

	var expected []byte
	if expect != "" {
		expected, err = loadFixture(expect)
		if err != nil {
			return fmt.Errorf("expect: %w", err)
		}
	}

	var captured bytes.Buffer
	buffer := make([]byte, 32*1024)
	for {
		n, readErr := body.Read(buffer)
		if n > 0 {
			_, _ = captured.Write(buffer[:n])
		}
		if len(expected) > 0 && captured.Len() >= len(expected) {
			break
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return readErr
		}
	}

	result := captured.Bytes()
	if out != "" {
		if err := os.WriteFile(out, result, 0o644); err != nil {
			return err
		}
	}
	sum := sha256.Sum256(result)
	fmt.Printf("RECEIVED %d bytes sha256=%x\n", len(result), sum)
	if len(expected) > 0 {
		if len(result) < len(expected) {
			return fmt.Errorf("byte mismatch: got %d bytes, want at least %d", len(result), len(expected))
		}
		if !bytes.Equal(result[:len(expected)], expected) {
			return fmt.Errorf("byte mismatch: got %d bytes, want %d", len(result), len(expected))
		}
	}
	return nil
}
