package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/bridge"
	"github.com/alanchenchen/suna-app/gateway/internal/config"
	"github.com/alanchenchen/suna-app/gateway/internal/desktop"
	"github.com/alanchenchen/suna-app/gateway/internal/httpapi"
	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
	"github.com/alanchenchen/suna-app/gateway/internal/webassets"
)

// instanceRunningError 表示默认端口上已有本进程；调用方应打开已有 UI 而不是再起一个 Gateway。
type instanceRunningError struct {
	OpenURL string
}

func (e instanceRunningError) Error() string {
	return "suna-app is already running"
}

var buildVersion = "dev"

func main() {
	cfg := config.Default()
	noOpen := false
	flag.StringVar(&cfg.ListenAddress, "listen", cfg.ListenAddress, "HTTP listen address (default 0.0.0.0:7633)")
	flag.StringVar(&cfg.SunaBinary, "suna-binary", cfg.SunaBinary, "path to the suna executable (bundled runtime is preferred when unset)")
	flag.BoolVar(&noOpen, "no-open", false, "do not open the system browser")
	// 记录用户是否显式指定了 --listen：显式指定时不做端口回退，
	// 尊重用户意图（与 Suna Runtime 的 --listen 语义一致）。
	// 注意：flag.Visit 必须在 flag.Parse() 之后调用，否则看不到任何已设置 flag。
	flag.Parse()
	listenExplicit := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "listen" {
			listenExplicit = true
		}
	})

	exePath, err := os.Executable()
	if err != nil || strings.TrimSpace(exePath) == "" {
		exePath = os.Args[0]
	}
	cfg.SunaBinary = config.ResolveSunaBinary(cfg.SunaBinary, exePath)
	config.EnsureExecutable(cfg.SunaBinary)
	desktop.ClearQuarantine(cfg.SunaBinary)

	// 监听地址自由指定：默认 0.0.0.0 覆盖本机 loopback、局域网与 Tailscale 虚拟网
	// （手机远程场景）；显式 --listen 127.0.0.1 可退回纯本机模式。
	// 显式 --listen 时不做端口回退，尊重用户意图。

	listener, err := listenWithFallback(cfg.ListenAddress, !listenExplicit)
	if err != nil {
		var running instanceRunningError
		if errors.As(err, &running) {
			if !noOpen {
				_ = desktop.OpenURL(running.OpenURL)
			}
			os.Exit(0)
		}
		fmt.Fprintf(os.Stderr, "suna-app could not start the local server: %v\n", err)
		os.Exit(1)
	}
	defer listener.Close()
	// 回退后 cfg.ListenAddress 仍是默认值，后续打印实际监听地址时用 listener。
	actualAddress := listener.Addr().String()

	connections, err := runtime.NewConnectionManager(runtime.ManagerConfig{
		Launcher:      runtime.CommandLauncher{Binary: cfg.SunaBinary},
		LaunchTimeout: cfg.CommandTimeout,
		DialTimeout:   cfg.DialTimeout,
		HelloTimeout:  cfg.HelloTimeout,
		ClientVersion: buildVersion,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "suna-app could not configure the Runtime bridge")
		os.Exit(1)
	}
	bridgeCfg := bridge.Config{}
	if !noOpen {
		// 关窗口后 SSE 会断；2 秒无订阅即拆掉 bridge 客户端，再触发 empty idle。
		bridgeCfg.ClientIdleTimeout = 2 * time.Second
	}
	browserBridge, err := bridge.New(bridge.RuntimeConnector{Manager: connections}, bridgeCfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "suna-app could not configure the browser bridge")
		os.Exit(1)
	}
	// 非 loopback 监听时启用远程模式：CSRF 校验从"仅 loopback 同源"放宽为"任意同源"。
	// 默认 0.0.0.0 监听下总是远程模式；显式 --listen 127.0.0.1 则退回严格本机模式。
	allowRemote := !isLoopbackAddress(cfg.ListenAddress)
	shutdownCh := make(chan struct{}, 1)
	handler := httpapi.NewServerWithLifecycle(connections, cfg.CommandTimeout+cfg.DialTimeout+cfg.HelloTimeout, browserBridge, allowRemote, func() {
		select {
		case shutdownCh <- struct{}{}:
		default:
		}
	})
	mux := http.NewServeMux()
	mux.Handle("/api/", handler)
	mux.Handle("/healthz", handler)
	mux.Handle("/", webassets.Handler())
	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		// SSE is a long-lived notification stream. Do not apply a server-wide write
		// deadline here; individual non-stream HTTP handlers are bounded by request contexts.
		WriteTimeout: 0,
		IdleTimeout:  30 * time.Second,
	}

	logger := desktop.NewLogger()
	openURL := desktop.DesktopOpenURL(actualAddress)
	logger.Info("suna-app gateway started", "version", buildVersion, "address", actualAddress, "open_url", openURL, "suna_binary", cfg.SunaBinary, "log", desktop.LogPath())
	if !noOpen {
		// 关窗口后浏览器会断开 SSE/bridge；稍等避免刷新误杀，再停 Gateway 和 daemon。
		browserBridge.SetEmptyIdle(2*time.Second, func() {
			select {
			case shutdownCh <- struct{}{}:
			default:
			}
		})
		if _, err := desktop.StartAppWindow(openURL); err != nil {
			logger.Warn("could not open the app window", "error", err, "url", openURL)
		}
	}

	errCh := make(chan error, 1)
	go func() { errCh <- server.Serve(listener) }()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	stopGateway := func() {
		// 先撤销浏览器 bridge 并关闭其 Runtime socket，再停止 HTTP；避免进程退出时
		// 仍遗留 attach 或通知泵影响本地 Runtime。
		browserBridge.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("suna-app gateway shutdown failed", "error", err)
			os.Exit(1)
		}
		// 桌面关窗口必须停掉 Runtime daemon；只靠 idle_exit 时用户会看到残留 suna.exe。
		if !noOpen {
			stopCtx, stopCancel := context.WithTimeout(context.Background(), 8*time.Second)
			if err := runtime.StopDaemon(stopCtx, cfg.SunaBinary); err != nil {
				logger.Warn("runtime daemon stop failed", "error", err)
			} else {
				logger.Info("runtime daemon stopped")
			}
			stopCancel()
		}
	}
	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("suna-app gateway stopped", "error", err)
			os.Exit(1)
		}
	case <-shutdownCh:
		logger.Info("suna-app shutdown requested from local UI")
		stopGateway()
	case <-signals:
		stopGateway()
	}
}

func isLoopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	// 主机名 localhost 也是 loopback 别名（net.ParseIP 不识别字符串）。
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// listenWithFallback 在默认地址上监听；若端口被占用且 allowFallback 为真，
// 先探测占用者是否已是 Suna App（复用已有实例），否则回退到随机端口继续启动
// （对齐 Suna Runtime 的端口冲突策略；默认 0.0.0.0 监听下回退仍保持 0.0.0.0，
// 避免丢失局域网/Tailscale 可达性）。显式 --listen 时不回退。
func listenWithFallback(address string, allowFallback bool) (net.Listener, error) {
	listener, err := net.Listen("tcp", address)
	if err == nil || !allowFallback || !isAddrInUse(err) {
		return listener, err
	}
	// 占用者很可能就是另一个 Suna App 实例：探测 /healthz 确认后直接复用，
	// 不启动第二个实例（避免双实例各自 attach 同一 Runtime 会话）。
	// 注意：0.0.0.0 / :: 不是可路由目标地址，探测前须映射为 loopback，
	// 否则永远探测失败，导致双实例回归。probeURL 不含 /healthz，
	// isSunaAppRunning 内部会拼接（避免双重拼接落到 SPA fallback 误判）。
	probeURL := "http://" + address
	if host, port, err := net.SplitHostPort(address); err == nil {
		if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
			probeURL = "http://127.0.0.1:" + port
		}
	}
	if isSunaAppRunning(probeURL) {
		return nil, instanceRunningError{OpenURL: desktop.DesktopOpenURL(address)}
	}
	// 其他程序占用了默认端口：回退随机端口，实际地址由启动日志告知用户。
	// 回退保持与请求地址相同的监听范围（loopback 或全网卡）。
	fallback := "0.0.0.0:0"
	if host, _, err := net.SplitHostPort(address); err == nil {
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			fallback = "127.0.0.1:0"
		}
	}
	fmt.Fprintf(os.Stderr, "suna-app: 默认端口 %s 被其他程序占用，已改用随机端口 %s。\n", address, fallback)
	return net.Listen("tcp", fallback)
}

// isSunaAppRunning 探测目标地址是否已有 Suna App Gateway 在服务（/healthz）。
func isSunaAppRunning(baseURL string) bool {
	client := &http.Client{Timeout: 800 * time.Millisecond}
	resp, err := client.Get(baseURL + "/healthz")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
