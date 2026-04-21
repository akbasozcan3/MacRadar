# MacRadar

MacRadar is a React Native mobile app with a multi-service local backend stack:

- React Native client (`src/`, `components/`, native Android/iOS folders)
- Go API + auth + realtime server (`backend/go`)
- Legacy Node backend for isolated smoke checks (`backend/node`)
- Rust sensor websocket hub with Node fallback support (`backend/rust`)

## Repository Layout

```text
MacRadar/
  android/                  React Native Android project
  ios/                      React Native iOS project
  src/                      App screens, services, components, realtime modules
  backend/
    go/                     Primary API + auth + realtime implementation
    node/                   Legacy Node backend + smoke tooling
    rust/                   Sensor websocket hub
    migrations/             Shared SQL migrations
    scripts/                Backend startup and test scripts
  docs/                     Project-specific technical docs
```

## Prerequisites

- Node.js `>= 22.11.0`
- npm
- React Native environment setup for Android/iOS
- Go toolchain (for Go backend tests)
- Rust toolchain (optional, only needed for native Rust sensor hub build)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure app environment:

```bash
cp .env.example .env
```

3. Optional backend env setup (needed for real email/SMTP scenarios):

```bash
cp backend/.env.example backend/.env
```

4. Start full local stack (Metro + Go backend + optional services):

```bash
npm start
```

5. Run mobile app:

```bash
npm run android
# or
npm run ios
```

## Core Scripts

- `npm start`: Starts app stack (Metro + backend stack script)
- `npm run start:metro`: Metro only
- `npm run android`: Generate env + run Android app
- `npm run ios`: Generate env + run iOS app
- `npm run backend:dev`: Start backend development stack
- `npm run backend:go`: Start only Go backend
- `npm run backend:start`: Start only legacy Node backend
- `npm run backend:test`: Auth flow smoke test
- `npm run backend:test:profile`: Profile settings smoke test
- `npm run backend:test:go`: Go backend test suite
- `npm run backend:test:go:matrix`: Messaging + camera upload flow matrix
- `npm run backend:test:go:unit`: Go package tests (`go test ./...` with local cache dirs)
- `npm run backend:test:node`: Node backend smoke test
- `npm run lint`: ESLint
- `npm run typecheck`: TypeScript no-emit check
- `npm test`: Jest suite
- `npm run verify`: Full local quality gate (lint + typecheck + tests + backend checks)

## Useful Runtime Toggles

PowerShell examples:

```powershell
$env:START_NODE_BACKEND="0"; npm start
$env:START_RUST_SENSOR_BACKEND="0"; npm start
$env:START_RUST_SENSOR_NODE_FALLBACK="0"; npm start
$env:START_GO_EXPLORE_SEED="0"; npm start
$env:START_MESSAGES_CAMERA_MATRIX="0"; npm start
```

## Docs

- `docs/mobile-api-env.md`
- `docs/realtime-tracking.md`
- `docs/realtime-motion-system.md`
- `docs/android-release-signing.md`
- `backend/README.md`

## Troubleshooting

- Confirm `.env` exists at repo root (`.env.example` is provided).
- For backend auth email flows, check `backend/.env` SMTP and auth values.
- If Rust fails to build locally, keep fallback enabled (`START_RUST_SENSOR_NODE_FALLBACK=1`).
- Re-run `npm run verify` before commits to catch regressions early.
