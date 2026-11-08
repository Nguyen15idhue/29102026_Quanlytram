package relay

import (
	"bufio"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"cors/gnss/internal/deviceprofile"
	"cors/gnss/internal/rtcm"
)

func readRequestBlock(br *bufio.Reader) string {
	var builder strings.Builder
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return builder.String()
		}
		builder.WriteString(line)
		if strings.TrimRight(line, "\r\n") == "" {
			return builder.String()
		}
	}
}

func TestResolveUserAgentProfile(t *testing.T) {
	profile := deviceprofile.ResolveOrDefault("chc_landstar")
	cfg := &JobConfig{ID: 7, DeviceProfile: profile, UAMode: "profile", UAPrefix: "NTRIP"}
	seed := deviceprofile.Seed(profile.Code, 7, deviceprofile.RoleRelay)

	want := deviceprofile.UserAgent(profile, "NTRIP", seed)
	if got := resolveUserAgent(cfg, deviceprofile.RoleRelay, 7); got != want {
		t.Fatalf("UA = %q, want %q", got, want)
	}
	if !strings.HasPrefix(want, "NTRIP CHC LandStar/") {
		t.Fatalf("UA phải bắt đầu bằng prefix + tên thiết bị: %q", want)
	}
	for _, banned := range []string{"relay", "station", "probe", "CORS-MVP"} {
		if strings.Contains(strings.ToLower(want), banned) {
			t.Fatalf("UA chứa hậu tố nội bộ %q: %q", banned, want)
		}
	}
}

func TestResolveUserAgentLiteral(t *testing.T) {
	profile := deviceprofile.ResolveOrDefault("chc_landstar")
	cfg := &JobConfig{ID: 7, DeviceProfile: profile, UAMode: "literal", UAPrefix: "  My Rover/9.9  "}
	if got := resolveUserAgent(cfg, deviceprofile.RoleRelay, 7); got != "My Rover/9.9" {
		t.Fatalf("literal UA = %q", got)
	}

	// literal rỗng không được gửi UA rỗng: rơi về UA thiết bị.
	cfg.UAPrefix = "   "
	seed := deviceprofile.Seed(profile.Code, 7, deviceprofile.RoleRelay)
	if got := resolveUserAgent(cfg, deviceprofile.RoleRelay, 7); got != deviceprofile.UserAgent(profile, "", seed) {
		t.Fatalf("literal rỗng phải rơi về UA thiết bị, got %q", got)
	}
}

func TestToNtripEndpointUsesProfile(t *testing.T) {
	trimble := deviceprofile.ResolveOrDefault("trimble_da2")
	endpoint := toNtripEndpoint(EndpointConfig{Host: "example", Port: 2101, Mount: "M"}, "Trimble DA2/6.12", trimble)
	if endpoint.Version != "v1" || endpoint.HTTPVersion != "HTTP/1.1" || endpoint.Connection != "keep-alive" {
		t.Fatalf("endpoint Trimble sai: %+v", endpoint)
	}

	// Endpoint có version tường minh thì giữ nguyên, không bị profile ghi đè.
	endpoint = toNtripEndpoint(EndpointConfig{NtripVersion: "v2"}, "ua", trimble)
	if endpoint.Version != "v2" || endpoint.HTTPVersion != "" {
		t.Fatalf("endpoint explicit version sai: %+v", endpoint)
	}
}

func TestBridgeSendsProfileHeaders(t *testing.T) {
	requests := make(chan string, 1)
	upstream := newMockServer(t, func(_ *mockServer, conn net.Conn) {
		defer conn.Close()
		block := readRequestBlock(bufio.NewReader(conn))
		select {
		case requests <- block:
		default:
		}
		_, _ = io.WriteString(conn, "ICY 200 OK\r\n\r\n")
		_, _ = conn.Write(rtcmFrame([]byte("profile-test")))
	})
	downstream := newMockServer(t, downstreamHandler(downstreamOptions{}))

	cfg := testConfig(upstream, downstream, "post")
	cfg.DeviceProfile = deviceprofile.ResolveOrDefault("trimble_da2")
	cfg.DeviceProfileID = 6
	cfg.UAMode = "profile"
	cfg.Upstream.NtripVersion = ""
	cfg.Upstream.HTTPVersion = ""
	cfg.Upstream.Connection = ""

	if err := runBridge(cfg, rtcm.NewMonitor(1<<20), &Metrics{}, 5*time.Second); !acceptableBridgeError(err) {
		t.Fatalf("RunSession: %v", err)
	}

	select {
	case block := <-requests:
		if !strings.Contains(block, "User-Agent: Trimble DA2/") {
			t.Fatalf("thiếu User-Agent theo profile:\n%s", block)
		}
		if !strings.Contains(block, "Ntrip-Version: Ntrip/1.0") {
			t.Fatalf("thiếu Ntrip-Version: Ntrip/1.0:\n%s", block)
		}
		if !strings.Contains(block, "Connection: keep-alive") {
			t.Fatalf("thiếu Connection: keep-alive:\n%s", block)
		}
		if strings.Contains(strings.ToLower(block), "-relay") || strings.Contains(block, "CORS-MVP") {
			t.Fatalf("request còn dấu vết nội bộ:\n%s", block)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for upstream request")
	}
}
