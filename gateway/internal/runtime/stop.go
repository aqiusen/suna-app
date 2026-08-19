package runtime

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// StopDaemon 调用公开 CLI `suna stop`，请求本机 Runtime daemon 退出。
// 桌面端关窗口时应调用它，不能只靠 daemon 的 idle_exit（可能仍有残留连接）。
func StopDaemon(ctx context.Context, binary string) error {
	binary = strings.TrimSpace(binary)
	if binary == "" {
		binary = "suna"
	}
	command := runCommand(ctx, binary, "stop")
	command.Dir = runtimeCommandDirectory()
	command.Env = withoutDaemonMode(os.Environ())
	hideConsoleWindow(command)
	if err := command.Run(); err != nil {
		return fmt.Errorf("stop runtime: %w", err)
	}
	return nil
}
