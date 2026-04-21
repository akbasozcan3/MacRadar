// Professional Sensor Hub Service (Node.js Alternative)
const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');

class SensorHub {
  constructor() {
    this.sensors = new Map();
    this.events = [];
    this.clients = new Map();
    this.startTime = Date.now();
    this.initializeSensors();
  }

  initializeSensors() {
    // Initialize sample sensors
    this.sensors.set('temp_001', {
      id: 'temp_001',
      type: 'temperature',
      value: 23.5,
      unit: 'celsius',
      status: 'active',
      location: { latitude: 41.0082, longitude: 28.9784 },
      lastUpdated: new Date().toISOString(),
      history: []
    });

    this.sensors.set('humid_001', {
      id: 'humid_001',
      type: 'humidity',
      value: 65.2,
      unit: 'percent',
      status: 'active',
      location: { latitude: 41.0082, longitude: 28.9784 },
      lastUpdated: new Date().toISOString(),
      history: []
    });

    this.sensors.set('pressure_001', {
      id: 'pressure_001',
      type: 'pressure',
      value: 1013.25,
      unit: 'hPa',
      status: 'active',
      location: { latitude: 41.0082, longitude: 28.9784 },
      lastUpdated: new Date().toISOString(),
      history: []
    });

    this.sensors.set('light_001', {
      id: 'light_001',
      type: 'light',
      value: 850,
      unit: 'lux',
      status: 'active',
      location: { latitude: 41.0082, longitude: 28.9784 },
      lastUpdated: new Date().toISOString(),
      history: []
    });

    // Start sensor simulation
    this.startSensorSimulation();
  }

  startSensorSimulation() {
    setInterval(() => {
      this.simulateSensorReadings();
    }, 5000); // Update every 5 seconds
  }

  simulateSensorReadings() {
    this.sensors.forEach((sensor, id) => {
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
        case 'light':
          newValue = Math.max(0, sensor.value + (Math.random() - 0.5) * 100);
          break;
      }

      // Update sensor
      sensor.value = parseFloat(newValue.toFixed(2));
      sensor.lastUpdated = new Date().toISOString();
      
      // Keep history (last 100 readings)
      sensor.history.push({
        value: sensor.value,
        timestamp: sensor.lastUpdated
      });
      
      if (sensor.history.length > 100) {
        sensor.history.shift();
      }

      // Broadcast to WebSocket clients
      this.broadcastSensorUpdate(id, sensor);
    });
  }

  broadcastSensorUpdate(sensorId, sensorData) {
    const message = {
      type: 'sensor_update',
      sensorId,
      data: sensorData,
      timestamp: new Date().toISOString()
    };

    this.clients.forEach((ws, clientId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  addEvent(eventData) {
    const event = {
      id: this.generateEventId(),
      type: eventData.type || 'sensor_event',
      data: eventData.data || {},
      sensorId: eventData.sensorId || null,
      severity: eventData.severity || 'info',
      timestamp: new Date().toISOString()
    };

    this.events.unshift(event);
    
    // Keep only last 1000 events
    if (this.events.length > 1000) {
      this.events = this.events.slice(0, 1000);
    }

    // Broadcast event
    this.broadcastEvent(event);
    return event;
  }

  broadcastEvent(event) {
    const message = {
      type: 'sensor_event',
      event,
      timestamp: new Date().toISOString()
    };

    this.clients.forEach((ws, clientId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  generateEventId() {
    return 'event_' + crypto.randomBytes(8).toString('hex');
  }

  getSensorStats(sensorId) {
    const sensor = this.sensors.get(sensorId);
    if (!sensor) return null;

    const history = sensor.history;
    if (history.length === 0) return null;

    const values = history.map(h => h.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;

    return {
      sensorId,
      type: sensor.type,
      current: sensor.value,
      min,
      max,
      average: parseFloat(avg.toFixed(2)),
      unit: sensor.unit,
      location: sensor.location,
      lastUpdated: sensor.lastUpdated,
      dataPoints: history.length
    };
  }

  getAllSensorStats() {
    const stats = {};
    this.sensors.forEach((sensor, id) => {
      stats[id] = this.getSensorStats(id);
    });
    return stats;
  }
}

// Initialize sensor hub
const sensorHub = new SensorHub();

// Express app setup
const app = express();
const PORT = process.env.RUST_SENSOR_PORT || 8181;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Initialize WebSocket server
const wsServer = new WebSocket.Server({ port: 8182 });

wsServer.on('connection', (ws, req) => {
  const clientId = crypto.randomBytes(8).toString('hex');
  sensorHub.clients.set(clientId, ws);
  
  console.log(`[SensorHub] WebSocket client connected: ${clientId}`);
  console.log(`[SensorHub] Total clients: ${sensorHub.clients.size}`);

  // Send current sensor data
  const currentData = sensorHub.getAllSensorStats();
  ws.send(JSON.stringify({
    type: 'initial_data',
    sensors: currentData,
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleWebSocketMessage(clientId, message);
    } catch (error) {
      console.error('[SensorHub] WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    sensorHub.clients.delete(clientId);
    console.log(`[SensorHub] WebSocket client disconnected: ${clientId}`);
    console.log(`[SensorHub] Total clients: ${sensorHub.clients.size}`);
  });

  ws.on('error', (error) => {
    console.error('[SensorHub] WebSocket error:', error);
    sensorHub.clients.delete(clientId);
  });
});

function handleWebSocketMessage(clientId, message) {
  switch (message.type) {
    case 'subscribe_sensor':
      // Handle sensor subscription
      console.log(`[SensorHub] Client ${clientId} subscribed to sensor: ${message.sensorId}`);
      break;
    
    case 'get_sensor_data':
      // Send specific sensor data
      const stats = sensorHub.getSensorStats(message.sensorId);
      if (stats) {
        const client = sensorHub.clients.get(clientId);
        if (client && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'sensor_data_response',
            sensorId: message.sensorId,
            data: stats,
            timestamp: new Date().toISOString()
          }));
        }
      }
      break;
    
    case 'create_event':
      // Create custom event
      const event = sensorHub.addEvent(message.eventData);
      console.log(`[SensorHub] Event created: ${event.id}`);
      break;
  }
}

// API Routes

// Health check
app.get('/healthz', (req, res) => {
  const uptime = Date.now() - sensorHub.startTime;
  
  res.json({
    service: 'rust-sensor-hub',
    status: 'healthy',
    version: '1.0.0',
    uptime_ms: uptime,
    port: PORT,
    sensors_count: sensorHub.sensors.size,
    events_count: sensorHub.events.length,
    websocket_clients: sensorHub.clients.size,
    timestamp: new Date().toISOString()
  });
});

// List all sensors
app.get('/api/v1/sensors', (req, res) => {
  const sensors = Array.from(sensorHub.sensors.values());
  
  res.json({
    success: true,
    sensors,
    total: sensors.length,
    timestamp: new Date().toISOString()
  });
});

// Get specific sensor
app.get('/api/v1/sensors/:id', (req, res) => {
  const { id } = req.params;
  const sensor = sensorHub.sensors.get(id);
  
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

// Get sensor statistics
app.get('/api/v1/sensors/:id/stats', (req, res) => {
  const { id } = req.params;
  const stats = sensorHub.getSensorStats(id);
  
  if (!stats) {
    return res.status(404).json({
      success: false,
      error: 'Sensor not found'
    });
  }
  
  res.json({
    success: true,
    stats,
    timestamp: new Date().toISOString()
  });
});

// Update sensor data
app.post('/api/v1/sensors/:id/data', (req, res) => {
  const { id } = req.params;
  const { value } = req.body;
  
  const sensor = sensorHub.sensors.get(id);
  if (!sensor) {
    return res.status(404).json({
      success: false,
      error: 'Sensor not found'
    });
  }
  
  sensor.value = parseFloat(value);
  sensor.lastUpdated = new Date().toISOString();
  
  // Add to history
  sensor.history.push({
    value: sensor.value,
    timestamp: sensor.lastUpdated
  });
  
  if (sensor.history.length > 100) {
    sensor.history.shift();
  }
  
  // Broadcast update
  sensorHub.broadcastSensorUpdate(id, sensor);
  
  res.json({
    success: true,
    sensor,
    timestamp: new Date().toISOString()
  });
});

// List events
app.get('/api/v1/events', (req, res) => {
  const { limit = 50, offset = 0, severity } = req.query;
  
  let filteredEvents = sensorHub.events;
  
  if (severity) {
    filteredEvents = filteredEvents.filter(event => event.severity === severity);
  }
  
  const paginatedEvents = filteredEvents.slice(
    parseInt(offset),
    parseInt(offset) + parseInt(limit)
  );
  
  res.json({
    success: true,
    events: paginatedEvents,
    total: filteredEvents.length,
    hasMore: filteredEvents.length > parseInt(offset) + parseInt(limit),
    timestamp: new Date().toISOString()
  });
});

// Create event
app.post('/api/v1/events', (req, res) => {
  const eventData = req.body;
  
  if (!eventData.type) {
    return res.status(400).json({
      success: false,
      error: 'Event type is required'
    });
  }
  
  const event = sensorHub.addEvent(eventData);
  
  res.status(201).json({
    success: true,
    event,
    timestamp: new Date().toISOString()
  });
});

// WebSocket endpoint info
app.get('/ws/sensors', (req, res) => {
  res.json({
    success: true,
    websocket_url: `ws://localhost:8182`,
    message_types: [
      'sensor_update',
      'sensor_event',
      'initial_data',
      'sensor_data_response'
    ],
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦀 Sensor Hub (Node.js) running on port ${PORT}`);
  console.log(`📊 Health endpoint: http://localhost:${PORT}/healthz`);
  console.log(`📡 WebSocket endpoint: ws://localhost:8182`);
  console.log(`🌐 API endpoint: http://localhost:${PORT}/api/v1/sensors`);
  console.log(`⚡ Real-time sensor simulation started`);
});

module.exports = { SensorHub, app, sensorHub };
