#!/usr/bin/env bash
# 把已构建的 suna-app 与预编译 Runtime 打成桌面分发包。
# 用法:
#   SUNA_RUNTIME=/path/to/suna ./scripts/build-desktop.sh v0.1.0 windows amd64
#   SUNA_RUNTIME=/path/to/suna ./scripts/build-desktop.sh v0.1.0 darwin arm64
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?version is required, e.g. v0.1.0}"
GOOS="${2:?goos is required: windows|darwin|linux}"
GOARCH="${3:?goarch is required: amd64|arm64}"
RUNTIME_SRC="${SUNA_RUNTIME:?set SUNA_RUNTIME to the prebuilt suna binary}"

if [ ! -f "$RUNTIME_SRC" ]; then
  printf '%s\n' "SUNA_RUNTIME is not a file: $RUNTIME_SRC" >&2
  exit 1
fi

GATEWAY_DIR="$ROOT_DIR/gateway"
DIST_DIR="$ROOT_DIR/dist/desktop/${GOOS}-${GOARCH}"
PACKAGE="github.com/alanchenchen/suna-app/gateway/cmd/suna-app"
APP_NAME="suna-app"
if [ "$GOOS" = "windows" ]; then
  APP_NAME="suna-app.exe"
fi

LDFLAGS="-s -w -X main.buildVersion=${VERSION}"
if [ "$GOOS" = "windows" ]; then
  # 桌面包无控制台黑框；日志写 ~/.suna-app/logs/app.log
  LDFLAGS="$LDFLAGS -H=windowsgui"
fi

STAGED_INDEX="$ROOT_DIR/gateway/internal/webassets/dist/index.html"
if [ "${SKIP_FRONTEND_BUILD:-}" = "1" ]; then
  if [ ! -f "$STAGED_INDEX" ]; then
    printf '%s\n' "SKIP_FRONTEND_BUILD=1 but staged frontend is missing: $STAGED_INDEX" >&2
    exit 1
  fi
else
  if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
    printf '%s\n' "frontend dependencies missing: run 'cd frontend && pnpm install' first" >&2
    exit 1
  fi
  (
    cd "$ROOT_DIR/frontend"
    pnpm build
  )
  "$ROOT_DIR/scripts/stage-frontend.sh"
  (
    cd "$GATEWAY_DIR"
    go test -tags=integration ./internal/webassets
  )
fi

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

(
  cd "$GATEWAY_DIR"
  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build \
    -trimpath \
    -ldflags "$LDFLAGS" \
    -o "$DIST_DIR/$APP_NAME" \
    "$PACKAGE"
)

if [ "$GOOS" = "darwin" ]; then
  APP_ROOT="$DIST_DIR/Suna.app"
  mkdir -p "$APP_ROOT/Contents/MacOS"
  mkdir -p "$APP_ROOT/Contents/Resources/runtime"
  mv "$DIST_DIR/$APP_NAME" "$APP_ROOT/Contents/MacOS/suna-app"
  cp "$ROOT_DIR/packaging/macos/Info.plist" "$APP_ROOT/Contents/Info.plist"
  cp "$RUNTIME_SRC" "$APP_ROOT/Contents/Resources/runtime/suna"
  chmod +x "$APP_ROOT/Contents/MacOS/suna-app" "$APP_ROOT/Contents/Resources/runtime/suna"
  ARCHIVE="$ROOT_DIR/dist/${VERSION}-suna-desktop-${GOOS}-${GOARCH}.zip"
  rm -f "$ARCHIVE"
  (
    cd "$DIST_DIR"
    if command -v zip >/dev/null 2>&1; then
      zip -9 -r "$ARCHIVE" "Suna.app"
    else
      python3 - "$ARCHIVE" <<'PY'
import os, stat, sys, zipfile
archive = sys.argv[1]
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk("Suna.app"):
        for name in files:
            path = os.path.join(root, name)
            info = zipfile.ZipInfo.from_file(path, path.replace(os.sep, "/"))
            info.compress_type = zipfile.ZIP_DEFLATED
            mode = os.stat(path).st_mode
            if mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH):
                info.external_attr = (mode | 0o111) << 16
            with open(path, "rb") as fh:
                zf.writestr(info, fh.read())
PY
    fi
  )
else
  mkdir -p "$DIST_DIR/runtime"
  if [ "$GOOS" = "windows" ]; then
    cp "$RUNTIME_SRC" "$DIST_DIR/runtime/suna.exe"
  else
    cp "$RUNTIME_SRC" "$DIST_DIR/runtime/suna"
    chmod +x "$DIST_DIR/runtime/suna" "$DIST_DIR/$APP_NAME"
  fi
  ARCHIVE="$ROOT_DIR/dist/${VERSION}-suna-desktop-${GOOS}-${GOARCH}.zip"
  rm -f "$ARCHIVE"
  (
    cd "$DIST_DIR"
    if command -v zip >/dev/null 2>&1; then
      zip -9 -r "$ARCHIVE" .
    else
      python3 - "$ARCHIVE" <<'PY'
import sys, zipfile, os
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
