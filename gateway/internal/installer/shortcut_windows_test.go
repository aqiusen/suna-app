//go:build windows

package installer

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/go-ole/go-ole"
)

func TestUserDesktopReturnsExistingDir(t *testing.T) {
	dir, err := userDesktop()
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		t.Fatalf("userDesktop() = %q (%v), want an existing directory", dir, err)
	}
}

func TestWriteShortcutCreatesLnk(t *testing.T) {
	if err := oleInitForTest(t); err != nil {
		t.Skip(err)
	}
	dir := t.TempDir()
	lnk := filepath.Join(dir, "Suna.lnk")
	target := filepath.Join(dir, "suna-app.exe")
	if err := os.WriteFile(target, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writeShortcut(lnk, target, dir); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(lnk)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() == 0 {
		t.Fatal("shortcut file is empty")
	}
}

func oleInitForTest(t *testing.T) error {
	t.Helper()
	if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
		return err
	}
	t.Cleanup(ole.CoUninitialize)
	return nil
}
