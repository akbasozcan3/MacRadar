use std::{collections::HashMap, env, sync::Arc, time::Instant};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info, warn};

const EVENT_TYPE_READING: &str = "sensor.reading";

#[derive(Clone)]
struct AppState {
    events: broadcast::Sender<SensorEvent>,
    ingest_token: String,
    ingest_url: String,
    last_by_device: Arc<RwLock<HashMap<String, SensorEvent>>>,
    outbound_client: reqwest::Client,
    started_at: Instant,
}

#[derive(Debug, Clone, Serialize)]
struct HealthResponse {
    service: String,
    status: String,
    #[serde(rename = "uptimeMs")]
    uptime_ms: u128,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SensorReading {
    #[serde(default)]
    accuracy: f64,
    #[serde(default, rename = "capturedAt")]
    captured_at: Option<DateTime<Utc>>,
    #[serde(default, rename = "deviceId")]
    device_id: String,
    #[serde(default)]
    heading: f64,
    #[serde(default)]
    latitude: f64,
    #[serde(default)]
    longitude: f64,
    #[serde(default)]
    sequence: i64,
    #[serde(default)]
    sensor: String,
    #[serde(default)]
    speed: f64,
    #[serde(default, rename = "userId")]
    user_id: String,
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    #[serde(default)]
    z: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SensorEvent {
    reading: SensorReading,
    #[serde(default, rename = "serverTime")]
    server_time: Option<DateTime<Utc>>,
    #[serde(default)]
    source: String,
    #[serde(default = "default_event_type", rename = "type")]
    event_type: String,
}

fn default_event_type() -> String {
    EVENT_TYPE_READING.to_owned()
}

fn normalize_event(mut event: SensorEvent, fallback_source: &str) -> SensorEvent {
    if event.event_type.trim().is_empty() {
        event.event_type = EVENT_TYPE_READING.to_owned();
    }

    if event.source.trim().is_empty() {
        event.source = fallback_source.to_owned();
    }

    let now = Utc::now();
    if event.server_time.is_none() {
        event.server_time = Some(now);
    }
    if event.reading.captured_at.is_none() {
        event.reading.captured_at = event.server_time;
    }
    if event.reading.sensor.trim().is_empty() {
        event.reading.sensor = "unknown".to_owned();
    }
    if event.reading.device_id.trim().is_empty() {
        if event.reading.user_id.trim().is_empty() {
            event.reading.device_id = "device_unknown".to_owned();
        } else {
            event.reading.device_id = format!("device_{}", event.reading.user_id.trim());
        }
    }

    event
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sensor_hub=debug".into()),
        )
        .with_target(false)
        .compact()
        .init();

    let host = env::var("RUST_SENSOR_HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
    let port = env::var("RUST_SENSOR_PORT").unwrap_or_else(|_| "8181".to_owned());
    let ingest_url = env::var("GO_TRACKING_INGEST_URL").unwrap_or_default();
    let ingest_token = env::var("GO_TRACKING_INGEST_TOKEN").unwrap_or_default();
    let event_buffer_capacity = env::var("RUST_SENSOR_EVENT_BUFFER")
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .filter(|capacity| *capacity >= 128 && *capacity <= 65_536)
        .unwrap_or(2048);
    let bind = format!("{host}:{port}");

    let (events, _) = broadcast::channel::<SensorEvent>(event_buffer_capacity);
    let app_state = AppState {
        events,
        ingest_token,
        ingest_url,
        last_by_device: Arc::new(RwLock::new(HashMap::new())),
        outbound_client: reqwest::Client::new(),
        started_at: Instant::now(),
    };

    let app = Router::new()
        .route("/healthz", get(handle_health))
        .route("/ws/sensors", get(handle_sensors_websocket))
        .with_state(app_state);

    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(err) => {
            error!(%err, %bind, "failed to bind rust sensor hub");
            std::process::exit(1);
        }
    };

    info!(%bind, event_buffer_capacity, "rust sensor hub listening");
    if let Err(err) = axum::serve(listener, app).await {
        error!(%err, "rust sensor hub terminated unexpectedly");
    }
}

async fn handle_health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "rust-sensor".to_owned(),
        status: "ok".to_owned(),
        uptime_ms: state.started_at.elapsed().as_millis(),
    })
}

async fn handle_sensors_websocket(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        process_socket(socket, state).await;
    })
}

async fn process_socket(socket: WebSocket, state: AppState) {
    let (mut writer, mut reader) = socket.split();
    let mut receiver = state.events.subscribe();

    let outgoing = tokio::spawn(async move {
        while let Ok(event) = receiver.recv().await {
            match serde_json::to_string(&event) {
                Ok(payload) => {
                    if writer.send(Message::Text(payload)).await.is_err() {
                        return;
                    }
                }
                Err(err) => warn!(%err, "failed to serialize sensor event"),
            }
        }
    });

    while let Some(next) = reader.next().await {
        let message = match next {
            Ok(message) => message,
            Err(err) => {
                warn!(%err, "sensor websocket read failed");
                break;
            }
        };

        let text_payload = match message {
            Message::Text(payload) => payload,
            Message::Binary(payload) => match String::from_utf8(payload.to_vec()) {
                Ok(decoded) => decoded,
                Err(_) => continue,
            },
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => continue,
        };

        let incoming: SensorEvent = match serde_json::from_str(&text_payload) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };

        let event = normalize_event(incoming, "rust.ws");
        if event.event_type != EVENT_TYPE_READING {
            continue;
        }

        {
            let mut lock = state.last_by_device.write().await;
            lock.insert(event.reading.device_id.clone(), event.clone());
        }

        if !state.ingest_url.trim().is_empty()
            && !state.ingest_token.trim().is_empty()
            && !event.reading.user_id.trim().is_empty()
        {
            let ingest_url = state.ingest_url.clone();
            let ingest_token = state.ingest_token.clone();
            let outbound_client = state.outbound_client.clone();
            let ingest_payload = serde_json::json!({
                "accuracy": event.reading.accuracy,
                "heading": event.reading.heading,
                "latitude": event.reading.latitude,
                "longitude": event.reading.longitude,
                "roomId": "global",
                "sequence": event.reading.sequence,
                "source": event.source,
                "speed": event.reading.speed,
                "timestamp": event.reading
                    .captured_at
                    .as_ref()
                    .map(|captured| captured.timestamp_millis())
                    .unwrap_or_else(|| Utc::now().timestamp_millis()),
                "userId": event.reading.user_id,
            });

            tokio::spawn(async move {
                let result = outbound_client
                    .post(ingest_url)
                    .header("x-tracking-token", ingest_token)
                    .json(&ingest_payload)
                    .send()
                    .await;
                if let Err(err) = result {
                    warn!(%err, "tracking ingest forward failed");
                }
            });
        }

        let _ = state.events.send(event);
    }

    outgoing.abort();
}
