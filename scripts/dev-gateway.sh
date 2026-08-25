#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 优先用显式环境变量；否则退回本机已安装的 Suna.app 里的 Runtime。
RUNTIME_BIN="${SUNA_RUNTIME:-}"
if [ -z "$RUNTIME_BIN" ]; then
  for candidate in \
    "/Applications/Suna.app/Contents/Resources/runtime/suna" \
    "$HOME/Applications/Suna.app/Contents/Resources/runtime/suna"
  do
    if [ -x "$candidate" ]; then
      RUNTIME_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$RUNTIME_BIN" ]; then
  printf '%s\n' "set SUNA_RUNTIME or install Suna.app in /Applications" >&2
  exit 1
fi

if [ ! -x "$RUNTIME_BIN" ]; then
  printf '%s\n' "runtime binary is not executable: $RUNTIME_BIN" >&2
  exit 1
fi

cd "$ROOT_DIR/gateway"
exec go run ./cmd/suna-app --suna-binary "$RUNTIME_BIN"
