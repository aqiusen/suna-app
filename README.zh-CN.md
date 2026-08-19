# Suna App

Suna App 是 [Suna Runtime](https://github.com/alanchenchen/suna) 的官方 GUI 客户端，提供响应式 Web / PWA 体验。它通过 Suna 的公开本地 protocol 连接已安装的 Suna Runtime，不包含第二套 Agent runtime。

## 架构

```text
Browser / PWA
      │ HTTP + SSE
Suna App Gateway
      │ public TCP NDJSON protocol
Installed Suna Runtime daemon
```

Runtime 是 Session、Agent run、Guard、工具、附件、MCP、Skill 和本地持久化的唯一事实来源。Gateway 只是面向浏览器的安全 protocol client 与适配层。

参见[架构说明](docs/architecture.md)与 Runtime 的[第三方客户端指南](https://github.com/alanchenchen/suna/blob/main/docs/tcp-client.md)。

## 仓库结构

```text
frontend/                 React + TypeScript + Vite PWA
  src/                    UI、状态、API client、可复用组件
  public/                 公共静态资源

gateway/                  独立 Go module
  cmd/suna-app/           Gateway 二进制入口
  internal/               Runtime 发现、protocol client、HTTP/SSE bridge

docs/                     架构、开发与部署说明
scripts/                  确定性的本地与 release 构建脚本
.github/workflows/        CI 与独立发版自动化
```

## 开发流程

本地 HMR 开发请使用两个终端。Gateway 和 Vite 都只监听 loopback；Vite 会将 `/api` 与 `/healthz` 代理到 `http://127.0.0.1:7633` 的 Gateway。Gateway 的实时更新通过 API 路由上的 SSE 提供。

```bash
# 终端 1
cd gateway
go run ./cmd/suna-app
```

```bash
# 终端 2
cd frontend
pnpm install
pnpm dev
```

打开 Vite 输出的地址即可。完整的检查命令、Runtime 要求和开发约定见[开发文档](docs/development.md)。

## 发版流程

发版会先构建前端，将产物暂存到 Gateway 的 `go:embed` 目录，校验暂存后的嵌入资源，然后交叉编译 Gateway 并打包：

```bash
cd frontend
pnpm build

cd ..
./scripts/build-release.sh v0.0.0
```

`build-release.sh` 会调用 `scripts/stage-frontend.sh`，并在打包前运行带 tag 的嵌入资源 smoke test；归档文件生成在 `dist/`。受追踪的 `gateway/internal/webassets/dist/.gitkeep` 让干净 checkout 中的普通 Go 构建仍可通过；默认 Gateway 测试不依赖前端构建产物。

Suna App 与 Suna Runtime 独立版本化、独立发版：

```text
Suna Runtime: v0.x.y
Suna App:     v0.x.y
```

兼容性取决于公开 Runtime protocol 与 capabilities，而不是两个应用的版本号相同。每个 Suna App release 都会声明支持的 Runtime protocol 版本。

## 桌面一体包（方案 A）

把 Gateway 和预编译的 Runtime 打进同一份 zip / `.app`。用户解压或拖入 Applications 后双击 `suna-app`，浏览器会打开界面；在设置里填写模型和 API Key 即可使用。不需要先把 `suna` 加到 PATH。

```powershell
$env:SUNA_RUNTIME = "H:\path\to\suna.exe"
.\scripts\build-desktop.ps1 -Version v0.1.0 -Goarch amd64
```

```bash
SUNA_RUNTIME=/path/to/suna ./scripts/build-desktop.sh v0.1.0 darwin arm64
```

产物布局：

```text
Windows:  suna-app.exe + runtime/suna.exe
macOS:    Suna.app/Contents/MacOS/suna-app
          Suna.app/Contents/Resources/runtime/suna
```

关掉浏览器标签不会退出 Gateway。设置 → 连接 → 退出应用，或结束 `suna-app` 进程。日志在 `~/.suna-app/logs/app.log`。

## 许可证

MIT。见 [LICENSE](LICENSE)。
