# Rust Sensor Hub

`backend/rust/sensor-hub` is a lightweight WebSocket service for high-frequency sensor events.

Endpoints:

- `GET /healthz`
- `GET /ws/sensors`

Default bind:

- host: `127.0.0.1`
- port: `8181`

Environment variables:

- `RUST_SENSOR_HOST` (default: `127.0.0.1`)
- `RUST_SENSOR_PORT` (default: `8181`)

Run:

```bash
cd backend/rust/sensor-hub
cargo run --release
```
