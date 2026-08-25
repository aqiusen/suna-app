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
// 再回退到本机已安装的 Suna.app 内置 Runtime（本地开发免装 CLI），
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
	// 开发模式没有正式 App Bundle，允许调用方明确指定本地构建的 Runtime。
	// 正式包仍优先使用 exe 旁的 Resources/runtime，避免被环境变量劫持。
	if envValue := strings.TrimSpace(os.Getenv("SUNA_RUNTIME")); envValue != "" {
		return envValue
	}
	// 开发机免装：回退到本机已安装 Suna.app 的内置 Runtime。
	for _, candidate := range installedAppLookup() {
		if fileExists(candidate) {
			return candidate
		}
	}
	return value
}

func bundledCandidates(exeDir string) []string {
	name := BundledRuntimeName()
	if filepath.Base(exeDir) == "MacOS" {
		// macOS 默认大小写不敏感，Contents/MacOS/Suna 与同目录的 suna
		// 会被视为同一个文件，不能把 Wails 壳自身误当成 Runtime。
		return []string{filepath.Join(exeDir, "..", "Resources", "runtime", name)}
	}
	return []string{
		filepath.Join(exeDir, "runtime", name),
		filepath.Join(exeDir, name),
	}
}

// installedAppCandidates 是 macOS 上已安装 Suna.app 的内置 Runtime 候选路径。
// 本地开发（go run）时 exe 旁没有捆绑 Runtime，也不要求把 suna 装进 PATH；
// 只要机器上装过桌面版，就直接复用它的 Runtime。仅对裸命令名回退生效，
// 不覆盖显式 --suna-binary 与捆绑布局。
// installedAppLookup 可在测试中替换，避免依赖测试机真实安装状态。
var installedAppLookup = func() []string {
	if runtime.GOOS != "darwin" {
		return nil
	}
	name := BundledRuntimeName()
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}
	return []string{
		filepath.Join(home, "Applications", "Suna.app", "Contents", "Resources", "runtime", name),
		filepath.Join("/Applications", "Suna.app", "Contents", "Resources", "runtime", name),
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// EnsureExecutable 给已解析到的捆绑 Runtime 补上执行位。
// Windows 解压再拷到 Mac 时 zip 的 Unix +x 经常丢失，exec 会变成
// "Runtime is unavailable"，尽管文件还在 Contents/Resources/runtime/suna。
func EnsureExecutable(path string) {
	path = strings.TrimSpace(path)
	if path == "" || !filepath.IsAbs(path) {
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return
	}
	_ = os.Chmod(path, info.Mode()|0o111)
}
