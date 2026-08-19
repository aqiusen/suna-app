package runtime

import (
	"context"
	"os/exec"
	"testing"
)

func TestStopDaemonRunsSunaStop(t *testing.T) {
	original := runCommand
	t.Cleanup(func() { runCommand = original })

	var gotBinary string
	var gotArgs []string
	runCommand = func(_ context.Context, name string, args ...string) *exec.Cmd {
		gotBinary = name
		gotArgs = append([]string(nil), args...)
		return exec.Command("go", "version")
	}

	if err := StopDaemon(context.Background(), `C:\Suna\runtime\suna.exe`); err != nil {
		t.Fatal(err)
	}
	if gotBinary != `C:\Suna\runtime\suna.exe` {
		t.Fatalf("binary = %q", gotBinary)
	}
	if len(gotArgs) != 1 || gotArgs[0] != "stop" {
		t.Fatalf("args = %#v, want [stop]", gotArgs)
	}
}

func TestStopDaemonUsesDefaultName(t *testing.T) {
	original := runCommand
	t.Cleanup(func() { runCommand = original })
	var gotBinary string
	runCommand = func(_ context.Context, name string, args ...string) *exec.Cmd {
		gotBinary = name
		return exec.Command("go", "version")
	}
	if err := StopDaemon(context.Background(), "  "); err != nil {
		t.Fatal(err)
	}
	if gotBinary != "suna" {
		t.Fatalf("binary = %q, want suna", gotBinary)
	}
}
