//go:build windows

package main

import (
	_ "embed"
	"os"
	"os/exec"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/installer"
)

//go:embed payload/app.zip
var payload []byte

func main() {
	ui, err := newProgressWindow()
	if err != nil {
		fatal("无法打开安装窗口。\n\n" + err.Error())
	}

	go func() {
		defer ui.quit()
		dest := installer.DefaultDir()
		ui.set(15, "正在复制程序和 Runtime…")
		if err := installer.Unpack(payload, dest); err != nil {
			fatal("安装失败：无法写出程序文件。\n\n" + err.Error())
		}
		ui.set(70, "正在创建快捷方式…")
		if err := installer.CreateShortcuts(dest); err != nil {
			fatal("程序已复制，但创建快捷方式失败。\n\n" + err.Error())
		}
		ui.set(90, "正在启动 Suna…")
		app := installer.AppExecutable(dest)
		cmd := exec.Command(app)
		cmd.Dir = dest
		if err := cmd.Start(); err != nil {
			fatal("安装完成，但无法启动 Suna。\n请从开始菜单打开。\n\n" + err.Error())
		}
		ui.set(100, "安装完成")
		time.Sleep(400 * time.Millisecond)
	}()

	ui.loop()
}

func fatal(message string) {
	messageBox(message, 0x00000010)
	os.Exit(1)
}
