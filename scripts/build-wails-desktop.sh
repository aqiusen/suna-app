#!/usr/bin/env bash
# Build the real WebView desktop app. This keeps the existing Gateway/Runtime
# split: Wails owns the native window, while the Gateway still owns HTTP/SSE.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?version is required, e.g. v0.1.0}"
GOOS_TARGET="${2:?goos is required: windows|darwin|linux}"
GOARCH_TARGET="${3:?goarch is required: amd64|arm64}"
RUNTIME_SRC="${SUNA_RUNTIME:?set SUNA_RUNTIME to the prebuilt suna binary}"

if [ ! -f "$RUNTIME_SRC" ]; then
  printf '%s\n' "SUNA_RUNTIME is not a file: $RUNTIME_SRC" >&2
  exit 1
fi
for tool in go pnpm wails; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '%s\n' "missing required tool: $tool" >&2
    exit 1
  fi
done

(
  cd "$ROOT_DIR/frontend"
  pnpm build
)
"$ROOT_DIR/scripts/stage-frontend.sh"

(
  cd "$ROOT_DIR/gateway"
  wails build \
    -platform "${GOOS_TARGET}/${GOARCH_TARGET}" \
    -ldflags "-s -w -X main.buildVersion=${VERSION}"
)

BIN_DIR="$ROOT_DIR/gateway/build/bin"
DIST_DIR="$ROOT_DIR/dist/wails/${GOOS_TARGET}-${GOARCH_TARGET}"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

if [ "$GOOS_TARGET" = "darwin" ]; then
  APP_SRC="$BIN_DIR/Suna.app"
  APP_DST="$DIST_DIR/Suna.app"
  if [ ! -d "$APP_SRC" ]; then
    printf '%s\n' "wails did not produce $APP_SRC" >&2
    exit 1
  fi
  # 固定正式 Bundle ID，避免 Wails 默认 com.wails.suna 让 LaunchServices 产生重复应用记录。
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier app.suna.desktop" "$APP_SRC/Contents/Info.plist"
  cp -R "$APP_SRC" "$APP_DST"
  mkdir -p "$APP_DST/Contents/Resources/runtime"
  cp "$RUNTIME_SRC" "$APP_DST/Contents/Resources/runtime/suna"
  chmod +x "$APP_DST/Contents/MacOS/Suna" "$APP_DST/Contents/Resources/runtime/suna"
  # Runtime 是 Wails 生成 app 后再放进去的资源，必须重签最终 app，否则 macOS 会判定包损坏。
  codesign --force --deep --sign - "$APP_DST"
  STAGING="$DIST_DIR/dmg-staging"
  rm -rf "$STAGING"
  mkdir -p "$STAGING"
  cp -R "$APP_DST" "$STAGING/Suna.app"
  ln -s /Applications "$STAGING/Applications"
  ARCHIVE="$ROOT_DIR/dist/${VERSION}-suna-wails-${GOOS_TARGET}-${GOARCH_TARGET}.dmg"
  rm -f "$ARCHIVE"
  hdiutil create -volname "Suna" -srcfolder "$STAGING" -ov -format UDZO "$ARCHIVE"
  rm -rf "$STAGING"
else
  EXE="Suna"
  RUNTIME_NAME="suna"
  if [ "$GOOS_TARGET" = "windows" ]; then
    EXE="Suna.exe"
    RUNTIME_NAME="suna.exe"
  fi
  if [ ! -f "$BIN_DIR/$EXE" ]; then
    printf '%s\n' "wails did not produce $BIN_DIR/$EXE" >&2
    exit 1
  fi
  cp "$BIN_DIR/$EXE" "$DIST_DIR/$EXE"
  mkdir -p "$DIST_DIR/runtime"
  cp "$RUNTIME_SRC" "$DIST_DIR/runtime/$RUNTIME_NAME"
  chmod +x "$DIST_DIR/$EXE" "$DIST_DIR/runtime/$RUNTIME_NAME" 2>/dev/null || true
  ARCHIVE="$ROOT_DIR/dist/${VERSION}-suna-wails-${GOOS_TARGET}-${GOARCH_TARGET}.zip"
  rm -f "$ARCHIVE"
  (
    cd "$DIST_DIR"
    if command -v zip >/dev/null 2>&1; then
      zip -9 -r "$ARCHIVE" .
    else
      python3 - "$ARCHIVE" <<'PY'
import os, sys, zipfile
archive = sys.argv[1]
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk("."):
        for name in files:
            path = os.path.join(root, name)
            zf.write(path, os.path.relpath(path, "."))
PY
    fi
  )
fi

printf '%s\n' "wrote $ARCHIVE"
