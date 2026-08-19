package desktop

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// PublicOpenURL 把监听地址转成浏览器应打开的 URL。
// 0.0.0.0 / :: / loopback 一律打开 127.0.0.1，避免浏览器打不开未指定地址。
func PublicOpenURL(listenAddr string) string {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return "http://127.0.0.1:7633/"
	}
	if strings.EqualFold(host, "localhost") {
		host = "127.0.0.1"
	} else if ip := net.ParseIP(host); ip == nil || ip.IsUnspecified() || ip.IsLoopback() {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/"
}

// DesktopOpenURL 给 --app 窗口用，带 desktop=1，关窗口时前端会立刻通知 Gateway 停 daemon。
func DesktopOpenURL(listenAddr string) string {
	base := PublicOpenURL(listenAddr)
	if strings.Contains(base, "?") {
		return base + "&desktop=1"
	}
	return strings.TrimRight(base, "/") + "/?desktop=1"
}

func validateOpenURL(target string) error {
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("refusing to open non-http URL")
	}
	return nil
}
