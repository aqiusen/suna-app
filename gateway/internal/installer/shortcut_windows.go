//go:build windows

package installer

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"golang.org/x/sys/windows"
)

// CreateShortcuts 在桌面和开始菜单放 Suna 快捷方式。
// 使用 COM（WScript.Shell），不启动 PowerShell，避免安装时弹出黑框。
func CreateShortcuts(installDir string) error {
	exe := AppExecutable(installDir)
	desktop, err := userDesktop()
	if err != nil || desktop == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			if err != nil {
				return err
			}
			return homeErr
		}
		desktop = filepath.Join(home, "Desktop")
	}
	startMenu := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "Suna.lnk")
	targets := []string{
		filepath.Join(desktop, "Suna.lnk"),
		startMenu,
	}
	// COM 公寓绑定在 OS 线程上。安装器在 goroutine 里跑时，不 LockOSThread
	// 会被调度到未 CoInitialize 的线程，WScript.Shell 报「尚未调用 CoInitialize」。
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := initCOM(); err != nil {
		return fmt.Errorf("init COM: %w", err)
	}
	defer ole.CoUninitialize()
	for _, lnk := range targets {
		if err := os.MkdirAll(filepath.Dir(lnk), 0o755); err != nil {
			return err
		}
		if err := writeShortcut(lnk, exe, installDir); err != nil {
			return err
		}
	}
	return nil
}

func writeShortcut(lnk, target, workDir string) error {
	unknown, err := oleutil.CreateObject("WScript.Shell")
	if err != nil {
		return fmt.Errorf("create WScript.Shell: %w", err)
	}
	defer unknown.Release()
	shell, err := unknown.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return err
	}
	defer shell.Release()
	sc, err := oleutil.CallMethod(shell, "CreateShortcut", lnk)
	if err != nil {
		return fmt.Errorf("CreateShortcut %s: %w", lnk, err)
	}
	shortcut := sc.ToIDispatch()
	defer shortcut.Release()
	if _, err := oleutil.PutProperty(shortcut, "TargetPath", target); err != nil {
		return err
	}
	if _, err := oleutil.PutProperty(shortcut, "WorkingDirectory", workDir); err != nil {
		return err
	}
	if _, err := oleutil.PutProperty(shortcut, "WindowStyle", 1); err != nil {
		return err
	}
	if _, err := oleutil.CallMethod(shortcut, "Save"); err != nil {
		return fmt.Errorf("save shortcut %s: %w", lnk, err)
	}
	return nil
}

func initCOM() error {
	err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED)
	if err == nil {
		return nil
	}
	if retry := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); retry == nil {
		return nil
	}
	// 本线程已初始化时继续用现成公寓即可。
	if oleErr, ok := err.(*ole.OleError); ok && (oleErr.Code() == 0x00000001 || oleErr.Code() == 0x80010106) {
		return nil
	}
	return err
}

func userDesktop() (string, error) {
	return windows.KnownFolderPath(windows.FOLDERID_Desktop, 0)
}
