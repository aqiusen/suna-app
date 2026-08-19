# Suna App

Suna App is the official GUI client for the [Suna Runtime](https://github.com/alanchenchen/suna). It provides a responsive Web / PWA experience and connects to an already installed Runtime through Suna's public local protocol; it does not contain a second Agent runtime.

## Architecture

```text
Browser / PWA
      │ HTTP + SSE
Suna App Gateway
      │ public TCP NDJSON protocol
Installed Suna Runtime daemon
```

The Runtime remains the source of truth for sessions, agent runs, Guard, tools, attachments, MCP, Skills, and local persistence. The Gateway is only a secure browser-facing protocol client and adapter.

See [architecture notes](docs/architecture.md) and the Runtime's [third-party client guide](https://github.com/alanchenchen/suna/blob/main/docs/tcp-client.md).

## Repository layout

```text
frontend/                 React + TypeScript + Vite PWA
  src/                    UI, state, API client, reusable components
  public/                 public static assets

gateway/                  independent Go module
  cmd/suna-app/           Gateway binary entry point
  internal/               Runtime discovery, protocol client, HTTP/SSE bridge

docs/                     architecture, development and deployment notes
scripts/                  deterministic local and release build helpers
.github/workflows/        CI and independent release automation
```

## Development workflow

Use two terminals for local HMR development. The Gateway and Vite are both loopback-only. Vite proxies `/api` and `/healthz` to the Gateway at `http://127.0.0.1:7633`; live Gateway updates use SSE on the API routes.

```bash
# Terminal 1
cd gateway
go run ./cmd/suna-app
```

```bash
# Terminal 2
cd frontend
pnpm install
pnpm dev
```

Open the URL printed by Vite. See [development.md](docs/development.md) for checks, Runtime requirements, and the complete development contract.

## Release model

A release first builds the frontend, stages it into the Gateway's `go:embed` directory, validates the staged embedded assets, and then cross-compiles the Gateway archives:

```bash
cd frontend
pnpm build

cd ..
./scripts/build-release.sh v0.0.0
```

`build-release.sh` calls `scripts/stage-frontend.sh` and runs the tagged embedded-asset smoke test before creating archives in `dist/`. The tracked `gateway/internal/webassets/dist/.gitkeep` keeps ordinary Go builds valid in a clean checkout; normal Gateway tests do not require a frontend build.

Suna App is versioned and released independently from Suna Runtime:

```text
Suna Runtime: v0.x.y
Suna App:     v0.x.y
```

Compatibility is determined by the public Runtime protocol and advertised capabilities, not by matching application version numbers. Each Suna App release states its supported Runtime protocol versions.

## Desktop bundle

Ship the Gateway and a prebuilt Runtime in one zip / `.app`. After install the user double-clicks, the system browser opens, and API keys are entered in Settings. `suna` does not need to be on `PATH`.

```powershell
$env:SUNA_RUNTIME = "C:\path\to\suna.exe"
.\scripts\build-desktop.ps1 -Version v0.1.0 -Goarch amd64
```

```bash
SUNA_RUNTIME=/path/to/suna ./scripts/build-desktop.sh v0.1.0 darwin arm64
```

Layout:

```text
Windows:  suna-app.exe + runtime/suna.exe
macOS:    Suna.app/Contents/MacOS/suna-app
          Suna.app/Contents/Resources/runtime/suna
```

Closing the browser tab does not quit the Gateway. Use Settings → Connection → Quit app. Logs: `~/.suna-app/logs/app.log`.

## License

MIT. See [LICENSE](LICENSE).
