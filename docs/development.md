# Development

## Prerequisites

- Go 1.26 or later
- Node.js 22 or later
- pnpm 10 or later
- A compatible Suna Runtime release available on `PATH` when exercising the live Runtime bridge

Suna App connects to an installed Runtime through its documented public client interface. A Runtime source checkout is neither required nor used by the normal frontend or Gateway checks.

## Local HMR development

Run the Gateway and Vite in separate terminals. The Gateway listens only on loopback at `127.0.0.1:7633`; Vite also binds to loopback and proxies browser requests for `/api` and `/healthz` to it. Gateway event updates use SSE over the `/api` routes; no additional development proxy is needed.

The Gateway resolves the Runtime binary in this order:

1. explicit `--suna-binary` path;
2. bundled runtime next to the executable (`runtime/suna`, or macOS app Resources);
3. an installed desktop app's bundled runtime (`/Applications/Suna.app/...` or `~/Applications/Suna.app/...`, macOS only) — so a dev machine with the packaged app installed needs no separate CLI install;
4. the bare name on `PATH`.

Terminal 1:

```bash
cd gateway
go run ./cmd/suna-app
```

Terminal 2:

```bash
cd frontend
pnpm install
pnpm dev
```

Open the loopback URL printed by Vite. Vite provides HMR for frontend source changes, while API and SSE requests stay same-origin from the browser's perspective through the proxy.

## Component commands

Run checks directly from each component directory:

```bash
cd frontend
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd ../gateway
gofmt -w .
go vet ./...
go test ./...
go build ./...
```

The ordinary Gateway test suite uses in-memory frontend filesystems and does not require `frontend/dist`. `go:embed` remains valid in a clean checkout because `gateway/internal/webassets/dist/.gitkeep` is tracked. When a binary starts without a staged `index.html`, its UI handler returns a clear `503` build/stage instruction rather than a stale SPA fallback.

## Frontend release assets

Release builds make the embed boundary explicit:

```bash
cd frontend
pnpm build

cd ..
./scripts/stage-frontend.sh

cd gateway
go test -tags=integration ./internal/webassets
```

`stage-frontend.sh` requires `frontend/dist/index.html`, copies the build output to `gateway/internal/webassets/dist`, and preserves the tracked `.gitkeep`. The `integration` test verifies that the embedded index shell and every local `/assets/` reference from it are present. It is intentionally outside ordinary `go test ./...`.

To build the cross-platform release archives, run:

```bash
cd frontend
pnpm build

cd ..
./scripts/build-release.sh v0.0.0
```

`build-release.sh` invokes staging, runs the tagged embedded-asset smoke test, and then creates the archives in `dist/`. Do not manually copy frontend files for release builds.

## Runtime connection contract

Gateway must use this sequence:

```text
suna serve --json
→ tcp_endpoint
→ TCP NDJSON connection
→ runtime.hello
→ protocol/capability check
```

Do not hard-code a Runtime port. Do not parse stderr as a protocol. Do not connect browser code to Runtime TCP.

## Gateway boundaries

Gateway is a standalone Go module. Its internal packages are separated by adapter responsibility:

```text
internal/runtime/  Runtime discovery, serve and public protocol client
internal/bridge/   browser-to-Runtime protocol translation
internal/httpapi/  HTTP, SSE, auth and upload endpoints
internal/config/   Gateway-only configuration
internal/observe/  redacted logs and health state
```

Gateway must never implement Runtime business policy.

## Quality checks

Run before committing:

```bash
cd frontend
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd ../gateway
gofmt -w .
go vet ./...
go test ./...
go build ./...

cd ..
git diff --check
git status --short
```

Default checks must be offline, quick, and deterministic. Use fake Runtime servers and public protocol fixtures for Gateway tests. Networked Runtime or browser end-to-end tests must be explicitly marked as integration tests.
