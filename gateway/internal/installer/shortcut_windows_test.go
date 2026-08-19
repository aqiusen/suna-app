//go:build windows

package installer

import (
	"os"
	"path/filepath"
	goruntime "runtime"
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

func TestWriteShortcutFromBackgroundGoroutine(t *testing.T) {
	dir := t.TempDir()
	lnk := filepath.Join(dir, "Suna.lnk")
	target := filepath.Join(dir, "suna-app.exe")
	if err := os.WriteFile(target, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		goruntime.LockOSThread()
		defer goruntime.UnlockOSThread()
		if err := initCOM(); err != nil {
			done <- err
			return
		}
		defer ole.CoUninitialize()
		done <- writeShortcut(lnk, target, dir)
	}()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(lnk); err != nil || info.Size() == 0 {
		t.Fatalf("background shortcut missing: %v", err)
	}
}

func oleInitForTest(t *testing.T) error {
	t.Helper()
	if err := initCOM(); err != nil {
		return err
	}
	t.Cleanup(ole.CoUninitialize)
	return nil
}
