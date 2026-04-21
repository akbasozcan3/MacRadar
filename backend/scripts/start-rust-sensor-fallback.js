const http = require('node:http');
const { Buffer } = require('node:buffer');
const { URL } = require('node:url');

const wsRuntime = require('ws');
const WebSocketServer = wsRuntime.WebSocketServer || wsRuntime.Server;

const EVENT_TYPE_READING = 'sensor.reading';
const sensorHost = String(process.env.RUST_SENSOR_HOST || '127.0.0.1');
const sensorPort = Number.parseInt(String(process.env.RUST_SENSOR_PORT || '8181'), 10);
const port = Number.isFinite(sensorPort) && sensorPort > 0 ? sensorPort : 8181;
const startedAt = Date.now();
const clients = new Set();

function nowIso() {
  return new Date().toISOString();
}

function normalizeTimestamp(value, fallbackValue) {
  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return fallbackValue;
  }

  return new Date(parsed).toISOString();
}

function normalizeString(value, fallbackValue = '') {
  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallbackValue;
}

function normalizeEvent(payload, fallbackSource) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const event = { ...payload };
  event.type = normalizeString(event.type, EVENT_TYPE_READING);
  if (event.type !== EVENT_TYPE_READING) {
    return null;
  }
  event.source = normalizeString(event.source, fallbackSource);
  event.serverTime = normalizeTimestamp(event.serverTime, nowIso());

  const reading = event.reading && typeof event.reading === 'object' ? { ...event.reading } : {};
  reading.userId = normalizeString(reading.userId);
  reading.sensor = normalizeString(reading.sensor, 'unknown');
  if (!normalizeString(reading.deviceId)) {
    reading.deviceId = reading.userId ? `device_${reading.userId}` : 'device_unknown';
  } else {
    reading.deviceId = normalizeString(reading.deviceId, 'device_unknown');
  }
  reading.capturedAt = normalizeTimestamp(reading.capturedAt, event.serverTime);

  event.reading = reading;
  return event;
}

function serializeEvent(payload, fallbackSource) {
  const normalized = normalizeEvent(payload, fallbackSource);
  if (!normalized) {
    return null;
  }

  try {
    return JSON.stringify(normalized);
  } catch {
    return null;
  }
}

function broadcast(payload, source) {
  const serialized = serializeEvent(payload, source);
  if (!serialized) {
    return;
  }

  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(serialized);
    }
  }
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 404;
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${sensorHost}:${port}`}`);
  if (req.method === 'GET' && url.pathname === '/healthz') {
    const payload = {
      service: 'rust-sensor',
      status: 'ok',
      uptimeMs: Date.now() - startedAt,
      mode: 'node-fallback',
    };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }

  res.statusCode = 404;
  res.end();
});

const wsServer = new WebSocketServer({ noServer: true });

wsServer.on('connection', socket => {
  clients.add(socket);

  socket.on('message', message => {
    let rawPayload = '';
    if (typeof message === 'string') {
      rawPayload = message;
    } else if (Buffer.isBuffer(message)) {
      rawPayload = message.toString('utf8');
    } else {
      return;
    }

    try {
      const parsed = JSON.parse(rawPayload);
      broadcast(parsed, 'node.ws');
    } catch {
      // Ignore invalid JSON payloads to mirror the rust hub behavior.
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url) {
    socket.destroy();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${sensorHost}:${port}`}`);
  if (url.pathname !== '/ws/sensors') {
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(req, socket, head, upgradedSocket => {
    wsServer.emit('connection', upgradedSocket, req);
  });
});

server.listen(port, sensorHost, () => {
  console.log(`[rust-sensor] node fallback listening on http://${sensorHost}:${port}`);
});

function shutdown(exitCode = 0) {
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.close();
    }
  }

  wsServer.close(() => {
    server.close(() => {
      process.exit(exitCode);
    });
  });

  setTimeout(() => process.exit(exitCode), 1000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
