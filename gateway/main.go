package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/config"
	"github.com/alanchenchen/suna-app/gateway/internal/desktopserver"
	"github.com/alanchenchen/suna-app/gateway/internal/webassets"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

var buildVersion = "dev"

type App struct {
	server     *desktopserver.Server
	gatewayURL string
	token      string
	ctx        context.Context
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	cfg := config.Default()
	cfg.ListenAddress = "127.0.0.1:0"
	token := newDesktopToken()
	server, err := desktopserver.Start(ctx, desktopserver.Options{
		Config:                cfg,
		BuildVersion:          buildVersion,
		StopRuntimeOnShutdown: true,
		DesktopToken:          token,
	})
	if err != nil {
		panic(fmt.Errorf("start desktop gateway: %w", err))
	}
	a.server = server
	a.gatewayURL = strings.TrimRight(server.PublicURL(), "/")
	a.token = token
}

func (a *App) shutdown(ctx context.Context) {
	if a.server == nil {
		return
	}
	stopCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	_ = a.server.Stop(stopCtx)
}

func (a *App) GatewayAuth() map[string]string {
	return map[string]string{
		"base_url":      a.gatewayURL,
		"desktop_token": a.token,
	}
}

func (a *App) showExistingWindow() {
	if a.ctx == nil {
		return
	}
	// 第二次启动只唤起已有窗口，不再创建新的 WebView / Gateway，避免重复点击导致窗口风暴。
	wailsruntime.WindowUnminimise(a.ctx)
	wailsruntime.WindowShow(a.ctx)
}

func newDesktopToken() string {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(fmt.Errorf("generate desktop token: %w", err))
	}
	return base64.RawURLEncoding.EncodeToString(raw[:])
}

func main() {
	app := &App{}
	err := wails.Run(&options.App{
		Title:            "Suna",
		Width:            1280,
		Height:           800,
		MinWidth:         960,
		MinHeight:        640,
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []interface{}{app},
		BackgroundColour: &options.RGBA{R: 245, G: 247, B: 251, A: 1},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "app.suna.desktop",
			OnSecondInstanceLaunch: func(_ options.SecondInstanceData) {
				app.showExistingWindow()
			},
		},
		AssetServer: &assetserver.Options{
			Handler: webassets.Handler(),
		},
	})
	if err != nil {
		panic(err)
	}
}
