//go:build windows

package runtime

import (
	"os/exec"
	"testing"
)

func TestHideConsoleWindowSetsCreateNoWindow(t *testing.T) {
	cmd := exec.Command("suna", "serve", "--json")
	hideConsoleWindow(cmd)
	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr is nil")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow = false, want true")
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatalf("CreationFlags = %#x, want CREATE_NO_WINDOW %#x", cmd.SysProcAttr.CreationFlags, createNoWindow)
	}
}

func TestHideConsoleWindowDoesNotPanicOnNil(t *testing.T) {
	hideConsoleWindow(nil)
	var cmd *exec.Cmd
	hideConsoleWindow(cmd)
}
