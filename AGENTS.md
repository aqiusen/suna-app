# AGENTS.md

## 项目理解

Suna App 是 Suna Runtime 的官方 GUI 客户端（Web / PWA）。浏览器通过 Suna App Gateway 访问本地 Suna Runtime daemon：Gateway 负责发现与按需启动 Runtime、桥接公开 TCP NDJSON protocol 到浏览器 HTTP + SSE；前端只做展示与交互，业务语义全部留在 Runtime。Suna App 是独立项目、独立技术栈、独立构建与独立发版线。

Runtime 源码项目位于 `/Users/qiusen/workspace/suna/`。凡涉及 session、run、attach、detach、事件流、handoff 或协议行为的问题，必须同时检查该 Runtime 项目的实现代码与协议文档，再判断 App 是否正确；不能只依据前端现象推断结论。

```text
Browser / PWA
      │ HTTP + SSE
Suna App Gateway
      │ public Suna TCP NDJSON protocol
Installed Suna Runtime daemon
```

## 技术栈

- frontend：React + TypeScript strict + Vite + PWA；Tailwind CSS v4 + CSS 变量主题；Radix headless（Dialog / Select / Switch / Tooltip）；lucide-react 图标；react-markdown + remark-gfm。
- gateway：Go 独立 module；HTTP + SSE server；public Suna TCP NDJSON protocol client。
- 构建：Vite build → `stage-frontend.sh` 嵌入 Gateway webassets → `build-release.sh` 出平台包。

## 主要模块职责

### frontend/src/

- `App.tsx`：应用壳，组合连接、会话状态与布局（应保持精简，只做组合）。
- `features/runtime/`：HTTP+SSE bridge client（`useRuntimeBridge`）、连接状态、事件处理、会话操作与核心状态 hook。
- `features/sessions/`：会话列表、新建、重命名、加入、header、状态条与对话框。
- `features/chat/`：时间线（消息 / 思考 / 工具 / 决策卡）与输入区。
- `features/run/`：右侧 Run 状态与用量面板。
- `features/overview/`：任务总览首页（需要处理 / 运行中 / 最近会话）。
- `features/settings/`：Runtime 设置面板（config / memory / skill / MCP）。
- `components/`：Icon、ui/（Dialog / Select / Switch / Tooltip / Toast）。
- `lib/`：runtimeBridge 类型与 client、models、runtimeStatus。
- `styles/tailwind.css`：主题 token、全局样式与动效。

### gateway/

- `cmd/suna-app/`：binary entry point。
- `internal/runtime/`：suna discovery、`serve --json`、hello、protocol client。
- `internal/bridge/`：浏览器连接生命周期与 Runtime 桥接。
- `internal/httpapi/`：HTTP / SSE、webassets、错误映射。
- `internal/webassets/`：嵌入的前端构建产物（构建生成，不手改）。

## 架构规则

- 本仓库不得 import、vendor、复制或依赖 Suna Runtime 的 `internal/` 包；Gateway 只依赖已公开、已文档化的 CLI、transport 与 protocol。
- 前端只通过 Gateway 的明确 HTTP / SSE contract 工作；浏览器不得直接连接 Runtime TCP、不得读取 Runtime 存储。
- 跨层业务语义必须通过公开 protocol 演进，禁止私有后门；Runtime 不可用、protocol 不兼容、capability 缺失时必须清晰失败，禁止静默 fallback、伪造状态或猜测兼容。
- 浏览器断线不得取消 Runtime run；重连后必须 attach 并以 Runtime 权威状态恢复 UI。
- Suna App 不保存第二份 Session / Agent 数据，不执行模型，不持有模型凭据。
- 生产前端产物只嵌入 `suna-app` 自己的 Gateway binary，绝不嵌入 Runtime binary。

## 开发规则

- 单个前端文件尽量不超过 400 行；接近上限时应拆分为职责清晰的小文件（组件、hook、事件处理、类型分离）。单个 Go 文件尽量不超过 700 行。
- 重要逻辑必须加中文注释，尤其是并发、状态机、错误恢复、断线重连、安全边界、缓存稳定性与 protocol glue；提示词模板必须使用英文。
- 前端 TypeScript strict；网络边界必须有显式类型与 schema validation；避免 `any`、隐式 JSON 假设和无边界 global store。
- React 组件、hooks 与 feature state 保持小而组合明确；始终处理 loading、empty、error、disconnected、permission 与 unsupported 状态。
- Gateway 使用 idiomatic Go：`context.Context`、明确 timeout、取消、有限缓冲、backpressure 与可分类错误；每个 goroutine 必须能说明启动者、退出条件、channel 所有者和共享状态锁。
- 默认值、超时、路径、监听地址、权限与 token 规则放在所属层集中维护；禁止跨层重复猜测。
- 不添加兼容旧逻辑的兜底代码，除非有明确迁移需求并在注释中说明；不为假想扩展预建 interface 或抽象。
- 公开仓库隐私：代码、文档、示例、测试与用户可见内容不得写入真实或仿真的 API key、token、Cookie、Authorization、私钥、带凭据 URL、私有 provider、内部域名或模型 ref；使用 `<API_KEY>`、`test-token`、`example-provider`、`https://api.example.com` 等占位符。

## UI / UX 原则

- Suna App 是跨设备 Session 控制台：看进度、接管任务、处理 Guard / AskUser、审阅执行过程；不是 TUI 投屏、终端模拟器或 Web IDE。
- 手机优先：必须考虑窄屏、触控目标、安全区、软键盘 / IME、锁屏与网络切换；桌面在此基础上提高效率。
- Guard 与 AskUser 是一等交互，内嵌在对话流中就地决策；不得自动批准、隐藏或绕过；移动端使用清晰按钮与可读风险状态。
- 工具与思考默认折叠但可展开详情；流式 delta 必须批量合并更新，禁止 token 级全页渲染。
- 状态必须同时用文字、图标与颜色表达，不只用颜色；语义化 HTML、键盘导航、焦点管理、屏幕阅读器标签、足够对比度与 reduced motion。
- 动效克制且服务于状态与层级：只动 `opacity` / `transform`，支持 `prefers-reduced-motion`。

## 测试与提交前检查

前端每次功能开发后至少运行：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Gateway 每次功能开发后至少运行：

```text
gofmt
go vet ./...
go test ./...
go build ./...
```

涉及 Gateway 并发、协议连接或取消时补充 `go test -race ./...`。

测试规则：

- 使用 fake Runtime 或公开 protocol fixtures；不得依赖 Suna 私有包、真实网络、真实模型或凭据。
- 测试必须离线、快速、确定性；涉及真实 Runtime、浏览器端到端或外部网络的测试必须明确标记为 integration，不进入默认快速测试。
- 前端测试与被测文件放在同一目录（co-located），命名 `*.test.ts(x)`（Vitest 默认约定）；不建集中式 `__tests__` 目录。
- 前端核心状态逻辑（事件处理、状态机、数据流）必须补测试；UI 组件不强制，除非有交互状态机。
- 提交前运行 `git diff --check`、`git status --short` 与受影响侧的质量命令。

## Git 提交规范

- 使用英文 Conventional Commits：`type(scope): imperative summary`。
- type 优先使用 `feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`chore`；scope 使用稳定模块，如 `frontend`、`gateway`、`session`、`chat`、`runtime`、`release`。
- summary 简洁、首字母小写、不加句号；避免泛泛 `update`、中文和实现细节堆砌。
- 重要 feature、安全行为、协议变更、兼容迁移或跨层改动必须写英文 body，说明设计意图、关键行为、兼容影响与用户可见变化。
- 不兼容变更使用 `!`，并在 body 末尾写 `BREAKING CHANGE:`。
- 一个提交只承载一个可 review 的目的；不得把前端、Gateway、生成物和无关重构混在一起。

## 发版规则

- Suna App 使用独立 SemVer tag（如 `v0.1.0`），与 Suna Runtime 的 tag 和节奏无关。
- 版本号来源以 Git tag 为准，不在代码或脚本中维护固定版本号；Gateway 通过 build metadata 注入 release version。
- 让 Suna 代发版时，先根据改动范围建议版本号；用户确认后才能创建 tag 和推送。
- 发版前必须确认：`git status --short`、`git diff --check`、frontend 与 gateway 完整质量命令、release build dry run。
- 发版必须使用 annotated tag，tag message 使用中文 release notes；不要使用 lightweight tag。
- 推送顺序建议先推主分支，再推 tag：`git push origin main`，然后 `git push origin vX.Y.Z`。
- `v*` tag 触发 GitHub Actions：构建前端、嵌入产物、构建平台 Gateway artifacts、生成 `checksums.txt`、创建 GitHub Release。
- Release notes 必须声明支持的 Suna Runtime protocol 版本 / capabilities 与最低版本要求。
- protocol breaking change 时，先发布具有明确迁移说明的 Runtime，再发布兼容的 Suna App；不得用静默 fallback 掩盖不兼容。
- 发版后仅确认远端 tag 与 release assets；不要默认依赖 `gh` CLI 检查 workflow。
