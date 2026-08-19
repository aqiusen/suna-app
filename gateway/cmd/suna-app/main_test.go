package main

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 占用指定地址，返回可释放的 listener（模拟"其他程序占用了端口"）。
func occupyAddress(t *testing.T, address string) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", address)
	if err != nil {
		t.Fatalf("occupy %s: %v", address, err)
	}
	return listener
}

func TestListenWithFallback_AddressFree(t *testing.T) {
	// 先拿一个随机空闲地址，关闭后立刻监听（时间窗内几乎不可能被抢）。
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("probe listen: %v", err)
	}
	address := probe.Addr().String()
	probe.Close()

	listener, err := listenWithFallback(address, true)
	if err != nil {
		t.Fatalf("listenWithFallback(%s) = %v", address, err)
	}
	defer listener.Close()
	if got := listener.Addr().String(); got != address {
		t.Fatalf("listened on %s, want %s", got, address)
	}
}

func TestListenWithFallback_ReusesExistingSunaApp(t *testing.T) {
	// 模拟一个已有的 Suna App：/healthz 返回 200。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	host := strings.TrimPrefix(server.URL, "http://")

	if !isSunaAppRunning("http://" + host) {
		t.Fatal("isSunaAppRunning = false, want true")
	}

	_, err := listenWithFallback(host, true)
	var running instanceRunningError
	if !errors.As(err, &running) {
		t.Fatalf("listenWithFallback existing instance = %v, want instanceRunningError", err)
	}
	if !strings.HasPrefix(running.OpenURL, "http://127.0.0.1:") {
		t.Fatalf("OpenURL = %q, want loopback http URL", running.OpenURL)
	}
}

func TestListenWithFallback_OccupiedByOtherApp(t *testing.T) {
	// 占用一个随机端口（非 Suna App，无 /healthz 服务）。
	listener := occupyAddress(t, "127.0.0.1:0")
	address := listener.Addr().String()
	defer listener.Close()

	// allowFallback=true：应回退到随机端口并成功监听，且地址不同于被占用的。
	fallback, err := listenWithFallback(address, true)
	if err != nil {
		t.Fatalf("listenWithFallback(%s) with fallback = %v", address, err)
	}
	defer fallback.Close()
	if got := fallback.Addr().String(); got == address {
		t.Fatalf("fallback address = %s, want a different random port", got)
	}
	if ip, _, err := net.SplitHostPort(fallback.Addr().String()); err != nil || net.ParseIP(ip) == nil || !net.ParseIP(ip).IsLoopback() {
		t.Fatalf("fallback address %s is not loopback", fallback.Addr().String())
	}
}

// TestListenWithFallback_DefaultWildcardKeepsWildcard 验证默认 0.0.0.0 监听被占用时，
// 回退仍保持全网卡（0.0.0.0:0），不会退回 loopback 丢失局域网/Tailscale 可达性。
func TestListenWithFallback_DefaultWildcardKeepsWildcard(t *testing.T) {
	listener := occupyAddress(t, "0.0.0.0:0")
	address := listener.Addr().String()
	defer listener.Close()

	fallback, err := listenWithFallback(address, true)
	if err != nil {
		t.Fatalf("listenWithFallback(%s) with fallback = %v", address, err)
	}
	defer fallback.Close()
	ip, _, err := net.SplitHostPort(fallback.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	if parsed := net.ParseIP(ip); parsed == nil || parsed.IsLoopback() {
		t.Fatalf("fallback address %s must stay wildcard (non-loopback)", fallback.Addr().String())
	}
}

// TestProbeURLRewritesUnspecifiedHost 验证 0.0.0.0 / :: 监听地址在探测
// /healthz 前会被映射为 127.0.0.1——否则 0.0.0.0 不可路由，探测永远失败，
// 已有 Suna App 实例无法被复用（双实例回归）。
func TestProbeURLRewritesUnspecifiedHost(t *testing.T) {
	listener := occupyAddress(t, "127.0.0.1:0")
	defer listener.Close()
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })

	// 模拟默认 0.0.0.0 监听：探测地址被重写为 127.0.0.1:<port> 后可达。
	probeURL := "http://0.0.0.0:" + port
	if host, p, err := net.SplitHostPort(strings.TrimPrefix(probeURL, "http://")); err == nil {
		if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
			probeURL = "http://127.0.0.1:" + p
		}
	}
	if !isSunaAppRunning(probeURL) {
		t.Fatal("rewritten probe URL should reach the suna-app healthz endpoint")
	}
}

func TestIsLoopbackAddress(t *testing.T) {
	t.Parallel()

	cases := []struct {
		address string
		want    bool
	}{
		{address: "127.0.0.1:7633", want: true},
		{address: "[::1]:7633", want: true},
		{address: "localhost:7633", want: true},
		{address: "0.0.0.0:7633", want: false},
		{address: "192.168.1.10:7633", want: false},
		{address: "not-an-address", want: false},
	}
	for _, tc := range cases {
		if got := isLoopbackAddress(tc.address); got != tc.want {
			t.Fatalf("isLoopbackAddress(%q) = %v, want %v", tc.address, got, tc.want)
		}
	}
}

func TestListenWithFallback_ExplicitListenDoesNotFallback(t *testing.T) {
	listener := occupyAddress(t, "127.0.0.1:0")
	address := listener.Addr().String()
	defer listener.Close()

	// allowFallback=false（用户显式 --listen）：必须报错，不能静默换端口。
	_, err := listenWithFallback(address, false)
	if err == nil {
		t.Fatal("listenWithFallback with explicit listen = nil error, want EADDRINUSE")
	}
	if !isAddrInUse(err) {
		t.Fatalf("error = %v, want address-in-use", err)
	}
}

func TestIsSunaAppRunning_NonSunaServer(t *testing.T) {
	// 一个不提供 /healthz 的普通服务（模拟其他程序占用端口）。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.NotFound(w, nil)
	}))
	defer server.Close()
	host := strings.TrimPrefix(server.URL, "http://")

	if isSunaAppRunning("http://" + host) {
		t.Fatal("isSunaAppRunning = true for a non-Suna server, want false")
	}
}

func TestIsSunaAppRunning_Unreachable(t *testing.T) {
	// 无服务可连：应快速返回 false，不阻塞。
	start := time.Now()
	if isSunaAppRunning("http://127.0.0.1:1") {
		t.Fatal("isSunaAppRunning = true for unreachable address, want false")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("unreachable probe took %v, want fast failure", elapsed)
	}
}
