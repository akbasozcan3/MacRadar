# Mobile API Environment

The app now supports environment-driven backend URLs.

## Variables

- `MACRADAR_API_BASE_URL`: HTTP/HTTPS API base URL (example: `https://api.example.com`)
- `MACRADAR_API_PORT`: Optional fallback port for local development (`8090` by default)
- `MACRADAR_WS_BASE_URL`: Optional explicit WebSocket base URL (example: `wss://api.example.com`)
- `MACRADAR_SENSOR_WS_URL`: Optional dedicated sensor WebSocket endpoint (example: `wss://macradar-rust-sensor.onrender.com/ws/sensors`)

If `MACRADAR_WS_BASE_URL` is empty, WebSocket URLs are derived from `MACRADAR_API_BASE_URL`.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill values for your environment.
3. Run app commands as usual (`npm start`, `npm run android`, `npm run ios`).

## Generation

`npm run env:generate` creates `src/config/appEnv.generated.ts` from `.env` / process env.

Generation also runs automatically in:

- `npm start`
- `npm run android`
- `npm run ios`
- `npm run start:metro`
- `npm postinstall`
