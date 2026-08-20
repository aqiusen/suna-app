#!/usr/bin/env bash
# 从 Suna Runtime 的 GitHub Release 下载预编译二进制。本仓库不编译 Runtime 源码。
# 用法:
#   ./scripts/fetch-suna-runtime.sh v0.19.3 darwin arm64 /tmp/suna-runtime/suna
set -euo pipefail

TAG="${1:?runtime tag is required, e.g. v0.19.3}"
GOOS="${2:?goos is required: windows|darwin|linux}"
GOARCH="${3:?goarch is required: amd64|arm64}"
DEST="${4:?destination file path is required}"
REPO="${SUNA_RUNTIME_REPO:-alanchenchen/suna}"

if [ "$GOOS" = "windows" ]; then
  asset="suna-windows-${GOARCH}.zip"
  inner="suna.exe"
else
  asset="suna-${GOOS}-${GOARCH}.zip"
  inner="suna"
fi

url="https://github.com/${REPO}/releases/download/${TAG}/${asset}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl_args=(-fsSL)
if [ -n "${SUNA_RUNTIME_TOKEN:-}" ]; then
  curl_args+=(-H "Authorization: Bearer ${SUNA_RUNTIME_TOKEN}" -H "Accept: application/octet-stream")
fi
curl "${curl_args[@]}" -o "$tmp/runtime.zip" "$url"

python3 - "$tmp/runtime.zip" "$tmp" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as zf:
    zf.extractall(sys.argv[2])
PY

src="$tmp/$inner"
if [ ! -f "$src" ]; then
  printf '%s\n' "release zip missing ${inner}: ${url}" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$src" "$DEST"
chmod +x "$DEST"
printf '%s\n' "fetched ${url} -> ${DEST}"
