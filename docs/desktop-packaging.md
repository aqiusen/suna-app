# 桌面一体包打包说明

把 **Suna App（界面 + Gateway）** 和 **Suna Runtime（Agent）** 打进同一个安装器。用户双击 `SunaSetup-*.exe` 即可安装并启动，不必解压，也不必单独安装 `suna`。

本文写的是当前仓库已经实现的流程（方案 A：sidecar 捆绑）。

---

## 两个仓库不要搞混

| 目录 | 是什么 | 能不能 `go build -o suna.exe .` |
|---|---|---|
| `H:\liang-workspace-suna\suna` | Agent 引擎（Runtime） | **能**，产出 `suna.exe` |
| `H:\liang-workspace-suna\aqiusen-suna-app\suna-app` | 图形界面（本仓库） | **不能**。这里没有 Runtime 的 `main`，会报 `cannot find main module` |

打包脚本在 **本仓库**（suna-app）。Runtime 二进制要从 **suna 仓库** 先编出来，再用环境变量交给脚本。

```text
suna 仓库          →  suna.exe（或 macOS 上的 suna）
                         ↓  SUNA_RUNTIME
suna-app 仓库      →  嵌入前端 + 编译 suna-app.exe + 拷进 runtime\
                         ↓
                   dist\SunaSetup-vX.Y.Z-windows-amd64.exe  （发给用户这个）
                   dist\vX.Y.Z-suna-desktop-windows-amd64.zip （便携备用）
```

---

## 本机需要提前装好

- Go 1.26+
- Node.js 22+
- pnpm 10+（`npm install -g pnpm`）
- 第一次打本仓库的包：`cd frontend ; pnpm install`

检查：

```powershell
go version
node -v
pnpm -v
```

---

## Windows 打包（日常用这个）

在 **PowerShell** 里按顺序执行。注意每一步的 `cd` 目录。

### 1. 编译 Runtime

```powershell
cd H:\liang-workspace-suna\suna
go build -o suna.exe .
```

成功后当前目录应有 `suna.exe`（约 60MB）。

### 2. 编译前端、嵌入、打安装器

```powershell
cd H:\liang-workspace-suna\aqiusen-suna-app\suna-app
$env:SUNA_RUNTIME = "H:\liang-workspace-suna\suna\suna.exe"
.\scripts\build-desktop.ps1 -AppVersion v0.1.0 -Goarch amd64
```

脚本会依次：

1. `pnpm build` 前端
2. 把 `frontend/dist` 拷到 `gateway/internal/webassets/dist`（嵌入 UI）
3. 用 `-H=windowsgui` 编译 `suna-app.exe`（无黑框）
4. 把 `SUNA_RUNTIME` 指向的文件拷成 `runtime\suna.exe`
5. 打 zip，并嵌进 `SunaSetup-*.exe`

参数：

| 参数 | 含义 | 例子 |
|---|---|---|
| `-AppVersion` | 写入二进制的版本号，也用在 zip 文件名里 | `v0.1.0` |
| `-Goarch` | CPU 架构 | `amd64`（常见 PC）或 `arm64` |

不要写成 `-Version`：PowerShell 自己占用了 `-Version`。

### 3. 产物（发给用户安装器）

```text
suna-app\dist\SunaSetup-v0.1.0-windows-amd64.exe
```

用户**双击这一个文件**即可。安装器会显示进度窗口（复制文件 → 创建快捷方式 → 启动），**不会弹出 PowerShell 黑框**，成功后也不再多点一次确定对话框。

1. 解包到 `%LOCALAPPDATA%\Programs\Suna\`（含 `suna-app.exe` 和 `runtime\suna.exe`）
2. 静默创建桌面和开始菜单快捷方式（COM，不调 PowerShell）
3. 自动启动 Suna（Edge/Chrome 的 `--app` 独立窗口，没有地址栏）

便携 zip 仍会生成（给不想安装的人）：

```text
suna-app\dist\v0.1.0-suna-desktop-windows-amd64.zip
```

不要只发裸的 `suna-app.exe`。

---

## 安装后文件在哪（Windows）

双击 `SunaSetup-*.exe` 之后，程序和 Runtime **不在 zip 解压目录**，而在当前用户目录（不需要管理员权限）：

资源管理器地址栏粘贴即可打开：

```text
%LOCALAPPDATA%\Programs\Suna
```

展开后的实际路径一般是：

```text
C:\Users\<用户名>\AppData\Local\Programs\Suna\
  suna-app.exe
  runtime\
    suna.exe          ← Agent 引擎打在这里
```

| 东西 | 位置 | 说明 |
|---|---|---|
| 界面 + Gateway | `%LOCALAPPDATA%\Programs\Suna\suna-app.exe` | 快捷方式指向它 |
| Runtime 文件夹 | `%LOCALAPPDATA%\Programs\Suna\runtime\` | 安装器从包里拷出来的 `suna.exe` |
| 桌面 / 开始菜单 | `Suna.lnk` | 工作目录是上面的安装目录，才能找到 `runtime\suna.exe` |
| 模型、API Key、会话 | `%USERPROFILE%\.suna\` | **不是**安装目录；换安装包也不会丢 |
| App 日志 | `%USERPROFILE%\.suna-app\logs\app.log` | 排障看这个 |

`AppData` 默认是隐藏文件夹。地址栏直接贴 `%LOCALAPPDATA%\Programs\Suna` 比一层层点更省事。

卸载（目前没有独立卸载程序）：关掉 Suna 后删除 `%LOCALAPPDATA%\Programs\Suna`，以及桌面/开始菜单里的「Suna」快捷方式。用户配置在 `.suna`，要一并清掉才算「全新安装」。

---

## macOS 打包

推荐在 GitHub Actions 上打（ubuntu 交叉编译，与 Runtime 仓库同一套路）。Runtime 必须是 **对应架构的 macOS 二进制**，不要把 Windows 的 `suna.exe` 打进 `.app`。

### GitHub Actions（推荐）

1. 把 `feat/desktop-sidecar-bundle` 推到 GitHub（该分支的 push 会自动跑）。合进默认分支后，也可以用 **Actions → Desktop macOS → Run workflow**。
2. 手动跑时填写：
   - `app_version`：写入二进制和 zip 名，例如 `v0.1.0`
   - `runtime_tag`：捆绑的 Suna Runtime Release tag，例如 `v0.20.1`（必须已有 `suna-darwin-arm64.zip` / `suna-darwin-amd64.zip`）
3. 跑完后在该 run 的 **Artifacts** 下载：
   - `v0.1.0-suna-desktop-darwin-arm64.zip`（Apple Silicon）
   - `v0.1.0-suna-desktop-darwin-amd64.zip`（Intel Mac）

workflow 会从 `alanchenchen/suna` 的公开 Release 下载 Runtime，再调用 `scripts/build-desktop.sh` 组装 `Suna.app`。本仓库不 checkout、不编译 Runtime 源码。

推送 `v*` tag 时，正式 `release.yml` 也会附带这两份 darwin 桌面 zip。Runtime tag 钉在 workflow 里的 `SUNA_RUNTIME_TAG`，改捆绑版本时改那一处。

未签名：用户可能看到「已损坏」。内部分发可让对方执行 `xattr -cr /Applications/Suna.app`。对外公开发需要 Apple 证书做公证，当前未做。

### 本地交叉编译

```bash
cd /path/to/suna
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o suna .

cd /path/to/suna-app
SUNA_RUNTIME=/path/to/suna/suna ./scripts/build-desktop.sh v0.1.0 darwin arm64
```

也可以不编 Runtime，改下公开 Release：

```bash
./scripts/fetch-suna-runtime.sh v0.20.1 darwin arm64 /tmp/suna
SUNA_RUNTIME=/tmp/suna ./scripts/build-desktop.sh v0.1.0 darwin arm64
```

Intel Mac 把 `arm64` 换成 `amd64`。

产物：

```text
suna-app/dist/v0.1.0-suna-desktop-darwin-arm64.zip
```

里面是 `Suna.app`：

```text
Suna.app/Contents/MacOS/suna-app
Suna.app/Contents/Resources/runtime/suna
Suna.app/Contents/Info.plist
```

用户把 `Suna.app` 拖进「应用程序」再打开。未签名时 macOS 可能提示「已损坏」，需要本地签名/公证后才能给外人顺畅安装。

---

## 脚本实际做了什么

```text
pnpm build
    → frontend/dist/index.html + assets

拷贝到 gateway/internal/webassets/dist
    → go:embed 进 suna-app 二进制

go build suna-app
    Windows：-H=windowsgui（无控制台）
    启动后解析捆绑 Runtime：
        1. --suna-binary（若给了绝对路径）
        2. 同目录 runtime/suna(.exe)
        3. macOS 的 Contents/Resources/runtime/suna
        4. 最后才找 PATH 上的 suna

拷贝 SUNA_RUNTIME → runtime/suna(.exe)
打 zip
```

本仓库 **不会编译 suna 源码**，也不会 `import` Runtime 内部包。引擎和界面仍然靠 `suna serve --json` + TCP 协议通信。

---

## 打完怎么验收

1. 双击 `SunaSetup-v0.1.0-windows-amd64.exe`（或解压 zip 后点 `suna-app.exe`）。
2. 应弹出 **没有地址栏的独立窗口**（Edge/Chrome `--app`），不是普通浏览器标签。
3. 打开 **设置 → 模型**，填写 provider、接口地址、模型名、API Key，保存。
4. 新建任务，发一条消息，确认能流式回复。
5. 再双击一次 `suna-app.exe`：应复用已有实例，不要起第二个 Gateway。
6. **设置 → 连接 → 退出应用**。关浏览器标签 **不会** 退出后台。

日志：

```text
Windows: C:\Users\<用户名>\.suna-app\logs\app.log
macOS:   ~/.suna-app/logs/app.log
```

API Key 仍写在 Runtime 数据目录，不在安装包里：

```text
Windows: C:\Users\<用户名>\.suna\credentials.toml
macOS:   ~/.suna/credentials.toml
```

开发时不想弹浏览器：

```powershell
cd H:\liang-workspace-suna\aqiusen-suna-app\suna-app\gateway
go run ./cmd/suna-app --no-open
```

---

## 常见错误

### `go: cannot find main module`

当前目录是 suna-app。`suna.exe` 必须在 `H:\liang-workspace-suna\suna` 里编。

### `Set SUNA_RUNTIME to the prebuilt suna.exe path`

没设环境变量，或路径指向了目录而不是文件。要用 **绝对路径**，例如：

```powershell
$env:SUNA_RUNTIME = "H:\liang-workspace-suna\suna\suna.exe"
```

### `frontend dependencies missing`

```powershell
cd H:\liang-workspace-suna\aqiusen-suna-app\suna-app\frontend
pnpm install
```

### 双击后浏览器是空白 / 提示 503

前端没有嵌入。用本仓库的 `scripts\build-desktop.ps1` 重新打，确认 `gateway\internal\webassets\dist\index.html` 在编译前已经存在。

### 提示找不到 Runtime / Runtime is unavailable

zip 里缺少 `runtime\suna.exe`，或文件被杀毒软件隔离。解压后应能看到这两个文件在同一层目录结构里。

### 关掉窗口后进程还在

新包：关掉 `--app` 窗口约 2 秒后会停 Gateway，并执行 `suna stop` 关掉 daemon。若仍有残留，先结束旧版进程再装新的 `SunaSetup`。

### 双击 suna-app.exe 弹出黑框 `runtime\suna.exe`

旧包会这样：Windows 给控制台版 Agent 新建了一个可见窗口，daemon 还占着不关。新包已用 `CREATE_NO_WINDOW` 隐藏。如果仍看到旧黑框，先在任务管理器结束所有 `suna.exe` / `suna-app.exe`，再解压**重新打的** zip 后只双击 `suna-app.exe`。

---

## 和「只发 App、用户自己装 suna」的区别

| | 独立发版（原来的 `build-release.sh`） | 桌面一体包（本文） |
|---|---|---|
| 产物 | 只有 `suna-app` | `suna-app` + `runtime/suna` |
| 用户要先装 Runtime 吗 | 要，且需在 PATH | 不要 |
| 适用 | 开发者、已经会用 TUI 的人 | 给同事一键使用 |

两种产物可以并存。给普通用户发一体包 zip。
