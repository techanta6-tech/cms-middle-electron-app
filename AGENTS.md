# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project shape
- Monorepo-style Electron app with three runnable parts:
  - Root Electron wrapper (`main.js`, `preload.js`) that runs the FE client only
  - Standalone backend middle server (`cms-middle-be`, Express + Socket.IO)
  - Frontend UI (`cms-middle-fe`, React + Vite + TypeScript)
- Root scripts keep the backend separate from the Electron package so multiple FE/Electron clients can connect to one BE instance.

## Essential commands
Run commands from repository root unless noted.

### Install dependencies
```bash
yarn install
yarn --cwd cms-middle-be install
yarn --cwd cms-middle-fe install
```

### Local development
```bash
yarn dev
```
- Runs `scripts/detect-ip.js`, then starts:
  - frontend (`yarn dev:fe`)
  - electron (`yarn dev:electron`, waits for port 5173)

Run the shared backend separately when needed:
```bash
yarn dev:be
```

Run all local parts together for a smoke test:
```bash
yarn dev:all
```

Run parts individually when debugging:
```bash
yarn dev:be
yarn dev:fe
yarn dev:electron
```

### Build/package
```bash
yarn build
```
- Builds FE (`cms-middle-fe/dist`) then packages Electron with `electron-builder`.
- The Electron package contains only the FE client and does not bundle or spawn the BE.

Build FE or BE separately:
```bash
yarn build:fe
yarn build:be
```

`yarn build:be` creates the standalone backend artifact under `build-be/`.

Build both independent artifacts:
```bash
yarn build:all
```

### Lint
```bash
yarn --cwd cms-middle-fe lint
```

Lint a single FE file:
```bash
yarn --cwd cms-middle-fe eslint src/App.tsx
```

### Tests
- No automated test framework is configured in this repository right now.
- `yarn --cwd cms-middle-be test` starts the backend server (`node index.js`) and is not a unit/integration test runner.
- “Run a single test” is currently not available; use targeted manual API/UI checks.

### Useful maintenance
```bash
yarn clean
```
- Clears Electron app data/local storage under OS app-data directories via `scripts/clear-storage.js`.

## Environment and runtime wiring
- Root `.env` provides `FE_PORT` and `BE_PORT`; optional `BE_HOST` can set the default FE target backend host.
- `scripts/detect-ip.js` auto-detects local IPv4 and writes:
  - `cms-middle-fe/.env.local` (`VITE_HOST`, `VITE_PORT`, `VITE_BE_HOST`, `VITE_BE_PORT`)
  - `.env.generated` (`LOCAL_IP`, `FE_PORT`, `BE_HOST`, `BE_PORT`)
- `scripts/detect-ip.js` does not probe or auto-shift `BE_PORT`; a busy BE port can be the intended shared backend.
- Backend startup (`cms-middle-be/index.js`) loads:
  - `cms-middle-be/.env`
  - root `.env.generated` (overrides shared host/port fields)

## High-level architecture

### 1) Electron container
- `main.js` creates the desktop window.
- In dev: loads Vite URL (`http://localhost:5173`).
- In packaged mode: loads `cms-middle-fe/dist/index.html`.
- Electron does not spawn, wait for, or terminate a backend process.

### 2) Middle backend (Express + Socket.IO)
- Entry: `cms-middle-be/index.js` → HTTP server + Socket.IO init + route app + monitoring cron.
- App assembly: `cms-middle-be/src/app.js`.
- Shared in-memory state: `cms-middle-be/src/socketState.js`
  - `connections[]` (registered peer middle servers)
  - `servers` map (latest server-info snapshots)
  - `devices` map (latest device snapshots per server)
- Socket event bootstrap: `cms-middle-be/src/socketEvents.js` (FE client connect/disconnect sync).

Core route responsibilities:
- `routes/auth.routes.js`: local admin login fallback + optional proxy login to CMS backend.
- `routes/logs.routes.js`: ingest logs, emit to FE via socket, forward to `send` targets with auth-retry-on-401.
- `routes/server.routes.js`: ingest server/device snapshots, emit full-state snapshots to FE, optionally forward to CMS backend and peer targets; supports initial data sync to new send-target.
- `routes/connections.routes.js`: create/remove/list peer connections and optional forced client disconnect.
- `routes/health.routes.js`: healthcheck and authenticated server-information endpoint.

Monitoring:
- `services/check-server.service.js` runs a cron TCP ping every 30s over known servers and logs status table.

### 3) Frontend (React + Vite)
- Entry: `cms-middle-fe/src/main.tsx`.
- Route shell: `cms-middle-fe/src/App.tsx` (`/login`, protected `/dashboard`).
- Central real-time state and socket listeners: `cms-middle-fe/src/hooks/useSocketManager.ts`.
- Socket singleton + dynamic BE retargeting: `cms-middle-fe/src/socket.ts`.
- Axios client + auth interceptor: `cms-middle-fe/src/api/apiClient.ts`.
- Login and BE host/port override UI: `cms-middle-fe/src/components/LoginPage.tsx`.
- Dashboard status/connection management UI is centered in `components/StatusBar/StatusBar.tsx`.

## Data flow to keep in mind
- External/VMS sources post into middle BE (`/api/v1/logs`, `/api/v1/server`, `/api/v1/devices`).
- BE updates in-memory state, pushes socket events to FE, and may forward data:
  - upstream to CMS BE (if configured),
  - laterally to peer middle servers in `send` mode.
- FE state is event-driven from socket updates plus `/api/v1/connections` fetch as source-of-truth for connection lists.
- BE target host/port can be changed at runtime from FE; FE persists target in `localStorage` (`BE_HOST`, `BE_PORT`) and reconfigures both axios baseURL and socket endpoint.
