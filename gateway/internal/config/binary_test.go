package config

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func mustAbs(t *testing.T, path string) string {
	t.Helper()
	abs, err := filepath.Abs(path)
	if err != nil {
		t.Fatal(err)
	}
	return abs
}

func writeFakeBinary(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestResolveSunaBinaryPrefersBundledRuntimeDir(t *testing.T) {
	dir := t.TempDir()
	bundled := filepath.Join(dir, "runtime", BundledRuntimeName())
	writeFakeBinary(t, bundled)
	exe := filepath.Join(dir, "suna-app")

	got := ResolveSunaBinary(DefaultSunaBinary, exe)
	if got != mustAbs(t, bundled) {
		t.Fatalf("ResolveSunaBinary() = %q, want bundled %q", got, mustAbs(t, bundled))
	}
}

func TestResolveSunaBinaryPrefersSiblingBinary(t *testing.T) {
	dir := t.TempDir()
	sibling := filepath.Join(dir, BundledRuntimeName())
	writeFakeBinary(t, sibling)
	exe := filepath.Join(dir, "suna-app")

	got := ResolveSunaBinary("suna", exe)
	if got != mustAbs(t, sibling) {
		t.Fatalf("ResolveSunaBinary() = %q, want sibling %q", got, mustAbs(t, sibling))
	}
}

func TestResolveSunaBinaryPrefersMacAppResources(t *testing.T) {
	root := t.TempDir()
	macos := filepath.Join(root, "Contents", "MacOS")
	bundled := filepath.Join(root, "Contents", "Resources", "runtime", BundledRuntimeName())
	writeFakeBinary(t, bundled)
	if err := os.MkdirAll(macos, 0o755); err != nil {
		t.Fatal(err)
	}

	got := ResolveSunaBinary("suna", filepath.Join(macos, "suna-app"))
	want, err := filepath.Abs(bundled)
	if err != nil {
		t.Fatal(err)
	}
	gotAbs, err := filepath.Abs(got)
	if err != nil {
		t.Fatal(err)
	}
	if gotAbs != want {
		t.Fatalf("ResolveSunaBinary() = %q, want macOS Resources %q", gotAbs, want)
	}
}

func TestResolveSunaBinaryAbsoluteFlagWins(t *testing.T) {
	dir := t.TempDir()
	writeFakeBinary(t, filepath.Join(dir, "runtime", BundledRuntimeName()))
	explicit := filepath.Join(dir, "custom", BundledRuntimeName())

	got := ResolveSunaBinary(explicit, filepath.Join(dir, "suna-app"))
	if got != explicit {
		t.Fatalf("ResolveSunaBinary() = %q, want explicit %q", got, explicit)
	}
}

func TestResolveSunaBinaryFallsBackToName(t *testing.T) {
	// 已安装 App 查找返回空（未安装任何 Suna.app）时，最终回退到 PATH 名。
	withInstalledAppLookup(t)
	dir := t.TempDir()
	got := ResolveSunaBinary("suna", filepath.Join(dir, "suna-app"))
	if got != "suna" {
		t.Fatalf("ResolveSunaBinary() = %q, want PATH name suna", got)
	}
}

// withInstalledAppLookup 在测试期间替换已安装 App 的查找结果，恢复交给 defer。
func withInstalledAppLookup(t *testing.T, paths ...string) {
	t.Helper()
	prev := installedAppLookup
	installedAppLookup = func() []string { return paths }
	t.Cleanup(func() { installedAppLookup = prev })
}

// TestResolveSunaBinaryFallsBackToInstalledApp 验证开发机免装回退：
// exe 旁无捆绑 Runtime 时，使用本机已安装 Suna.app 的内置 Runtime。
func TestResolveSunaBinaryFallsBackToInstalledApp(t *testing.T) {
	fake := filepath.Join(t.TempDir(), "Suna.app",
		"Contents", "Resources", "runtime", BundledRuntimeName())
	writeFakeBinary(t, fake)
	withInstalledAppLookup(t, fake)
	// exe 旁刻意不放任何捆绑 Runtime。
	exe := filepath.Join(t.TempDir(), "suna-app")

	got := ResolveSunaBinary(DefaultSunaBinary, exe)
	if got != fake {
		t.Fatalf("ResolveSunaBinary() = %q, want installed app runtime %q", got, fake)
	}
}

// TestResolveSunaBinaryPrefersBundledOverInstalledApp：捆绑布局存在时
// 必须优先于已安装 App 的 Runtime（打包产物不能被用户机器上的旧安装劫持）。
func TestResolveSunaBinaryPrefersBundledOverInstalledApp(t *testing.T) {
	installed := filepath.Join(t.TempDir(), "runtime", BundledRuntimeName())
	writeFakeBinary(t, installed)
	withInstalledAppLookup(t, installed)

	dir := t.TempDir()
	bundled := filepath.Join(dir, "runtime", BundledRuntimeName())
	writeFakeBinary(t, bundled)

	got := ResolveSunaBinary(DefaultSunaBinary, filepath.Join(dir, "suna-app"))
	if got != mustAbs(t, bundled) {
		t.Fatalf("ResolveSunaBinary() = %q, want bundled %q over installed app", got, mustAbs(t, bundled))
	}
}

func TestEnsureExecutableSetsUnixExecuteBits(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, BundledRuntimeName())
	if err := os.WriteFile(path, []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}
	EnsureExecutable(path)
	if runtime.GOOS == "windows" {
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0o111 == 0 {
		t.Fatalf("EnsureExecutable() left mode %v without execute bits", info.Mode())
	}
}

func TestBundledRuntimeName(t *testing.T) {
	name := BundledRuntimeName()
	if runtime.GOOS == "windows" {
		if name != "suna.exe" {
			t.Fatalf("BundledRuntimeName() = %q, want suna.exe", name)
		}
		return
	}
	if name != "suna" {
		t.Fatalf("BundledRuntimeName() = %q, want suna", name)
	}
}
