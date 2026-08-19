//go:build !windows

package runtime

import "os/exec"

func hideConsoleWindow(*exec.Cmd) {}
