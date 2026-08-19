//go:build windows

package runtime

import (
	"os/exec"
	"syscall"
)

// CREATE_NO_WINDOW：GUI 进程拉起控制台子系统的 suna.exe 时，
// Windows 否则会新建一个可见黑框，daemon 还会一直占着那个窗口。
const createNoWindow = 0x08000000

func hideConsoleWindow(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
