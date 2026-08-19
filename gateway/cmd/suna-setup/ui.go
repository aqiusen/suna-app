//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsExDlgModalFrame  = 0x00000001
	swShow             = 5
	wmDestroy          = 0x0002
	wmClose            = 0x0010
	wmSetText          = 0x000C
	wmQuit             = 0x0012
	pbmSetRange        = 0x0401
	pbmSetPos          = 0x0402
	iccProgressClass   = 0x00000020
	colorBtnFace       = 15
	idStatus           = 101
	idBar              = 102
)

var (
	user32                   = windows.NewLazySystemDLL("user32.dll")
	kernel32                 = windows.NewLazySystemDLL("kernel32.dll")
	comctl32                 = windows.NewLazySystemDLL("comctl32.dll")
	procRegisterClassExW     = user32.NewProc("RegisterClassExW")
	procCreateWindowExW      = user32.NewProc("CreateWindowExW")
	procDefWindowProcW       = user32.NewProc("DefWindowProcW")
	procGetMessageW          = user32.NewProc("GetMessageW")
	procTranslateMessage     = user32.NewProc("TranslateMessage")
	procDispatchMessageW     = user32.NewProc("DispatchMessageW")
	procShowWindow           = user32.NewProc("ShowWindow")
	procUpdateWindow         = user32.NewProc("UpdateWindow")
	procDestroyWindow        = user32.NewProc("DestroyWindow")
	procPostQuitMessage      = user32.NewProc("PostQuitMessage")
	procSetWindowTextW       = user32.NewProc("SetWindowTextW")
	procSendMessageW         = user32.NewProc("SendMessageW")
	procPostMessageW         = user32.NewProc("PostMessageW")
	procGetSystemMetrics     = user32.NewProc("GetSystemMetrics")
	procGetModuleHandleW     = kernel32.NewProc("GetModuleHandleW")
	procInitCommonControlsEx = comctl32.NewProc("InitCommonControlsEx")
	procSetFocus             = user32.NewProc("SetFocus")
	procMessageBoxW          = user32.NewProc("MessageBoxW")
)

type wndClassEx struct {
	size       uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   windows.Handle
	icon       windows.Handle
	cursor     windows.Handle
	background windows.Handle
	menuName   *uint16
	className  *uint16
	iconSm     windows.Handle
}

type msg struct {
	hwnd    windows.Handle
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
	private uint32
}

type initCommonControlsEx struct {
	size uint32
	icc  uint32
}

type progressWindow struct {
	hwnd   windows.Handle
	status windows.Handle
	bar    windows.Handle
}

func newProgressWindow() (*progressWindow, error) {
	icc := initCommonControlsEx{size: 8, icc: iccProgressClass}
	_, _, _ = procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))

	className, err := syscall.UTF16PtrFromString("SunaSetupWnd")
	if err != nil {
		return nil, err
	}
	title, err := syscall.UTF16PtrFromString("正在安装 Suna")
	if err != nil {
		return nil, err
	}
	mod, _, _ := procGetModuleHandleW.Call(0)
	wc := wndClassEx{
		size:       uint32(unsafe.Sizeof(wndClassEx{})),
		wndProc:    syscall.NewCallback(setupWndProc),
		instance:   windows.Handle(mod),
		background: windows.Handle(colorBtnFace + 1),
		className:  className,
	}
	_, _, _ = procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	const width, height = 460, 168
	screenW, _, _ := procGetSystemMetrics.Call(0)
	screenH, _, _ := procGetSystemMetrics.Call(1)
	x := (int32(screenW) - width) / 2
	y := (int32(screenH) - height) / 3

	hwnd, _, _ := procCreateWindowExW.Call(
		wsExDlgModalFrame,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
		wsOverlappedWindow&^0x00010000&^0x00020000, // 去掉最大化/最小化，只留关闭
		uintptr(x), uintptr(y), width, height,
		0, 0, mod, 0,
	)
	if hwnd == 0 {
		return nil, fmt.Errorf("create installer window failed")
	}

	heading, _ := syscall.UTF16PtrFromString("static")
	headingText, _ := syscall.UTF16PtrFromString("正在安装 Suna")
	_, _, _ = procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(heading)), uintptr(unsafe.Pointer(headingText)),
		wsChild|wsVisible, 24, 18, 400, 24, hwnd, 100, mod, 0)

	statusText, _ := syscall.UTF16PtrFromString("准备安装…")
	status, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(heading)), uintptr(unsafe.Pointer(statusText)),
		wsChild|wsVisible, 24, 52, 400, 22, hwnd, idStatus, mod, 0)

	progressClass, _ := syscall.UTF16PtrFromString("msctls_progress32")
	bar, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(progressClass)), 0,
		wsChild|wsVisible, 24, 86, 400, 22, hwnd, idBar, mod, 0)
	_, _, _ = procSendMessageW.Call(bar, pbmSetRange, 0, uintptr(100<<16))

	ui := &progressWindow{hwnd: windows.Handle(hwnd), status: windows.Handle(status), bar: windows.Handle(bar)}
	progressWnd = ui
	_, _, _ = procShowWindow.Call(hwnd, swShow)
	_, _, _ = procUpdateWindow.Call(hwnd)
	_, _, _ = procSetFocus.Call(hwnd)
	return ui, nil
}

var progressWnd *progressWindow

func setupWndProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmDestroy:
		_, _, _ = procPostQuitMessage.Call(0)
		return 0
	case wmClose:
		_, _, _ = procDestroyWindow.Call(hwnd)
		return 0
	}
	ret, _, _ := procDefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return ret
}

func (w *progressWindow) set(percent int, text string) {
	if w == nil {
		return
	}
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	ptr, err := syscall.UTF16PtrFromString(text)
	if err == nil && w.status != 0 {
		_, _, _ = procSetWindowTextW.Call(uintptr(w.status), uintptr(unsafe.Pointer(ptr)))
	}
	if w.bar != 0 {
		_, _, _ = procSendMessageW.Call(uintptr(w.bar), pbmSetPos, uintptr(percent), 0)
	}
}

func (w *progressWindow) loop() {
	var m msg
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(ret) <= 0 {
			return
		}
		_, _, _ = procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		_, _, _ = procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func (w *progressWindow) quit() {
	if w == nil || w.hwnd == 0 {
		return
	}
	// PostQuitMessage 只作用于调用线程。安装在后台 goroutine 里跑，
	// 必须给窗口发 WM_CLOSE，主线程的 GetMessage 才会退出。
	_, _, _ = procPostMessageW.Call(uintptr(w.hwnd), wmClose, 0, 0)
}

func messageBox(text string, style uintptr) {
	textPtr, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		return
	}
	titlePtr, err := syscall.UTF16PtrFromString("Suna 安装")
	if err != nil {
		return
	}
	_, _, _ = procMessageBoxW.Call(0, uintptr(unsafe.Pointer(textPtr)), uintptr(unsafe.Pointer(titlePtr)), style)
}
