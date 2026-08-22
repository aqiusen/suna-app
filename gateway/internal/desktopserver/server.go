package desktopserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/bridge"
	"github.com/alanchenchen/suna-app/gateway/internal/config"
	"github.com/alanchenchen/suna-app/gateway/internal/desktop"
	"github.com/alanchenchen/suna-app/gateway/internal/httpapi"
	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
	"github.com/alanchenchen/suna-app/gateway/internal/webassets"
)

type Options struct {
	Config                config.Config
	BuildVersion          string
	StopRuntimeOnShutdown bool
	DesktopToken          string
}

type Server struct {
	httpServer            *http.Server
	listener              net.Listener
	bridge                *bridge.Service
	sunaBinary            string
	stopRuntimeOnShutdown bool
	stopOnce              sync.Once
	stopErr               error
}

func Start(ctx context.Context, opts Options) (*Server, error) {
	cfg := opts.Config
	if cfg.ListenAddress == "" {
		cfg.ListenAddress = config.DefaultListenAddress
	}
	if cfg.CommandTimeout == 0 {
		defaults := config.Default()
		cfg.CommandTimeout = defaults.CommandTimeout
		cfg.DialTimeout = defaults.DialTimeout
		cfg.HelloTimeout = defaults.HelloTimeout
	}
	version := opts.BuildVersion
	if version == "" {
		version = "dev"
	}

	exePath, err := os.Executable()
	if err != nil || strings.TrimSpace(exePath) == "" {
		exePath = os.Args[0]
	}
	cfg.SunaBinary = config.ResolveSunaBinary(cfg.SunaBinary, exePath)
	config.EnsureExecutable(cfg.SunaBinary)
	desktop.ClearQuarantine(cfg.SunaBinary)

	listener, err := net.Listen("tcp", cfg.ListenAddress)
	if err != nil {
		return nil, err
	}

	connections, err := runtime.NewConnectionManager(runtime.ManagerConfig{
		Launcher:      runtime.CommandLauncher{Binary: cfg.SunaBinary},
		LaunchTimeout: cfg.CommandTimeout,
		DialTimeout:   cfg.DialTimeout,
		HelloTimeout:  cfg.HelloTimeout,
		ClientVersion: version,
	})
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	browserBridge, err := bridge.New(bridge.RuntimeConnector{Manager: connections}, bridge.Config{})
	if err != nil {
		_ = listener.Close()
		return nil, err
	}

	server := &Server{
		listener:              listener,
		bridge:                browserBridge,
		sunaBinary:            cfg.SunaBinary,
		stopRuntimeOnShutdown: opts.StopRuntimeOnShutdown,
	}
	allowRemote := !isLoopbackAddress(cfg.ListenAddress)
	handler := httpapi.NewServerWithLifecycleAndDesktopToken(connections, cfg.CommandTimeout+cfg.DialTimeout+cfg.HelloTimeout, browserBridge, allowRemote, opts.DesktopToken, func() {
		go func() {
			stopCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			_ = server.Stop(stopCtx)
		}()
	})
	mux := http.NewServeMux()
	mux.Handle("/api/", handler)
	mux.Handle("/healthz", handler)
	mux.Handle("/", webassets.Handler())
	server.httpServer = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       30 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() { errCh <- server.httpServer.Serve(listener) }()
	go func() {
		select {
		case <-ctx.Done():
			stopCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			_ = server.Stop(stopCtx)
			cancel()
		case err := <-errCh:
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				fmt.Fprintf(os.Stderr, "suna desktop gateway stopped: %v\n", err)
			}
		}
	}()
	return server, nil
}

func (s *Server) PublicURL() string {
	return desktop.PublicOpenURL(s.listener.Addr().String())
}

func (s *Server) Stop(ctx context.Context) error {
	s.stopOnce.Do(func() {
		s.bridge.Close()
		s.stopErr = s.httpServer.Shutdown(ctx)
		if s.stopRuntimeOnShutdown {
			stopCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			s.stopErr = errors.Join(s.stopErr, runtime.StopDaemon(stopCtx, s.sunaBinary))
			cancel()
		}
	})
	return s.stopErr
}

func isLoopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
