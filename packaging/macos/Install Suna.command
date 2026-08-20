#!/bin/bash
# 双击安装：去掉隔离标记、补执行权限、拷进应用程序并打开。
# 第一次可能仍要右键 → 打开（系统对从网上下载的脚本的限制）。
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"
APP="Suna.app"
if [ ! -d "$APP" ]; then
  osascript -e 'display alert "找不到 Suna.app。请先解压 zip，让 Suna.app 和这个脚本在同一文件夹，再双击安装。" as critical'
  exit 1
fi
chmod +x "$APP/Contents/MacOS/suna-app" "$APP/Contents/Resources/runtime/suna"
xattr -cr "$APP" >/dev/null 2>&1 || true
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
rm -rf /Applications/Suna.app
cp -R "$APP" /Applications/Suna.app
xattr -cr /Applications/Suna.app >/dev/null 2>&1 || true
chmod +x /Applications/Suna.app/Contents/MacOS/suna-app /Applications/Suna.app/Contents/Resources/runtime/suna
open /Applications/Suna.app
