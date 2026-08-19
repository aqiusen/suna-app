package desktop

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// AppModeArgs 是 Chromium --app 窗口参数：无地址栏/标签，看起来像独立客户端。
func AppModeArgs(target string) []string {
	return []string{
		"--app=" + target,
		"--window-size=1280,800",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-mode",
		"--disable-features=msEdgeStartupBoost,msStartupBoost,BackgroundMode",
	}
}

// AppUserDataDir 给 --app 窗口单独的浏览器配置目录，避免挂到用户日常 Edge 进程上。
// 若复用默认 Profile，msedge 会把窗口交给已有进程并立刻退出，Gateway 会误判窗口已关。
func AppUserDataDir() string {
	return filepath.Join(DataDir(), "edge-profile")
}

func pickAppBrowser(candidates []string) (string, error) {
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("no Chromium-based browser found")
}

// StartAppWindow 用 Edge/Chrome --app 打开独立窗口，并返回可 Wait 的进程。
// 找不到 --app 浏览器时回退到系统默认打开方式，返回 cmd=nil。
func StartAppWindow(target string) (*exec.Cmd, error) {
	if err := validateOpenURL(target); err != nil {
		return nil, err
	}
	browser, err := findAppBrowser()
	if err != nil {
		return nil, openURL(target)
	}
	args := AppModeArgs(target)
	if dir := AppUserDataDir(); dir != "" {
		_ = os.MkdirAll(dir, 0o755)
		args = append(args, "--user-data-dir="+dir)
	}
	cmd := exec.Command(browser, args...)
	if err := cmd.Start(); err != nil {
		if fallback := openURL(target); fallback != nil {
			return nil, err
		}
		return nil, nil
	}
	return cmd, nil
}

// OpenURL 打开界面：优先 --app 窗口，否则系统浏览器。不等待窗口关闭。
func OpenURL(target string) error {
	_, err := StartAppWindow(target)
	return err
}
