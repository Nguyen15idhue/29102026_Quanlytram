package ntrip

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http/httputil"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type testServer struct {
	listener net.Listener
	wg       sync.WaitGroup
	mu       sync.Mutex
	index    int
	handler  func(net.Conn, int)
}

func newTestServer(t *testing.T, handler func(net.Conn, int)) *testServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := &testServer{listener: listener, handler: handler}
	server.wg.Add(1)
	go func() {
		defer server.wg.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			server.mu.Lock()
			index := server.index
			server.index++
			server.mu.Unlock()
			server.wg.Add(1)
			go func() {
				defer server.wg.Done()
				_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
				handler(conn, index)
			}()
		}
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		server.wg.Wait()
	})
	return server
}

func (s *testServer) endpoint(mount string, version string) Endpoint {
	host, portValue, _ := net.SplitHostPort(s.listener.Addr().String())
	port, _ := strconv.Atoi(portValue)
	return Endpoint{Host: host, Port: port, Mount: mount, Version: version}
}

func readTestHeaders(conn net.Conn) (string, map[string]string, error) {
	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", nil, err
	}
	headers := map[string]string{}
	for {
		header, err := reader.ReadString('\n')
		if err != nil {
			return "", nil, err
		}
		header = strings.TrimRight(header, "\r\n")
		if header == "" {
			break
		}
		if key, value, ok := strings.Cut(header, ":"); ok {
			headers[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
		}
	}
	return strings.TrimRight(line, "\r\n"), headers, nil
}

func TestGetV1ICY(t *testing.T) {
	payload := []byte("RTCM-V1-PAYLOAD")
	server := newTestServer(t, func(conn net.Conn, _ int) {
		defer conn.Close()
		request, headers, err := readTestHeaders(conn)
		if err != nil {
			return
		}
		if request != "GET /MOUNT HTTP/1.0" {
			t.Errorf("request line = %q", request)
		}
		if headers["ntrip-version"] != "" {
			t.Errorf("v1 must not send Ntrip-Version")
		}
		expectedAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("user:pass"))
		if headers["authorization"] != expectedAuth {
			t.Errorf("authorization = %q", headers["authorization"])
		}
		_, _ = io.WriteString(conn, "ICY 200 OK\r\n\r\n")
		_, _ = conn.Write(payload)
	})

	endpoint := server.endpoint("MOUNT", "v1")
	endpoint.Username = "user"
	endpoint.Password = "pass"
	response, err := Get(context.Background(), endpoint, 2*time.Second)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer response.Close()
	if response.Proto != "ICY" || response.Code != 200 {
		t.Fatalf("proto/code = %s/%d", response.Proto, response.Code)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if !bytes.Equal(body, payload) {
		t.Fatalf("body = %q", body)
	}
}

func TestGetV2Chunked(t *testing.T) {
	payload := []byte("RTCM-V2-CHUNKED")
	server := newTestServer(t, func(conn net.Conn, _ int) {
		defer conn.Close()
		request, headers, err := readTestHeaders(conn)
		if err != nil {
			return
		}
		if request != "GET /M HTTP/1.1" {
			t.Errorf("request line = %q", request)
		}
		if headers["ntrip-version"] != "Ntrip/2.0" {
			t.Errorf("Ntrip-Version = %q", headers["ntrip-version"])
		}
		_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
		_, _ = fmt.Fprintf(conn, "%x\r\n", len(payload))
		_, _ = conn.Write(payload)
		_, _ = io.WriteString(conn, "\r\n0\r\n\r\n")
	})

	response, err := Get(context.Background(), server.endpoint("M", "v2"), 2*time.Second)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer response.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if !bytes.Equal(body, payload) {
		t.Fatalf("body = %q", body)
	}
}

func TestGetAuthFailure(t *testing.T) {
	server := newTestServer(t, func(conn net.Conn, _ int) {
		defer conn.Close()
		if _, _, err := readTestHeaders(conn); err != nil {
			return
		}
		_, _ = io.WriteString(conn, "ICY 401 Unauthorized\r\n\r\n")
	})
	_, err := Get(context.Background(), server.endpoint("M", "v1"), 2*time.Second)
	if err == nil {
		t.Fatal("expected auth error")
	}
	status, ok := err.(*StatusError)
	if !ok || status.Code != 401 {
		t.Fatalf("error = %v", err)
	}
}

func TestSourcePostChunked(t *testing.T) {
	payload := []byte("SOURCE-POST-DATA")
	captured := make(chan []byte, 1)
	server := newTestServer(t, func(conn net.Conn, _ int) {
		defer conn.Close()
		request, headers, err := readTestHeaders(conn)
		if err != nil {
			return
		}
		if request != "POST /M HTTP/1.1" {
			t.Errorf("request line = %q", request)
		}
		if !strings.Contains(headers["transfer-encoding"], "chunked") {
			t.Errorf("Transfer-Encoding = %q", headers["transfer-encoding"])
		}
		_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\n\r\n")
		reader := bufio.NewReader(conn)
		body, _ := io.ReadAll(httputil.NewChunkedReader(reader))
		captured <- body
	})

	source, err := Source(context.Background(), server.endpoint("M", "v2"), "post", 2*time.Second)
	if err != nil {
		t.Fatalf("Source: %v", err)
	}
	if _, err := source.Write(payload); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := source.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	select {
	case body := <-captured:
		if !bytes.Equal(body, payload) {
			t.Fatalf("captured = %q", body)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("server did not receive chunked body")
	}
}

func TestSourceAutoFallsBackToSource(t *testing.T) {
	payload := []byte("FALLBACK-DATA")
	captured := make(chan []byte, 1)
	server := newTestServer(t, func(conn net.Conn, index int) {
		defer conn.Close()
		request, _, err := readTestHeaders(conn)
		if err != nil {
			return
		}
		if index == 0 {
			if request != "POST /M HTTP/1.1" {
				t.Errorf("first request = %q", request)
			}
			_, _ = io.WriteString(conn, "HTTP/1.1 400 Bad Request\r\n\r\n")
			return
		}
		if request != "SOURCE /M HTTP/1.0" {
			t.Errorf("fallback request = %q", request)
		}
		_, _ = io.WriteString(conn, "ICY 200 OK\r\n\r\n")
		body, _ := io.ReadAll(conn)
		captured <- body
	})

	source, err := Source(context.Background(), server.endpoint("M", "v2"), "auto", 2*time.Second)
	if err != nil {
		t.Fatalf("Source auto: %v", err)
	}
	if _, err := source.Write(payload); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := source.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	select {
	case body := <-captured:
		if !bytes.Equal(body, payload) {
			t.Fatalf("captured = %q", body)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("fallback source did not receive body")
	}
}

func TestSourceRejectsSourcetable(t *testing.T) {
	server := newTestServer(t, func(conn net.Conn, _ int) {
		defer conn.Close()
		if _, _, err := readTestHeaders(conn); err != nil {
			return
		}
		_, _ = io.WriteString(conn, "SOURCETABLE 200 OK\r\nContent-Type: text/plain\r\n\r\nSTR;M;M\r\nENDSOURCETABLE\r\n")
	})
	_, err := Source(context.Background(), server.endpoint("M", "v2"), "source", 2*time.Second)
	if err == nil || !strings.Contains(err.Error(), "sourcetable") {
		t.Fatalf("error = %v, want sourcetable rejection", err)
	}
}

func TestGetTLS(t *testing.T) {
	certificate, roots := generateTLSMaterial(t)
	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{certificate},
		MinVersion:   tls.VersionTLS12,
	})
	if err != nil {
		t.Fatalf("tls listen: %v", err)
	}
	defer listener.Close()

	payload := []byte("TLS-PAYLOAD")
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := readTestHeaders(conn); err != nil {
			return
		}
		_, _ = io.WriteString(conn, "ICY 200 OK\r\n\r\n")
		_, _ = conn.Write(payload)
	}()

	host, portValue, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portValue)
	endpoint := Endpoint{
		Host: host, Port: port, Mount: "TLS", Version: "v1", SSL: true, RootCAs: roots,
	}
	response, err := Get(context.Background(), endpoint, 3*time.Second)
	if err != nil {
		t.Fatalf("Get TLS: %v", err)
	}
	defer response.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if !bytes.Equal(body, payload) {
		t.Fatalf("body = %q", body)
	}
}

func generateTLSMaterial(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	now := time.Now()
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("ca key: %v", err)
	}
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "cors-test-ca"},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("ca cert: %v", err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatalf("parse ca: %v", err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(caCert)

	serverKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("server key: %v", err)
	}
	serverTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:     []string{"localhost"},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	serverDER, err := x509.CreateCertificate(rand.Reader, serverTemplate, caCert, &serverKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("server cert: %v", err)
	}
	return tls.Certificate{Certificate: [][]byte{serverDER}, PrivateKey: serverKey}, roots
}

func TestGetReportsCasterErrorLine(t *testing.T) {
	server := newTestServer(t, func(conn net.Conn, _ int) {
		defer conn.Close()
		_, _, _ = readTestHeaders(conn)
		_, _ = io.WriteString(conn, "\r\nError: User password error!\r\n\r\nHTTP/1.1 401 Unauthorized\r\n\r\n")
	})
	_, err := Get(context.Background(), server.endpoint("MOUNT", "v1"), 2*time.Second)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "User password error") {
		t.Fatalf("error = %q", err.Error())
	}
}
