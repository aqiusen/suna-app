package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// BundledRuntimeName is the Runtime executable name for this OS.
func BundledRuntimeName() string {
	if runtime.GOOS == "windows" {
		return "suna.exe"
	}
	return "suna"
}

// ResolveSunaBinary 按桌面包布局解析 Runtime 路径。
// 用户给出绝对路径或带分隔符的路径时原样使用；否则优先安装目录旁的捆绑二进制，
// 最后才回退到 PATH 上的命令名（开发机）。
func ResolveSunaBinary(flagValue, exePath string) string {
	value := strings.TrimSpace(flagValue)
	if value == "" {
		value = DefaultSunaBinary
	}
	if filepath.IsAbs(value) || strings.ContainsAny(value, `/\`) {
		return value
	}

	dir := filepath.Dir(exePath)
	if dir == "" || dir == "." {
		return value
	}
	for _, candidate := range bundledCandidates(dir) {
		if fileExists(candidate) {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
	}
	return value
}

func bundledCandidates(exeDir string) []string {
	name := BundledRuntimeName()
	var candidates []string
	if filepath.Base(exeDir) == "MacOS" {
		candidates = append(candidates, filepath.Join(exeDir, "..", "Resources", "runtime", name))
	}
	candidates = append(candidates,
		filepath.Join(exeDir, "runtime", name),
		filepath.Join(exeDir, name),
	)
	return candidates
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
