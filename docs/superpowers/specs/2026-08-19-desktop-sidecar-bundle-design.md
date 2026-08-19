# Desktop sidecar bundle (方案 A)

Date: 2026-08-19  
Repo: `aqiusen/suna-app`  
Status: approved for implementation

## Goal

Ship one Mac/Windows artifact that contains the Suna App Gateway (with embedded UI) **and** a sibling Suna Runtime binary. After install, the user double-clicks, configures provider + API key in the existing Settings UI, and uses the product. No Node, Go, or separate PATH install.

## Non-goals (this increment)

- Electron / Tauri / Wails
- Merging Go modules or importing `suna/internal`
- Embedding the Runtime **inside** the Gateway via `go:embed`
- CGO tray/menu bar (would break `CGO_ENABLED=0` cross-compile)
- Auto-update of only one half of the pair
- Changing Runtime protocol or credential storage

## Architecture

```text
[Installer / unzip]
  suna-app(.exe)              Gateway + embedded React
  runtime/suna(.exe)          Official Runtime CLI/daemon

double-click suna-app
  → resolve bundled Runtime (then PATH)
  → listen HTTP (default 0.0.0.0:7633, reuse existing instance)
  → open http://127.0.0.1:<port>/
  → browser talks HTTP+SSE to Gateway
  → Gateway runs `<bundled> serve --json` and TCP hello as today
  → API keys still go through config.set → ~/.suna/credentials.toml
```

Gateway remains a protocol client. Runtime remains the only Agent process.

## Binary resolution

`ResolveSunaBinary(flag, exePath)`:

1. If `flag` is absolute or contains a path separator, use it unchanged.
2. Else look for, in order:
   - `{exeDir}/../Resources/runtime/suna[.exe]` when `exeDir` is `Contents/MacOS`
   - `{exeDir}/runtime/suna[.exe]`
   - `{exeDir}/suna[.exe]`
3. Else return the flag value (`suna`) for PATH lookup.

`--suna-binary` still works for developers.

## Process UX

- First start: open the system browser to the loopback UI URL.
- Second start while already running: do not bind a second server; open the existing URL and exit.
- `--no-open` skips the browser (CI / headless).
- Windows desktop artifact is built with `-H=windowsgui` (no console). Logs always append to `~/.suna-app/logs/app.log`.
- `POST /api/v1/shutdown` is loopback-only (RemoteAddr must be loopback). Settings → 连接 has “退出应用”. This is the v1 quit path; a CGO-free tray is a later increment.

## Layout

Windows portable zip:

```text
suna-app.exe
runtime/suna.exe
```

macOS app:

```text
Suna.app/Contents/MacOS/suna-app
Suna.app/Contents/Resources/runtime/suna
Suna.app/Contents/Info.plist   (LSUIElement=true)
```

The desktop build script copies a **prebuilt** Runtime from `SUNA_RUNTIME` (path to `suna` / `suna.exe`). This repo never compiles Runtime sources.

## Compatibility

Desktop zip pins one App + one Runtime that both speak protocol 0.5. Independent App-only zips remain available via the existing `build-release.sh`.

## Key decisions

| Decision | Why |
|---|---|
| Sidecar, not embed | Runtime must stay a stable executable for `serve --json`, TUI, and idle-exit |
| System browser, not WebView | Matches existing Gateway HTTP server and LAN/PWA use |
| No CGO tray in v1 | Keep `CGO_ENABLED=0`; quit via Settings |
| Copy prebuilt Runtime | License and module boundary stay intact |
