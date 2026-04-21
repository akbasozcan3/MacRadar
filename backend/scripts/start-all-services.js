const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

require('./load-backend-env');
const { withStartupStep, printStartupReport } = require('./startup-report');

const root = path.resolve(__dirname, '..', '..');
const CLEANER_SCRIPT = path.join(root, 'backend', 'scripts', 'clean-backend-stack.js');
const WAIT_AFTER_CLEAN_MS = Number(process.env.BACKEND_CLEAN_WAIT_MS || '1200');
const children = [];

function createNodeService({
  label,
  name,
  port,
  serviceName,
  cwd,
  wsUrl,
}) {
  return {
    label,
    command: process.execPath,
    args: [path.join(cwd, 'server.js')],
    cwd,
    healthPath: '/health',
    host: '127.0.0.1',
    name,
    port,
    serviceName,
    status: 'healthy',
    ...(wsUrl ? { wsUrl } : {}),
  };
}

const SERVICES = [
  {
    label: 'Node backend',
    command: process.execPath,
    args: [path.join(root, 'backend', 'node', 'server.js')],
    env: {
      PORT: process.env.NODE_PORT || process.env.PORT || '8090',
    },
    healthPath: '/healthz',
    host: '127.0.0.1',
    name: 'node',
    port: process.env.NODE_PORT || process.env.PORT || '8090',
    serviceName: 'node',
    status: 'ok',
  },
  {
    label: 'Go backend',
    command: 'go',
    args: ['run', 'start-simple.go'],
    cwd: path.join(root, 'backend', 'go'),
    healthPath: '/healthz',
    host: '127.0.0.1',
    name: 'go',
    port: '8092',
    serviceName: 'go-backend',
    status: 'healthy',
  },
  {
    label: 'Rust sensor hub',
    command: process.execPath,
    args: ['start-simple.js'],
    cwd: path.join(root, 'backend', 'rust'),
    healthPath: '/healthz',
    host: '127.0.0.1',
    name: 'rust',
    port: process.env.RUST_SENSOR_PORT || '8181',
    serviceNames: ['rust-sensor-hub', 'rust-sensor'],
    statuses: ['healthy', 'ok'],
    wsUrl: 'ws://127.0.0.1:8182',
  },
  createNodeService({
    cwd: path.join(root, 'backend', 'voice-service'),
    label: 'Voice service',
    name: 'voice',
    port: process.env.VOICE_PORT || '8096',
    serviceName: 'voice-service',
    wsUrl: 'ws://127.0.0.1:8097',
  }),
  createNodeService({
    cwd: path.join(root, 'backend', 'explore-service'),
    label: 'Explore service',
    name: 'explore',
    port: process.env.EXPLORE_PORT || '8099',
    serviceName: 'explore-system',
    wsUrl: 'ws://127.0.0.1:8100',
  }),
  createNodeService({
    cwd: path.join(root, 'backend', 'feed-service'),
    label: 'Feed service',
    name: 'feed',
    port: process.env.FEED_PORT || '8102',
    serviceName: 'feed-system',
    wsUrl: 'ws://127.0.0.1:8103',
  }),
  createNodeService({
    cwd: path.join(root, 'backend', 'search-service'),
    label: 'Search service',
    name: 'search',
    port: process.env.SEARCH_PORT || '8104',
    serviceName: 'professional-search',
  }),
];

const EXTRA_HTTP_CHECKS = [
  {
    label: 'Fastify messages',
    healthPath: '/health',
    host: '127.0.0.1',
    port: '8094',
    serviceName: 'fastify-messages',
    status: 'healthy',
  },
];

function isTruthy(value, fallback = false) {
  if (typeof value !== 'string') {
    return fallback;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return fallback;
  }
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function spawnProcess(service) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd || path.join(root, 'backend'),
    env: {
      ...process.env,
      ...(service.env || {}),
    },
    stdio: 'inherit',
  });

  children.push({ child, label: service.label });
  child.on('error', error => {
    console.error(`[${service.label}] ${error.message}`);
  });
  child.on('exit', code => {
    if (code && code !== 0) {
      console.error(`[${service.label}] exited with code ${code}`);
      shutdown(1);
    }
  });

  return child;
}

function probeHttp({ host = '127.0.0.1', port, path: requestPath }) {
  return new Promise(resolve => {
    const req = http.get(`http://${host}:${port}${requestPath}`, response => {
      let raw = '';
      response.on('data', chunk => {
        raw += chunk;
      });
      response.on('end', () => {
        let payload = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          payload = null;
        }
        resolve({
          payload,
          reachable: true,
          statusCode: response.statusCode || 0,
        });
      });
    });

    req.on('error', () => {
      resolve({
        payload: null,
        reachable: false,
        statusCode: null,
      });
    });
    req.setTimeout(1500, () => {
      req.destroy();
      resolve({
        payload: null,
        reachable: false,
        statusCode: null,
      });
    });
  });
}

function unwrapHealthPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return payload.data && typeof payload.data === 'object' ? payload.data : payload;
}

function matchesHealth(service, payload) {
  const health = unwrapHealthPayload(payload);
  if (!health || typeof health !== 'object') {
    return false;
  }
  const serviceName =
    typeof health.service === 'string' && health.service.trim().length > 0
      ? health.service.trim()
      : '';
  const status =
    typeof health.status === 'string' && health.status.trim().length > 0
      ? health.status.trim().toLowerCase()
      : '';
  const allowedServiceNames = Array.isArray(service.serviceNames)
    ? service.serviceNames
    : [service.serviceName];
  const allowedStatuses = Array.isArray(service.statuses)
    ? service.statuses
    : [service.status];
  return allowedServiceNames.includes(serviceName) && allowedStatuses.includes(status);
}

async function waitForService(service, retries = 160) {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const state = await probeHttp({
      host: service.host,
      path: service.healthPath,
      port: service.port,
    });
    if (state.reachable && state.statusCode === 200 && matchesHealth(service, state.payload)) {
      return `ready on ${service.port} in ${Date.now() - startedAt}ms`;
    }
    await sleep(250);
  }

  throw new Error(`${service.label} failed to become healthy on port ${service.port}`);
}

async function ensureService(service) {
  const state = await probeHttp({
    host: service.host,
    path: service.healthPath,
    port: service.port,
  });
  if (state.reachable && state.statusCode === 200 && matchesHealth(service, state.payload)) {
    return `already running on ${service.port}`;
  }

  spawnProcess(service);
  return waitForService(service);
}

async function probeWebSocket(url, timeoutMs = 2500) {
  return new Promise(resolve => {
    let finished = false;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        ws.terminate();
      } catch {}
      resolve(false);
    }, timeoutMs);

    ws.on('open', () => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    });

    ws.on('error', () => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function verifyAllHealth() {
  const checks = [];

  for (const service of SERVICES) {
    const state = await probeHttp({
      host: service.host,
      path: service.healthPath,
      port: service.port,
    });
    if (!(state.reachable && state.statusCode === 200 && matchesHealth(service, state.payload))) {
      throw new Error(`${service.label} health check failed on ${service.port}`);
    }
    checks.push(`${service.name}:${service.port}`);
  }

  for (const check of EXTRA_HTTP_CHECKS) {
    const state = await probeHttp({
      host: check.host,
      path: check.healthPath,
      port: check.port,
    });
    if (!(state.reachable && state.statusCode === 200 && matchesHealth(check, state.payload))) {
      throw new Error(`${check.label} health check failed on ${check.port}`);
    }
    checks.push(`fastify:${check.port}`);
  }

  const wsChecks = [];
  for (const service of SERVICES) {
    if (!service.wsUrl) {
      continue;
    }
    const wsOk = await probeWebSocket(service.wsUrl);
    if (!wsOk) {
      throw new Error(`${service.label} websocket check failed: ${service.wsUrl}`);
    }
    wsChecks.push(service.wsUrl.replace('ws://127.0.0.1:', ''));
  }

  return {
    details: `HTTP ${checks.join(', ')}${wsChecks.length > 0 ? ` | WS ${wsChecks.join(', ')}` : ''}`,
    status: 'CHECKED',
  };
}

async function cleanPorts() {
  const enabled = isTruthy(process.env.BACKEND_CLEAN_ON_START, true);
  if (!enabled) {
    return 'skipped (BACKEND_CLEAN_ON_START=0)';
  }

  const defaultPorts = [
    ...SERVICES.map(service => service.port),
    ...SERVICES.map(service => {
      if (!service.wsUrl) {
        return null;
      }
      try {
        return new URL(service.wsUrl).port;
      } catch {
        return null;
      }
    }).filter(Boolean),
    ...EXTRA_HTTP_CHECKS.map(check => check.port),
  ];

  const selectedPorts = String(process.env.BACKEND_CLEAN_PORTS || defaultPorts.join(','))
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(Boolean);

  const result = spawnSync(process.execPath, [CLEANER_SCRIPT], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      BACKEND_CLEAN_FORCE: 'true',
      BACKEND_CLEAN_KILL_UNKNOWN: process.env.BACKEND_CLEAN_KILL_UNKNOWN || 'true',
      BACKEND_CLEAN_PORTS: selectedPorts.join(','),
    },
  });

  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message || String(result.stderr || '').trim() || `exit code ${result.status}`;
    throw new Error(`clean backend ports failed: ${detail}`);
  }

  if (WAIT_AFTER_CLEAN_MS > 0) {
    await sleep(WAIT_AFTER_CLEAN_MS);
  }

  return `ports ${selectedPorts.join(',')} cleaned`;
}

function shutdown(exitCode = 0) {
  for (const entry of children) {
    if (!entry.child.killed) {
      try {
        entry.child.kill('SIGINT');
      } catch {}
    }
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  await withStartupStep('Clean backend stack', cleanPorts);
  for (const service of SERVICES) {
    await withStartupStep(service.label, async () => ensureService(service));
  }
  await withStartupStep('Service health matrix', verifyAllHealth, {
    successStatus: 'CHECKED',
  });
}

main()
  .then(() => {
    printStartupReport('Backend All Services');
  })
  .catch(error => {
    printStartupReport('Backend All Services', error);
    shutdown(1);
  });
