#!/bin/bash
# 双击安装：去掉隔离标记、补执行权限、拷进应用程序并打开。
# 第一次可能仍要右键 → 打开（系统对从网上下载的脚本的限制）。
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"
APP="Suna.app"

show_error() {
  local message="$1"
  osascript -e "display alert \"Suna 安装失败\" message \"$message\" as critical" >/dev/null 2>&1 || true
  printf '%s\n' "$message" >&2
}

binary_arch() {
  local binary="$1"
  local info
  info="$(file "$binary")"
  case "$info" in
    *"arm64"*) printf '%s\n' "arm64" ;;
    *"x86_64"*) printf '%s\n' "amd64" ;;
    *)
      show_error "无法识别 $binary 的 CPU 架构。请重新下载 Suna 安装包。"
      exit 1
      ;;
  esac
}

host_arch() {
  case "$(uname -m)" in
    arm64) printf '%s\n' "arm64" ;;
    x86_64) printf '%s\n' "amd64" ;;
    *)
      show_error "无法识别当前 Mac 的 CPU 架构。请手动确认下载的 Suna 安装包是否匹配。"
      exit 1
      ;;
  esac
}

if [ ! -d "$APP" ]; then
  show_error "找不到 Suna.app。请让 Suna.app 和 Install Suna.command 保持在同一个 DMG 窗口里。"
  exit 1
fi

APP_BINARY="$APP/Contents/MacOS/suna-app"
RUNTIME_BINARY="$APP/Contents/Resources/runtime/suna"
if [ ! -f "$APP_BINARY" ] || [ ! -f "$RUNTIME_BINARY" ]; then
  show_error "安装包不完整，缺少 Suna App 或 Runtime 二进制。请重新下载。"
  exit 1
fi

# macOS 的 amd64 包只能在 Intel Mac 或安装了 Rosetta 的 Apple Silicon Mac 上运行。
# 用户最常见的问题是 M 系列 Mac 误下载 darwin-amd64.dmg，这里提前给出可读提示。
CURRENT_ARCH="$(host_arch)"
APP_ARCH="$(binary_arch "$APP_BINARY")"
RUNTIME_ARCH="$(binary_arch "$RUNTIME_BINARY")"
if [ "$APP_ARCH" != "$RUNTIME_ARCH" ]; then
  show_error "安装包内 Suna App($APP_ARCH) 与 Runtime($RUNTIME_ARCH) 架构不一致。请重新下载匹配的安装包。"
  exit 1
fi
if [ "$CURRENT_ARCH" = "arm64" ] && [ "$APP_ARCH" = "amd64" ] && ! pkgutil --pkg-info com.apple.pkg.RosettaUpdateAuto >/dev/null 2>&1; then
  show_error "这台 Mac 是 Apple Silicon，但当前安装包是 darwin-amd64，并且系统未安装 Rosetta。请下载 darwin-arm64.dmg。"
  exit 1
fi
if [ "$CURRENT_ARCH" = "amd64" ] && [ "$APP_ARCH" = "arm64" ]; then
  show_error "这台 Mac 是 Intel 架构，但当前安装包是 darwin-arm64。请下载 darwin-amd64.dmg。"
  exit 1
fi

chmod +x "$APP/Contents/MacOS/suna-app" "$APP/Contents/Resources/runtime/suna"
xattr -cr "$APP" >/dev/null 2>&1 || true
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
rm -rf /Applications/Suna.app
cp -R "$APP" /Applications/Suna.app
xattr -cr /Applications/Suna.app >/dev/null 2>&1 || true
chmod +x /Applications/Suna.app/Contents/MacOS/suna-app /Applications/Suna.app/Contents/Resources/runtime/suna
if ! open /Applications/Suna.app; then
  show_error "Suna 已复制到 Applications，但 macOS 未能打开它。请确认下载的 DMG 架构匹配当前 Mac，并检查系统安全设置。"
  exit 1
fi
