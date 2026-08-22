# Wails 桌面打包落地方案

本文描述 Suna App 从“Go Gateway 打开浏览器 app-mode 窗口”升级到“真实桌面 WebView 应用”的可执行方案。目标是引入跨端系统能力，但不重写 Runtime 协议、不复制业务语义。

## 结论

采用 Wails，不采用 Tauri 作为第一阶段实现。

原因很简单：本仓库已经有 Go Gateway，Runtime 发现、`suna serve --json`、TCP NDJSON client、HTTP/SSE bridge、sidecar Runtime 解析都在 Go 侧。Wails 直接复用 Go；Tauri 会引入 Rust native backend，当前只能把已有 Go Gateway 当 sidecar 再包一层，复杂度更高。

## 当前问题

现有桌面包已经能生成 `Suna.app` / Windows zip，但窗口不是内嵌 WebView：

```text
Suna.app / suna-app.exe
  -> 启动 Go Gateway
  -> 找 Edge / Chrome
  -> 用 --app=http://127.0.0.1:7633/?desktop=1 打开窗口
```

用户看到的是独立窗口，但技术上仍依赖外部 Chromium。跨端能力只能通过 Gateway HTTP API 间接补，窗口菜单、原生对话框、托盘、通知、系统权限等能力没有真正的 app 容器。

## 新架构

第一阶段只替换窗口层：

```text
Wails WebView window
  │
  │ Go binding: GatewayBaseURL()
  ▼
React UI
  │ absolute HTTP + SSE
  ▼
Loopback Go Gateway
  │ public TCP NDJSON protocol
  ▼
Bundled / installed Suna Runtime daemon
```

关键边界不变：

- React 仍只做展示与交互。
- Gateway 仍是唯一 Runtime bridge。
- Runtime 业务语义仍只来自公开 protocol。
- Wails 只负责真实窗口、生命周期和后续系统能力。

## 为什么 Gateway 仍跑 HTTP/SSE

不要把 `/api/v1/bridge` 直接搬进 Wails binding。

原因：

1. 现有前端已经围绕 `fetch` + `EventSource` 做了 reconnect、attach、stream lifecycle。
2. 手机 / 局域网 / Tailscale 远程控制仍需要 HTTP Gateway。
3. Wails binding 适合离散系统能力，不适合替代长连接 SSE protocol glue。
4. 保留 HTTP/SSE 可以让浏览器/PWA 路径与桌面路径共用同一套 contract。

因此 Wails 桌面壳启动时监听 `127.0.0.1:0`，得到随机本机端口，再通过 `GatewayAuth()` 告诉前端 loopback 地址和一次性 `desktop_token`。前端检测到 Wails binding 后，把 Runtime bridge 的 `baseUrl` 切到该 loopback 地址，并给每个 HTTP/SSE 请求追加 token。Gateway 只在“请求来自 loopback 且 token 匹配”时放行这个跨 origin WebView 请求。

## 已实现的第一阶段

新增文件：

- `gateway/main.go`：Wails 桌面入口。
- `gateway/internal/desktopserver/server.go`：可被 Wails 复用的 Gateway server lifecycle。
- `frontend/src/lib/desktopGateway.ts`：读取 Wails `GatewayAuth()`，并限制为 loopback HTTP。
- `scripts/build-wails-desktop.sh`：构建真实 WebView 桌面包。
- `gateway/wails.json`：Wails v2 项目配置。
- `gateway/build/darwin/Info.plist`：macOS bundle 模板，固定 `CFBundleIdentifier=app.suna.desktop`，避免 Wails 默认 `com.wails.suna` 造成 Spotlight / LaunchServices 重复注册。

改动点：

- `useRuntimeSession` 把 `baseUrl` 传给 `useRuntimeBridge`。
- `gatewayShutdown` 使用同一个 `baseUrl` 调 `/api/v1/shutdown`。
- `main.tsx` 在 React mount 前等待 native gateway 地址初始化。

## 构建要求

本机或 CI 需要：

```text
Go 1.26+
Node.js 22+
pnpm 10+
Wails CLI v2
平台 WebView toolchain
```

安装 Wails CLI：

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.14.0
```

macOS 需要 Xcode Command Line Tools。Windows 需要 WebView2 Runtime。

## 构建命令

先准备 Runtime 二进制，本仓库不编译 Runtime 源码：

```bash
./scripts/fetch-suna-runtime.sh v0.20.1 darwin arm64 /tmp/suna-runtime/suna
export SUNA_RUNTIME=/tmp/suna-runtime/suna
./scripts/build-wails-desktop.sh v0.1.0 darwin arm64
```

Windows：

```powershell
$env:SUNA_RUNTIME_REPO = "aqiusen/suna"
bash ./scripts/fetch-suna-runtime.sh v0.20.1 windows amd64 /tmp/suna-runtime/suna.exe
$env:SUNA_RUNTIME = "/tmp/suna-runtime/suna.exe"
bash ./scripts/build-wails-desktop.sh v0.1.0 windows amd64
```

产物：

```text
dist/v0.1.0-suna-wails-darwin-arm64.dmg
dist/v0.1.0-suna-wails-windows-amd64.zip
```

## 验收标准

1. 打开的是 Wails WebView 窗口，不再启动 Edge / Chrome app-mode。
2. DevTools / Activity Monitor 中不应出现由 Suna 启动的 Chrome/Edge `--app=` 进程。
3. 设置、会话列表、创建任务、流式消息、Guard / AskUser 仍通过 `/api/v1/bridge` 正常工作。
4. 退出应用会关闭 Gateway bridge，并停止本包启动的 Runtime daemon。
5. 浏览器/PWA 原路径仍可用：`go run ./cmd/suna-app --no-open` + Vite proxy 不受影响。

## 后续系统能力放哪里

放在 Wails Go binding，不放在 React 里猜平台：

| 能力 | 落点 |
|---|---|
| 文件选择 / 目录选择 | Wails Go binding |
| 复制路径 / 打开 Finder | Wails Go binding |
| 系统通知 | Wails Go binding |
| 托盘 / 菜单 / 快捷键 | Wails app options / Go binding |
| 自动更新 | 独立 release/update 模块 |
| Runtime protocol 操作 | 继续走 Gateway HTTP/SSE |

新增系统能力时要先定义明确的前端调用边界，不能让浏览器直接读本地文件或 Runtime 存储。

## 风险与处理

- Wails 依赖平台 WebView，CI 要分别在 macOS / Windows / Linux runner 构建。
- 未签名 macOS app 仍会遇到 Gatekeeper；公开分发前必须做 Apple 签名与公证。
- 旧的 `scripts/build-desktop.sh` 仅保留作本地回退；GitHub Actions 发版只构建 Wails 产物。
- 第一阶段 Wails 桌面监听随机 loopback 端口；远程手机控制仍由原 `suna-app` Gateway 路径承担。
