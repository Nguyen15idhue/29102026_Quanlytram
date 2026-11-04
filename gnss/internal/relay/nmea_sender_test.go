package relay

import (
	"bufio"
	"math/rand"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNMEAFixStateMachine(t *testing.T) {
	sender := newNMEASender(42, 21.818899, 104.6796, 5*time.Second)
	sender.rng = rand.New(rand.NewSource(7))
	now := time.Now()

	if quality, _, _, _ := sender.resolveFix(now, false); quality != fixSingle {
		t.Fatalf("no-data quality = %d, want single", quality)
	}
	quality, sats, hdop, _ := sender.resolveFix(now, true)
	if quality != fixRTKFixed && quality != fixRTKFloat && quality != fixDGPS {
		t.Fatalf("data quality = %d, want fixed/float/dgps", quality)
	}
	if sats < 4 || hdop <= 0 {
		t.Fatalf("invalid satellite/hdop: %d %.2f", sats, hdop)
	}

	// Mất dữ liệu quá 30s phải quay lại Single, không giữ Fixed giả.
	if quality, _, _, _ := sender.resolveFix(now.Add(time.Minute), false); quality != fixSingle {
		t.Fatalf("stale quality = %d, want single", quality)
	}
}

func TestNMEASentenceUsesFixQuality(t *testing.T) {
	sender := newNMEASender(1, 21.818899, 104.6796, 5*time.Second)
	single := string(sender.sentence(time.Now(), false))
	if !strings.Contains(single, ",1,") {
		t.Fatalf("initial GGA is not single: %q", single)
	}

	at := time.Now()
	for i := 0; i < 20; i++ {
		line := string(sender.sentence(at, true))
		fields := strings.Split(strings.TrimSuffix(line, "\r\n"), ",")
		switch fields[6] {
		case "4", "5", "2":
			return
		}
	}
	t.Fatal("GGA never reported fixed/float/dgps while data is fresh")
}

func TestNMEAInitialWriteReadsOnUpstream(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	sender := newNMEASender(1, 21.818899, 104.6796, time.Second)
	done := make(chan string, 1)
	go func() {
		reader := bufio.NewReader(server)
		line, _ := reader.ReadString('\n')
		done <- line
	}()
	if err := sender.sendInitial(client); err != nil {
		t.Fatalf("sendInitial: %v", err)
	}
	select {
	case line := <-done:
		if !strings.HasPrefix(line, "$GPGGA") {
			t.Fatalf("initial sentence = %q", line)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("initial GGA not written")
	}
}

func TestNMEARunSendsWhileDataFresh(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	sender := newNMEASender(1, 21.818899, 104.6796, 50*time.Millisecond)
	var lastData atomic.Int64
	lastData.Store(time.Now().UnixNano())
	errCh := make(chan error, 1)
	done := make(chan string, 2)
	go func() {
		reader := bufio.NewReader(server)
		for i := 0; i < 2; i++ {
			line, _ := reader.ReadString('\n')
			done <- line
		}
	}()
	go sender.run(t.Context(), client, &lastData, errCh)
	for i := 0; i < 2; i++ {
		select {
		case line := <-done:
			if !strings.HasPrefix(line, "$GPGGA") {
				t.Fatalf("sentence = %q", line)
			}
		case err := <-errCh:
			t.Fatalf("run error: %v", err)
		case <-time.After(3 * time.Second):
			t.Fatal("timed out waiting for periodic GGA")
		}
	}
}
