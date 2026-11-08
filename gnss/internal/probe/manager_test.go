package probe

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

	"cors/gnss/internal/deviceprofile"
)

func TestProbeFingerprintChanges(t *testing.T) {
	lat := 21.0
	lon := 105.0
	cfg := &Config{
		ID:           1,
		StationID:    2,
		MountpointID: 3,
		Host:         "127.0.0.1",
		Port:         1509,
		Mount:        "M",
		Username:     "user",
		Password:     "pass",
		Lat:          &lat,
		Lon:          &lon,
	}
	first := probeFingerprint(cfg)
	if first == "" {
		t.Fatal("empty fingerprint")
	}
	cfg.Host = "127.0.0.2"
	if second := probeFingerprint(cfg); second == first {
		t.Fatal("fingerprint did not change when host changed")
	}
	cfg.Host = "127.0.0.1"
	cfg.Password = "pass2"
	if third := probeFingerprint(cfg); third == first {
		t.Fatal("fingerprint did not change when password changed")
	}
}

type emptyStore struct{}

func (emptyStore) LoadAll(context.Context) ([]*Config, error) { return nil, nil }

func TestProbeSendsConfiguredProfileUserAgent(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	requests := make(chan string, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 2048)
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		n, _ := conn.Read(buf)
		select {
		case requests <- string(buf[:n]):
		default:
		}
		_, _ = conn.Write([]byte("ICY 200 OK\r\n\r\n"))
	}()

	profile := deviceprofile.ResolveOrDefault("trimble_da2")
	opts := DefaultOptions()
	opts.Profile = profile
	manager := NewManager(emptyStore{}, opts)
	address := listener.Addr().(*net.TCPAddr)
	cfg := &Config{ID: 1, Host: "127.0.0.1", Port: address.Port, Mount: "M"}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = manager.connectAndRead(ctx, cfg)

	want := deviceprofile.UserAgent(profile, "", deviceprofile.Seed(profile.Code, 0, deviceprofile.RoleProbe))
	select {
	case req := <-requests:
		if !strings.Contains(req, "User-Agent: "+want+"\r\n") {
			t.Fatalf("probe UA không khớp profile:\n%s", req)
		}
		if !strings.Contains(req, "Ntrip-Version: Ntrip/1.0") {
			t.Fatalf("probe phải theo Ntrip-Version của profile:\n%s", req)
		}
		if strings.Contains(req, "CORS-MVP") {
			t.Fatalf("probe còn UA nội bộ:\n%s", req)
		}
	default:
		t.Fatal("không nhận được request của probe")
	}
}

func TestProbeProfileStableAcrossStations(t *testing.T) {
	profile := deviceprofile.ResolveOrDefault("gnss_internet_radio")
	seed := deviceprofile.Seed(profile.Code, 0, deviceprofile.RoleProbe)
	first := deviceprofile.UserAgent(profile, "", seed)
	if first != deviceprofile.UserAgent(profile, "", seed) {
		t.Fatal("UA probe phải cố định, không xoay theo phiên/trạm")
	}
}

func TestProbeDefaultProfileUsesDeviceName(t *testing.T) {
	manager := NewManager(emptyStore{}, DefaultOptions())
	profile := manager.opts.Profile
	userAgent := deviceprofile.UserAgent(
		profile, "", deviceprofile.Seed(profile.Code, 0, deviceprofile.RoleProbe),
	)
	if !strings.HasPrefix(userAgent, "GNSSInternetRadio/") {
		t.Fatalf("probe mặc định phải dùng tên thiết bị: %q", userAgent)
	}
	if strings.Contains(userAgent, "CORS-MVP") {
		t.Fatalf("probe không được dùng UA nội bộ: %q", userAgent)
	}
}

func TestReconcileBeforeRunDoesNotPanic(t *testing.T) {
	m := NewManager(emptyStore{}, DefaultOptions())
	if m.rootContext() == nil {
		t.Fatal("rootContext nil trÆ°á»›c Run")
	}
	m.Reconcile(context.Background())
}
