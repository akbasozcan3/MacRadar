# MacRadar Backend

Single backend root now lives under `backend/`.

```text
backend/
  node/        primary local Node.js backend
  go/          optional Go API and realtime server module
  rust/        Rust sensor websocket hub
  migrations/  shared SQL migrations for the Go service
  scripts/     backend-specific dev and test scripts
```

Primary local auth and API backend now runs with Node.js and starts on port `8090`.

It serves:

- landing overview metrics
- login / register / verify-email / resend-verification / social auth session flows
- password reset with email OTP style code flow
- authenticated password change flow from profile/security
- synced profile read + update endpoints
- existing explore feed, comments, reactions, and follow actions
- WebSocket realtime events for the explore feed

Auth note: email verification challenge is issued on register flow. Login flow does not enforce or trigger email verification challenge.

## Local startup

1. Start everything from the repo root:

```bash
npm start
```

This starts:

- Node backend on `http://127.0.0.1:8090`
- Metro bundler for React Native

By default `npm start` launches the Node backend and Metro together.
Startup now also runs an automatic Node self-check (`healthz + auth contract`).
Node backend startup scripts now auto-load env values from:

- repo root `.env`
- `backend/.env` (overrides root when root is empty)

PowerShell example:

```powershell
$env:BACKEND_CLEAN_ON_START="1"; npm start
```

Disable startup self-check if needed:

```powershell
$env:NODE_START_SELF_CHECK="0"; npm start
```

If you only want the backend stack from inside the backend folder:

```bash
cd backend
npm start
```

PostgreSQL + sensor odakli stack (onerilen):

```bash
cd backend
npm run start:all
```

`start:all` artik `start-stack --strict` ile calisir:

- Go backend `:8090` (PostgreSQL) zorunlu
- Rust sensor bridge varsayilan olarak acik
- Go -> Node fallback kapali (`GO_ENABLE_NODE_FALLBACK=0`)
- Rust binary derlenemezse sensor icin node fallback denenir

2. Legacy Node backend only:

```bash
npm run backend:start
```

This starts the Node backend on `http://127.0.0.1:8090`.

3. Start backend development stack:

```bash
npm run backend:dev
```

This starts:

- Node backend on `http://127.0.0.1:8090`

4. Optional: start only the Go backend:

```bash
npm run backend:go
```

5. Optional: start only the Rust sensor backend:

```bash
npm --prefix backend run rust:sensor
```

6. Metro only:

```bash
npm run start:metro
```

7. Run checks:

```bash
npm run backend:test
npm run typecheck
```

`backend:test` now runs a Go auth smoke flow for register -> verify -> login -> password reset in local debug mode.

Profile settings smoke check:

```bash
npm run backend:test:profile
```

Legacy Node smoke check:

```bash
npm run backend:test:node
```

Lightweight Node startup self-check only:

```bash
npm --prefix backend run self-check:node
```

SMTP test maili gonder:

```bash
npm --prefix backend run test:smtp
```

Hedef adresi degistirmek icin:

```bash
SMTP_TEST_TO=you@example.com npm --prefix backend run test:smtp
```

Go backend checks:

```bash
npm run backend:test:go
```

Go messaging + camera upload matrix check:

```bash
npm run backend:test:go:matrix
```

Go unit/integration package tests:

```bash
npm run backend:test:go:unit
```

## Environment

Copy `backend/.env.example` into your local env and fill these values before testing email verification and password reset:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `APP_BASE_URL`
- `AUTH_DEBUG_PREVIEW`
- `JWT_SECRET`
- `ADMIN_POST_HARD_DELETE_TOKEN` (optional, only for admin hard delete endpoint)
- `BCRYPT_COST`
- `PASSWORD_RESET_CODE_TTL`
- `PASSWORD_RESET_RESEND_COOLDOWN`

For Gmail SMTP, enable 2FA on the Google account and create an App Password. Put the app password into `SMTP_PASS`.

Node backend now sends verification/reset codes through SMTP when `SMTP_*` is configured.

`AUTH_DEBUG_PREVIEW` defaults to `false` in the Node backend.

When `AUTH_DEBUG_PREVIEW=true`, local development responses include a debug verification/reset code only if SMTP delivery falls back to `debug` mode. Keep this disabled in production.

Go backend lives under `backend/go` and uses the shared SQL files in `backend/migrations`.

Rust sensor bridge is controlled with:

- `RUST_SENSOR_BRIDGE_ENABLED` (default: `false`)
- `RUST_SENSOR_WS_URL` (default: `ws://127.0.0.1:8181/ws/sensors`)
- `START_RUST_SENSOR_NODE_FALLBACK` (default: `true`)
- `START_GO_EXPLORE_SEED` (default: `false`, dev-only seeding helper)
- `START_MESSAGES_CAMERA_MATRIX` (default: `true`, startup flow matrix)

`npm start` and `npm run backend:dev` auto-start the Rust sensor hub and enable the bridge for that session.

## Endpoints

- `GET /healthz`
- `GET /api/v1/app/overview`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/verify-email?token=...`
- `POST /api/v1/auth/resend-verification`
- `POST /api/v1/auth/password-reset/request`
- `POST /api/v1/auth/password-reset/confirm`
- `POST /api/v1/auth/social`
- `POST /api/v1/auth/logout`
- `GET /api/v1/profile/me`
- `PATCH /api/v1/profile/me`
- `DELETE /api/v1/profile/me/posts/{postID}` (soft delete, owner only)
- `DELETE /api/v1/admin/profile/posts/{postID}` (hard delete, admin token + auth required)
- `GET /api/v1/profile/privacy`
- `PATCH /api/v1/profile/privacy`
- `GET /api/v1/map/preferences`
- `PATCH /api/v1/map/preferences`
- `POST /api/v1/profile/change-password`
- `GET /api/v1/profile/help` (auth required)
- `GET /api/v1/explore/feed?segment=kesfet|takipte|sizin-icin`
- `GET /api/v1/explore/posts/{postID}/comments`
- `POST /api/v1/explore/posts/{postID}/comments`
- `POST /api/v1/explore/posts/{postID}/reactions`
- `POST /api/v1/explore/creators/{creatorID}/follow`
- `GET /api/v1/messages/conversations`
- `GET /api/v1/messages/conversations?unread=true&q=<search>`
- `POST /api/v1/messages/conversations`
- `GET /api/v1/messages/conversations/{conversationID}/messages`
- `POST /api/v1/messages/conversations/{conversationID}/read`
- `POST /api/v1/messages/conversations/{conversationID}/messages`
- `GET /ws/explore`
- `GET /ws/messages`
- `GET /ws/players?room=<roomID>&player=<playerID>`
- `GET /ws/sensors`

Password reset request endpoint contract:

- `200` when a reset challenge is created for an eligible local account.
- `404` with `password_reset_not_allowed` when the email is not eligible (not found, social-only, inactive, etc).

Startup flow matrix contract also verifies:

- unauthenticated protection for `GET /api/v1/messages/conversations` and `POST /api/v1/profile/me/posts`
- authenticated conversation lifecycle (`create -> list -> send -> history -> read`)
- `GET /api/v1/profile/request-summary` returns `messagesUnreadCount` and decrements to `0` after read
- camera upload persistence path (`POST /api/v1/profile/me/posts -> GET /api/v1/profile/me/posts`)
