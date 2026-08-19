package desktop

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

// DataDir 是 App 自己的数据目录（日志等），与 Runtime 的 ~/.suna 分开。
func DataDir() string {
	if home := os.Getenv("SUNA_APP_HOME"); home != "" {
		return home
	}
	userHome, err := os.UserHomeDir()
	if err != nil || userHome == "" {
		return ".suna-app"
	}
	return filepath.Join(userHome, ".suna-app")
}

// NewLogger 同时写 stderr 与 ~/.suna-app/logs/app.log。
// Windows GUI subsystem 没有控制台时，文件是唯一排障入口。
func NewLogger() *slog.Logger {
	writers := []io.Writer{os.Stderr}
	logDir := filepath.Join(DataDir(), "logs")
	if err := os.MkdirAll(logDir, 0o755); err == nil {
		file, err := os.OpenFile(filepath.Join(logDir, "app.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err == nil {
			writers = append(writers, file)
		}
	}
	handler := slog.NewTextHandler(io.MultiWriter(writers...), nil)
	return slog.New(handler)
}

// LogPath 返回当前日志文件路径，便于设置页提示。
func LogPath() string {
	return filepath.Join(DataDir(), "logs", "app.log")
}

func FormatLogHint() string {
	return fmt.Sprintf("logs: %s", LogPath())
}
