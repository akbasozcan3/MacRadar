# Realtime Player Tracking

## Payload

Client and server use a compact websocket payload:

```json
{
  "t": "p",
  "pid": "player-ab12",
  "rid": "istanbul-night-drive",
  "ts": 1741540805123,
  "sq": 42,
  "lat": 41.008251,
  "lng": 28.978409,
  "spd": 1.14,
  "hdg": 92.4,
  "acc": 4.8,
  "mx": 1.13,
  "my": -0.05,
  "src": "fused"
}
```

Field notes:

- `t`: message type, `p` position, `s` snapshot, `l` leave, `a` ack
- `pid`: player id
- `rid`: room id
- `ts`: client timestamp in milliseconds
- `sq`: per-player sequence number
- `lat` / `lng`: current fused coordinate
- `spd`: meters per second
- `hdg`: heading in degrees
- `acc`: GPS accuracy in meters
- `mx` / `my`: east/north motion vector
- `src`: `gps` or `fused`

## Smoothing

Client side smoothing has two layers:

1. Local prediction

   - GPS fixes remain the ground truth.
   - Between GPS fixes, accelerometer + gyroscope + heading keep the marker moving for up to 900 ms.
   - Predicted drift is clamped to 2.2 meters so local markers do not run away.

2. Remote interpolation
   - Each remote player keeps a 140 ms interpolation buffer.
   - If rendering runs ahead of the latest packet, the client extrapolates for at most 320 ms using `spd + hdg`.
   - Stale remote players are dropped after 4.5 seconds.

## Recommended intervals

- GPS event source: `distanceFilter=0`, high accuracy, 100-250 ms when foreground map is active
- Accelerometer: `80 ms`
- Gyroscope: `80 ms`
- Heading / compass: `80-120 ms`
- Client publish throttle: `120 ms`
- Forced heartbeat publish: `1000 ms`
- Remote render tick: `33 ms` (about 30 FPS)
- Interpolation back time: `140 ms`

## Production folder layout

```text
src/
  realtime/
    components/
      LivePlayerMarker.tsx
    config.ts
    math.ts
    motionStream.ts
    nativeModules.ts
    playerInterpolator.ts
    playerSocket.ts
    types.ts
    useRealtimePlayers.ts
  location/
    MapboxScreen.tsx

backend/
  go/
    internal/
      realtime/
        hub.go
        models.go
      server/
        realtime_handlers.go
  node/
    server.js
```

## Scaling notes

- Optional native sensor packages for the React Native side:

  - `react-native-sensors`
  - `react-native-compass-heading`

- If these packages are added later, register them through `src/realtime/nativeModules.ts` before starting tracking.

- For 1-30 players, `MarkerView` is acceptable.
- For larger rooms, move remote players to `ShapeSource + SymbolLayer`.
- Keep websocket frames small; send deltas by policy, not every sensor tick.
- Treat sensors as prediction input, not permanent truth. GPS remains the authority.
