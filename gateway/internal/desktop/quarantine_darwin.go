//go:build darwin

package desktop

import "golang.org/x/sys/unix"

// ClearQuarantine 去掉下载标记。未公证的 .app 里，捆绑 Runtime 常带着
// com.apple.quarantine，exec 会被系统直接杀掉，Gateway 只能报 unavailable。
func ClearQuarantine(path string) {
	if path == "" {
		return
	}
	_ = unix.Removexattr(path, "com.apple.quarantine")
}
