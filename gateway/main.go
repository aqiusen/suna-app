package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"mime"
	"net/url"
	"os"
	"path/filepath"
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

// PickedFile 是原生文件选择/粘贴解析的结果。Path 是本机绝对路径，
// Runtime 与 Gateway 同机可直接读取（AttachmentRef kind=path）。
type PickedFile struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	IsDir    bool   `json:"is_dir,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

// SelectFiles 打开系统多选文件对话框并返回真实本地路径。
// 仅桌面壳可用；浏览器端 window.go 不存在，前端需先判断 isNativeDesktopShell。
func (a *App) SelectFiles() ([]PickedFile, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("desktop shell not ready")
	}
	paths, err := wailsruntime.OpenMultipleFilesDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "选择文件",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "所有文件", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("open file dialog: %w", err)
	}
	files := make([]PickedFile, 0, len(paths))
	for _, path := range paths {
		files = append(files, describeLocalFile(path))
	}
	return files, nil
}

// SelectDirectory 打开系统目录选择对话框（选工作文件夹作为附件引用）。
func (a *App) SelectDirectory() ([]PickedFile, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("desktop shell not ready")
	}
	path, err := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "选择文件夹",
	})
	if err != nil {
		return nil, fmt.Errorf("open directory dialog: %w", err)
	}
	if strings.TrimSpace(path) == "" {
		return []PickedFile{}, nil
	}
	return []PickedFile{describeLocalFile(path)}, nil
}

// ResolvePastedFiles 把 WebView 粘贴事件里的 file:// URL 解析为本机路径。
// Finder 复制文件后剪贴板持有 public.file-url；浏览器场景拿不到真实路径，
// 该方法只会在桌面壳中被调用。
func (a *App) ResolvePastedFiles(fileURLs []string) ([]PickedFile, error) {
	files := make([]PickedFile, 0, len(fileURLs))
	for _, raw := range fileURLs {
		path, err := localPathFromFileURL(raw)
		if err != nil {
			continue
		}
		info, statErr := os.Stat(path)
		if statErr != nil || info.IsDir() && len(fileURLs) > 0 {
			// 目录也允许引用（交给 Runtime 决定语义），只要求存在。
			if statErr != nil {
				continue
			}
		}
		files = append(files, describeLocalFile(path))
	}
	return files, nil
}

func describeLocalFile(path string) PickedFile {
	file := PickedFile{Path: path, Name: filepath.Base(path)}
	if info, err := os.Stat(path); err == nil {
		file.IsDir = info.IsDir()
		file.Size = info.Size()
	}
	file.MimeType = mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	return file
}

// localPathFromFileURL 把 file:// URL 转回 POSIX 路径（处理百分号转义）。
func localPathFromFileURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "file" {
		return "", fmt.Errorf("not a file URL")
	}
	return filepath.Clean(parsed.Path), nil
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
			// Wails 开发模式要求 Assets 非空才会把页面转发到 Vite；生产模式使用自定义 Handler。
			Assets:  webassets.Files,
			Handler: webassets.Handler(),
		},
	})
	if err != nil {
		panic(err)
	}
}
