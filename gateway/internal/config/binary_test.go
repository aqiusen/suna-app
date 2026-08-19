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
	dir := t.TempDir()
	got := ResolveSunaBinary("suna", filepath.Join(dir, "suna-app"))
	if got != "suna" {
		t.Fatalf("ResolveSunaBinary() = %q, want PATH name suna", got)
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
