use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;

#[derive(Debug, Serialize, Deserialize)]
struct SensorData {
    id: String,
    sensor_type: String,
    value: f64,
    unit: String,
    timestamp: String,
    location: Option<Location>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Location {
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct HealthResponse {
    service: String,
    status: String,
    version: String,
    uptime_ms: u64,
    port: u16,
    sensors_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct SensorEvent {
    id: String,
    event_type: String,
    data: serde_json::Value,
    timestamp: String,
}

#[derive(Clone)]
struct AppState {
    sensors: HashMap<String, SensorData>,
    events: Vec<SensorEvent>,
    start_time: Instant,
}

impl AppState {
    fn new() -> Self {
        let mut sensors = HashMap::new();
        
        // Initialize sample sensors
        sensors.insert("temp_001".to_string(), SensorData {
            id: "temp_001".to_string(),
            sensor_type: "temperature".to_string(),
            value: 23.5,
            unit: "celsius".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            location: Some(Location { latitude: 41.0082, longitude: 28.9784 }),
        });
        
        sensors.insert("humid_001".to_string(), SensorData {
            id: "humid_001".to_string(),
            sensor_type: "humidity".to_string(),
            value: 65.2,
            unit: "percent".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            location: Some(Location { latitude: 41.0082, longitude: 28.9784 }),
        });
        
        sensors.insert("pressure_001".to_string(), SensorData {
            id: "pressure_001".to_string(),
            sensor_type: "pressure".to_string(),
            value: 1013.25,
            unit: "hPa".to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            location: Some(Location { latitude: 41.0082, longitude: 28.9784 }),
        });

        Self {
            sensors,
            events: Vec::new(),
            start_time: Instant::now(),
        }
    }
}

#[tokio::main]
async fn main() {
    println!("🦀 Rust Sensor Hub starting...");
    
    let state = AppState::new();
    let port = 8181;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    // Create router with CORS
    let app = Router::new()
        .route("/healthz", get(health_handler))
        .route("/api/v1/sensors", get(list_sensors))
        .route("/api/v1/sensors/:id", get(get_sensor))
        .route("/api/v1/sensors/:id/data", post(update_sensor_data))
        .route("/api/v1/events", get(list_events))
        .route("/api/v1/events", post(create_event))
        .layer(
            ServiceBuilder::new()
                .layer(CorsLayer::permissive())
                .into_inner(),
        )
        .with_state(state);

    println!("🚀 Rust Sensor Hub listening on http://0.0.0.0:{}", port);
    println!("📊 Health endpoint: http://localhost:{}/healthz", port);
    println!("📡 API endpoint: http://localhost:{}/api/v1/sensors", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_handler(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "rust-sensor-hub".to_string(),
        status: "healthy".to_string(),
        version: "1.0.0".to_string(),
        uptime_ms: state.start_time.elapsed().as_millis(),
        port: 8181,
        sensors_count: state.sensors.len(),
    })
}

async fn list_sensors(State(state): State<AppState>) -> Json<serde_json::Value> {
    let sensors: Vec<&SensorData> = state.sensors.values().collect();
    
    Json(serde_json::json!({
        "success": true,
        "sensors": sensors,
        "total": sensors.len(),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

async fn get_sensor(
    Path(sensor_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    match state.sensors.get(&sensor_id) {
        Some(sensor) => Ok(Json(serde_json::json!({
            "success": true,
            "sensor": sensor,
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn update_sensor_data(
    Path(sensor_id): Path<String>,
    State(mut state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if let Some(sensor) = state.sensors.get_mut(&sensor_id) {
        // Update sensor data
        if let Some(value) = payload.get("value") {
            if let Some(val) = value.as_f64() {
                sensor.value = val;
            }
        }
        
        sensor.timestamp = chrono::Utc::now().to_rfc3339();
        
        Ok(Json(serde_json::json!({
            "success": true,
            "sensor": sensor,
            "timestamp": chrono::Utc::now().to_rfc3339()
        })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn list_events(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "success": true,
        "events": state.events,
        "total": state.events.len(),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

async fn create_event(
    State(mut state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let event = SensorEvent {
        id: format!("event_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)),
        event_type: payload.get("event_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        data: payload.get("data").cloned().unwrap_or(serde_json::Value::Null),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    
    state.events.push(event.clone());
    
    // Keep only last 100 events
    if state.events.len() > 100 {
        state.events.drain(0..state.events.len() - 100);
    }
    
    Ok(Json(serde_json::json!({
        "success": true,
        "event": event,
        "timestamp": chrono::Utc::now().to_rfc3339()
    })))
}
