package probe

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"testing"
	"time"
)

func TestIdleUpstreamTimesOut(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		for {
			line, readErr := reader.ReadString('\n')
			if readErr != nil {
				return
			}
			if line == "\r\n" {
				break
			}
		}
		_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\n\r\n")
		time.Sleep(3 * time.Second)
	}()

	host, portText, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("port: %v", err)
	}

	manager := &Manager{opts: Options{
		PollInterval: time.Hour,
		DialTimeout:  time.Second,
		IdleTimeout:  150 * time.Millisecond,
		ReadBuffer:   1024,
		NMEAInterval: time.Hour,
		RetryMin:     time.Second,
		RetryMax:     time.Second,
	}.withDefaults()}

	start := time.Now()
	err = manager.connectAndRead(context.Background(), &Config{
		ID:         1,
		StationID:  1,
		StationRef: "S1",
		Host:       host,
		Port:       port,
		Mount:      "M",
	})
	if err == nil {
		t.Fatal("expected idle timeout error")
	}
	var netErr net.Error
	if !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("error = %v, want timeout", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("idle timeout took %v, want < 2s", elapsed)
	}
}
