# Realtime Motion Tracking (Production Baseline)

## 1) Root Design (Why This Stack)
- **React Native + TypeScript (client):** sensor access + map rendering + strict typing with low iteration cost.
- **Go + native WebSocket (backend):** low-latency fanout, predictable memory profile, easy room-based concurrency.
- **Server-authoritative rooms:** backend validates and sanitizes movement updates before rebroadcast.
- **Client interpolation + short prediction:** smooth marker motion while preserving instant local feedback.

## 2) Architecture
- **Client loops**
  - **Sensor loop:** accelerometer/gyroscope/heading stream -> motion snapshot cache (ref-based).
  - **GPS loop:** OS location updates -> truth state.
  - **Publish loop:** throttled outbound WebSocket updates with movement thresholds.
  - **Render loop:** `requestAnimationFrame` interpolation/extrapolation for local + remote players.
- **Backend loops**
  - **Read pump:** per-client inbound frames -> validation/sanitization.
  - **Room manager/hub:** keep latest player states per room.
  - **Broadcast pipeline:** only rebroadcast meaningful updates.
  - **Stale sweeper:** evict inactive players and broadcast leave event.

## 3) Suggested Folder Structure
- **Frontend**
  - `src/realtime/config.ts`
  - `src/realtime/types.ts`
  - `src/realtime/protocol.ts`
  - `src/realtime/math.ts`
  - `src/realtime/motionStream.ts`
  - `src/realtime/playerInterpolator.ts`
  - `src/realtime/playerSocket.ts`
  - `src/realtime/useRealtimePlayers.ts`
  - `src/realtime/components/LivePlayerMarker.tsx`
- **Backend (Go)**
  - `backend/go/internal/realtime/protocol.go`
  - `backend/go/internal/realtime/models.go`
  - `backend/go/internal/realtime/validation.go`
  - `backend/go/internal/realtime/service.go`
  - `backend/go/internal/realtime/client.go`
  - `backend/go/internal/realtime/hub.go`
  - `backend/go/internal/server/realtime_handlers.go`

## 4) Realtime Flow
1. **Sensor input**
   - `motionStream` emits accelerometer + gyroscope + heading snapshot.
2. **Local prediction**
   - `useRealtimePlayers` blends GPS truth with short-window motion prediction (`src: "fused"`).
3. **Payload creation**
   - client builds `PlayerPositionPayload` including motion fields (`ax/ay/az/gx/gy/gz/me/ha`).
4. **WebSocket publish**
   - publish gated by interval, distance, heading delta, speed delta, motion-energy delta.
5. **Remote interpolation**
   - remote snapshots buffered per player and sampled via interpolation-back-time.
6. **Render update**
   - frame loop commits only meaningful visual delta to avoid unnecessary re-renders.

## 5) Message Schema (Current Baseline)

### Position (`t: "p"`)
```json
{
  "t": "p",
  "rid": "istanbul-night-drive",
  "pid": "user_123",
  "sq": 1288,
  "ts": 1710000000000,
  "lat": 41.0082,
  "lng": 28.9784,
  "spd": 3.2,
  "hdg": 124.0,
  "acc": 4.8,
  "src": "fused",
  "mx": 2.6,
  "my": -1.9,
  "ax": 0.11,
  "ay": 0.38,
  "az": 0.98,
  "gx": 0.01,
  "gy": 0.03,
  "gz": 0.04,
  "me": 0.42,
  "ha": 12.0
}
```

### Snapshot (`t: "s"`)
```json
{ "t": "s", "rid": "istanbul-night-drive", "ts": 1710000000100, "ps": [/* positions */] }
```

### Leave (`t: "l"`) / Ack (`t: "a"`)
```json
{ "t": "l", "rid": "istanbul-night-drive", "pid": "user_123", "ts": 1710000000200 }
{ "t": "a", "rid": "istanbul-night-drive", "pid": "user_456", "ts": 1710000000205 }
```

## 6) Frontend vs Backend Responsibilities
- **Frontend**
  - collect GPS + sensor stream
  - local smoothing/prediction
  - publish throttling
  - remote interpolation and stable marker rendering
  - UI diagnostics and live-follow interactions
- **Backend**
  - trust boundary and payload sanitization
  - ordering checks (`seq` + timestamp)
  - per-room authoritative state
  - stale player eviction + leave broadcasts
  - bounded fanout with low overhead

## 7) Operational Defaults
- Publish interval floor: **~60ms**
- Heartbeat: **1s**
- Interpolation back-time: **~110ms**
- Max extrapolation: **~240ms**
- Player stale TTL: **5s**
- Stale sweep interval: **1s**

## 8) Smoothing / Prediction Notes
- Local view uses blend + short prediction window from motion energy.
- Prediction drift is clamped (`maxPredictionDriftMeters`) to avoid teleporting.
- Remote players use interpolation first, extrapolation only for short gaps.

## 9) Stale Cleanup / Diagnostics
- Backend removes stale players and emits `leave`.
- Client removes stale interpolators and updates diagnostics:
  - `gpsAgeMs`
  - `motionEnergy`
  - `publishedAt`
  - `remoteCount`
  - `socketStatus`

## 10) Refactor Guidance (Next Iteration)
- Add room sharding (in-memory partition or Redis pub/sub) for horizontal scale.
- Add authenticated player identity for `/ws/players`.
- Persist follow/block relationships and map visibility policy in realtime broadcast path.
- Add performance counters (publish rate, dropped frame, outbound queue saturation).
