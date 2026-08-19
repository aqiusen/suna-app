# Architecture

Suna App is a standalone GUI client for an installed Suna Runtime. It has its own source repository, dependencies, CI, release artifacts and user-facing UI, while Suna Runtime remains responsible for all Agent business semantics.

## System boundary

```text
┌──────────────────────────────────────┐
│              Suna App                │
│                                      │
│  React Web / PWA                     │
│          │ HTTP + WebSocket          │
│  Go Gateway                           │
│          │ public TCP NDJSON protocol│
└──────────┼───────────────────────────┘
           │
┌──────────▼───────────────────────────┐
│            Suna Runtime              │
│                                      │
│  CLI / TUI / daemon                  │
│  Session / Agent / Runner / Guard    │
│  tools / attachments / MCP / Skills  │
└──────────────────────────────────────┘
```

Suna App never imports Runtime private Go packages and never reads Runtime storage directly.

## Runtime connection

The Gateway follows the documented third-party client flow:

1. discover or start the installed Runtime with `suna serve --json`;
2. read the returned authoritative `tcp_endpoint`;
3. open a TCP connection and send `runtime.hello` as the first request;
4. verify the supported protocol version and capabilities;
5. expose approved public session, agent, Guard and AskUser methods and notifications through local HTTP and SSE.

The endpoint is loopback-only. The browser only talks to Gateway; it never accesses Runtime TCP directly.

## Ownership

| Layer | Owns | Must not own |
|---|---|---|
| Runtime | session state, Agent runs, Guard, tools, persistence, attachments | browser delivery or Web UI state |
| Gateway | Runtime discovery, public protocol client, browser contract, validation, auth, cancellation and reconnect adaptation | Agent policy, Guard decisions, storage or model execution |
| Frontend | UI state, responsive rendering, drafts and user interactions | local filesystem, Runtime credentials, protocol persistence |

## Initial product scope

The first usable increment is a loopback-only browser client with:

- clear Runtime discovery and compatibility status;
- Session list, create and attach;
- streamed chat output and run lifecycle;
- Guard and AskUser actions;
- stop/retry state and reconnect handling.

Remote exposure, pairing, PWA installation, image upload, desktop packaging and a full event replay cursor are later increments. They must be added through explicit public contracts, never as Gateway-only shortcuts.

## Development topology

Development uses a locally installed Suna Runtime release, not the Runtime source checkout:

```text
installed suna release
        ↑
Gateway
        ↑
Vite dev server / HMR
        ↑
browser
```

Vite proxies browser HTTP and SSE traffic to Gateway. Browser code must not use a separate direct Runtime connection in development.

## Release topology

Suna App and Suna Runtime are independently versioned and released. Compatibility is protocol-based:

```text
Suna App supports protocol 0.3
Runtime speaks protocol 0.3
→ compatible
```

A release embeds the built frontend assets in the `suna-app` Gateway artifact. It never embeds the frontend in the `suna` Runtime artifact.

## Desktop bundle topology

The desktop increment ships the two official binaries **side by side**. The Gateway still does not import Runtime packages; it locates a bundled `runtime/suna` (or `Contents/Resources/runtime/suna` in a macOS `.app`) and runs the public `suna serve --json` flow.

```text
suna-app.exe / Suna.app
        │
        ├─ HTTP + SSE to the system browser
        └─ exec bundled runtime/suna serve --json
                    │
                    └─ loopback TCP protocol (unchanged)
```

API keys stay in the Runtime data directory (`~/.suna/credentials.toml`) via `config.set`. App logs go to `~/.suna-app/logs/app.log`.

Build with `scripts/build-desktop.sh` or `scripts/build-desktop.ps1` and `SUNA_RUNTIME` pointing at a prebuilt Runtime binary.
