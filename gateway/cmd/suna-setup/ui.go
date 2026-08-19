//go:build windows

package main

import (
	"fmt"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wsCaption      = 0x00C00000
	wsSysMenu      = 0x00080000
	wsVisible      = 0x10000000
	wsOverlapped   = 0x00000000
	wsExAppWindow  = 0x00040000
	wsExComposited = 0x02000000
	swShow         = 5
	wmDestroy      = 0x0002
	wmClose        = 0x0010
	wmPaint        = 0x000F
	wmEraseBk      = 0x0014
	wmQuit         = 0x0012
	dtLeft         = 0x0000
	dtRight        = 0x0002
	dtSingleLine   = 0x0020
	dtVCenter      = 0x0004
	dtNoClip       = 0x0100
	fwSemibold     = 600
	fwRegular      = 400
	defaultCharset = 1
	outTTPrecis    = 4
	clipDefault    = 0
	clearTypeQ     = 5
	idcArrow       = 32512
	colorWindow    = 5
	transparent    = 1
)

// 对齐 suna-app 主题：画布、墨色、品牌蓝。
var (
	colorCanvas = rgb(245, 247, 251)
	colorInk    = rgb(23, 32, 51)
	colorMuted  = rgb(83, 97, 118)
	colorTrack  = rgb(226, 230, 239)
	colorFill   = rgb(91, 103, 241)
)

func rgb(r, g, b int) uint32 {
	return uint32(r | g<<8 | b<<16)
}

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")

	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procShowWindow       = user32.NewProc("ShowWindow")
	procUpdateWindow     = user32.NewProc("UpdateWindow")
	procDestroyWindow    = user32.NewProc("DestroyWindow")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procPostMessageW     = user32.NewProc("PostMessageW")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
	procGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
	procLoadCursorW      = user32.NewProc("LoadCursorW")
	procBeginPaint       = user32.NewProc("BeginPaint")
	procEndPaint         = user32.NewProc("EndPaint")
	procGetClientRect    = user32.NewProc("GetClientRect")
	procInvalidateRect   = user32.NewProc("InvalidateRect")
	procFillRect         = user32.NewProc("FillRect")
	procDrawTextW        = user32.NewProc("DrawTextW")
	procMessageBoxW      = user32.NewProc("MessageBoxW")
	procCreateSolidBrush = gdi32.NewProc("CreateSolidBrush")
	procCreateFontW      = gdi32.NewProc("CreateFontW")
	procSelectObject     = gdi32.NewProc("SelectObject")
	procDeleteObject     = gdi32.NewProc("DeleteObject")
	procSetBkMode        = gdi32.NewProc("SetBkMode")
	procSetTextColor     = gdi32.NewProc("SetTextColor")
	procCreatePen        = gdi32.NewProc("CreatePen")
	procRoundRect        = gdi32.NewProc("RoundRect")
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

type rect struct{ left, top, right, bottom int32 }

type paintStruct struct {
	hdc         windows.Handle
	erase       int32
	rcPaint     rect
	restore     int32
	incUpdate   int32
	rgbReserved [32]byte
}

type progressWindow struct {
	hwnd       windows.Handle
	titleFont  windows.Handle
	statusFont windows.Handle
	pctFont    windows.Handle
	mu         sync.Mutex
	percent    int
	status     string
}

func newProgressWindow() (*progressWindow, error) {
	className, err := syscall.UTF16PtrFromString("SunaSetupWnd")
	if err != nil {
		return nil, err
	}
	caption, err := syscall.UTF16PtrFromString("Suna")
	if err != nil {
		return nil, err
	}
	mod, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, uintptr(idcArrow))
	bg, _, _ := procCreateSolidBrush.Call(uintptr(colorCanvas))
	wc := wndClassEx{
		size:       uint32(unsafe.Sizeof(wndClassEx{})),
		wndProc:    syscall.NewCallback(setupWndProc),
		instance:   windows.Handle(mod),
		cursor:     windows.Handle(cursor),
		background: windows.Handle(bg),
		className:  className,
	}
	_, _, _ = procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	const width, height = 520, 220
	screenW, _, _ := procGetSystemMetrics.Call(0)
	screenH, _, _ := procGetSystemMetrics.Call(1)
	x := (int32(screenW) - width) / 2
	y := (int32(screenH) - height) / 3

	style := uintptr(wsOverlapped | wsCaption | wsSysMenu | wsVisible)
	hwnd, _, _ := procCreateWindowExW.Call(
		wsExAppWindow|wsExComposited,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(caption)),
		style,
		uintptr(x), uintptr(y), width, height,
		0, 0, mod, 0,
	)
	if hwnd == 0 {
		return nil, fmt.Errorf("create installer window failed")
	}

	ui := &progressWindow{
		hwnd:       windows.Handle(hwnd),
		titleFont:  createFont(-22, fwSemibold),
		statusFont: createFont(-15, fwRegular),
		pctFont:    createFont(-13, fwSemibold),
		status:     "正在准备…",
	}
	progressWnd = ui
	_, _, _ = procShowWindow.Call(hwnd, swShow)
	_, _, _ = procUpdateWindow.Call(hwnd)
	return ui, nil
}

func createFont(height int32, weight int32) windows.Handle {
	face, _ := syscall.UTF16PtrFromString("Segoe UI")
	h, _, _ := procCreateFontW.Call(
		uintptr(height), 0, 0, 0, uintptr(weight),
		0, 0, 0, defaultCharset, 0, clipDefault, clearTypeQ, outTTPrecis,
		uintptr(unsafe.Pointer(face)),
	)
	return windows.Handle(h)
}

var progressWnd *progressWindow

func setupWndProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmEraseBk:
		return 1
	case wmPaint:
		if progressWnd != nil {
			progressWnd.paint(windows.Handle(hwnd))
		}
		return 0
	case wmDestroy:
		if progressWnd != nil {
			progressWnd.disposeFonts()
		}
		_, _, _ = procPostQuitMessage.Call(0)
		return 0
	case wmClose:
		_, _, _ = procDestroyWindow.Call(hwnd)
		return 0
	}
	ret, _, _ := procDefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return ret
}

func (w *progressWindow) paint(hwnd windows.Handle) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&ps)))
	defer procEndPaint.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&ps)))

	var rc rect
	_, _, _ = procGetClientRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&rc)))

	bg, _, _ := procCreateSolidBrush.Call(uintptr(colorCanvas))
	_, _, _ = procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), bg)
	_, _, _ = procDeleteObject.Call(bg)
	_, _, _ = procSetBkMode.Call(hdc, transparent)

	w.mu.Lock()
	percent := w.percent
	status := w.status
	w.mu.Unlock()

	drawText(hdc, w.titleFont, colorInk, rect{40, 28, rc.right - 40, 64}, "安装 Suna", dtLeft)
	drawText(hdc, w.statusFont, colorMuted, rect{40, 72, rc.right - 100, 100}, status, dtLeft)
	drawText(hdc, w.pctFont, colorInk, rect{rc.right - 96, 72, rc.right - 40, 100}, fmt.Sprintf("%d%%", percent), dtRight)

	bar := rect{40, 128, rc.right - 40, 136}
	drawRoundBar(hdc, bar, colorTrack)
	fillW := int32(float64(bar.right-bar.left) * float64(percent) / 100)
	if fillW > 0 {
		fill := bar
		fill.right = fill.left + fillW
		if fill.right < fill.left+8 {
			fill.right = fill.left + 8
		}
		if fill.right > bar.right {
			fill.right = bar.right
		}
		drawRoundBar(hdc, fill, colorFill)
	}
}

func drawText(hdc uintptr, font windows.Handle, color uint32, r rect, text string, align uint32) {
	if font != 0 {
		_, _, _ = procSelectObject.Call(hdc, uintptr(font))
	}
	_, _, _ = procSetTextColor.Call(hdc, uintptr(color))
	utf16, err := syscall.UTF16FromString(text)
	if err != nil {
		return
	}
	_, _, _ = procDrawTextW.Call(
		hdc,
		uintptr(unsafe.Pointer(&utf16[0])),
		uintptr(len(utf16)-1),
		uintptr(unsafe.Pointer(&r)),
		uintptr(align|dtSingleLine|dtVCenter|dtNoClip),
	)
}

func drawRoundBar(hdc uintptr, r rect, color uint32) {
	brush, _, _ := procCreateSolidBrush.Call(uintptr(color))
	pen, _, _ := procCreatePen.Call(0, 1, uintptr(color))
	oldB, _, _ := procSelectObject.Call(hdc, brush)
	oldP, _, _ := procSelectObject.Call(hdc, pen)
	_, _, _ = procRoundRect.Call(hdc, uintptr(r.left), uintptr(r.top), uintptr(r.right), uintptr(r.bottom), 8, 8)
	_, _, _ = procSelectObject.Call(hdc, oldB)
	_, _, _ = procSelectObject.Call(hdc, oldP)
	_, _, _ = procDeleteObject.Call(brush)
	_, _, _ = procDeleteObject.Call(pen)
}

func (w *progressWindow) disposeFonts() {
	if w.titleFont != 0 {
		_, _, _ = procDeleteObject.Call(uintptr(w.titleFont))
		w.titleFont = 0
	}
	if w.statusFont != 0 {
		_, _, _ = procDeleteObject.Call(uintptr(w.statusFont))
		w.statusFont = 0
	}
	if w.pctFont != 0 {
		_, _, _ = procDeleteObject.Call(uintptr(w.pctFont))
		w.pctFont = 0
	}
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
	w.mu.Lock()
	w.percent = percent
	w.status = text
	w.mu.Unlock()
	if w.hwnd != 0 {
		_, _, _ = procInvalidateRect.Call(uintptr(w.hwnd), 0, 1)
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
	_, _, _ = procPostMessageW.Call(uintptr(w.hwnd), wmClose, 0, 0)
}

func messageBox(text string, style uintptr) {
	textPtr, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		return
	}
	titlePtr, err := syscall.UTF16PtrFromString("Suna")
	if err != nil {
		return
	}
	_, _, _ = procMessageBoxW.Call(0, uintptr(unsafe.Pointer(textPtr)), uintptr(unsafe.Pointer(titlePtr)), style)
}
