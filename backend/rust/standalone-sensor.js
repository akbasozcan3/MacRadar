// Simple Sensor Hub (Node.js version) - Standalone
const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
const PORT = 8181;

// Sample sensors data
const sensors = new Map([
  ['temp_001', {
    id: 'temp_001',
    type: 'temperature',
    value: 23.5,
    unit: 'celsius',
    status: 'active',
    location: { latitude: 41.0082, longitude: 28.9784 },
    lastUpdated: new Date().toISOString()
  }],
  ['humid_001', {
    id: 'humid_001',
    type: 'humidity',
    value: 65.2,
    unit: 'percent',
    status: 'active',
    location: { latitude: 41.0082, longitude: 28.9784 },
    lastUpdated: new Date().toISOString()
  }],
  ['pressure_001', {
    id: 'pressure_001',
    type: 'pressure',
    value: 1013.25,
    unit: 'hPa',
    status: 'active',
    location: { latitude: 41.0082, longitude: 28.9784 },
    lastUpdated: new Date().toISOString()
  }]
]);

// WebSocket server
const wsServer = new WebSocket.Server({ port: 8182 });

wsServer.on('connection', (ws) => {
  console.log('[SensorHub] WebSocket client connected');
  
  // Send initial sensor data
  ws.send(JSON.stringify({
    type: 'initial_data',
    sensors: Array.from(sensors.values()),
    timestamp: new Date().toISOString()
  }));
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('[SensorHub] WebSocket message:', message);
    } catch (error) {
      console.error('[SensorHub] WebSocket error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('[SensorHub] WebSocket client disconnected');
  });
});

// Start sensor simulation
const startTime = Date.now();
setInterval(() => {
  sensors.forEach((sensor, id) => {
    // Simulate realistic sensor variations
    let newValue = sensor.value;
    
    switch (sensor.type) {
      case 'temperature':
        newValue = sensor.value + (Math.random() - 0.5) * 0.5;
        break;
      case 'humidity':
        newValue = Math.max(0, Math.min(100, sensor.value + (Math.random() - 0.5) * 2));
        break;
      case 'pressure':
        newValue = sensor.value + (Math.random() - 0.5) * 5;
        break;
    }
    
    sensor.value = parseFloat(newValue.toFixed(2));
    sensor.lastUpdated = new Date().toISOString();
  });
  
  // Broadcast updates
  const update = {
    type: 'sensor_update',
    sensors: Array.from(sensors.values()),
    timestamp: new Date().toISOString()
  };
  
  wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(update));
    }
  });
}, 5000); // Update every 5 seconds

// API Routes
app.use(express.json());

app.get('/healthz', (req, res) => {
  const uptime = Date.now() - startTime;
  
  res.json({
    service: 'rust-sensor-hub',
    status: 'healthy',
    version: '1.0.0',
    uptime_ms: uptime,
    port: PORT,
    sensors_count: sensors.size,
    websocket_port: 8182,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/v1/sensors', (req, res) => {
  res.json({
    success: true,
    sensors: Array.from(sensors.values()),
    total: sensors.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/v1/sensors/:id', (req, res) => {
  const { id } = req.params;
  const sensor = sensors.get(id);
  
  if (!sensor) {
    return res.status(404).json({
      success: false,
      error: 'Sensor not found'
    });
  }
  
  res.json({
    success: true,
    sensor,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦀 Sensor Hub (Node.js) running on port ${PORT}`);
  console.log(`📊 Health endpoint: http://localhost:${PORT}/healthz`);
  console.log(`📡 WebSocket endpoint: ws://localhost:8182`);
  console.log(`🌐 API endpoint: http://localhost:${PORT}/api/v1/sensors`);
});

module.exports = { app, sensors };
