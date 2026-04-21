const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
require('./load-backend-env');
const { withStartupStep, printStartupReport } = require('./startup-report');

const root = path.resolve(__dirname, '..', '..');
const cleanerScript = path.join(root, 'backend', 'scripts', 'clean-backend-stack.js');
const selfCheckScript = path.join(
  root,
  'backend',
  'scripts',
  'self-check-node-backend.js',
);
const nodeBackendPort = String(
  process.env.NODE_PORT || process.env.PORT || process.env.GO_PORT || '8090',
);
const metroPort = '8081';
const startMetro = isTruthy(process.env.START_METRO, false);
const runNodeSelfCheckOnStart = isTruthy(process.env.NODE_START_SELF_CHECK, true);
const waitAfterCleanMs = Number(process.env.BACKEND_CLEAN_WAIT_MS || '1200');
const children = [];

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

function resolveReactNativeCli() {
  return path.join(root, 'node_modules', 'react-native', 'cli.js');
}

function spawnProcess(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: 'inherit',
  });

  children.push(child);
  child.on('exit', code => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }
  });

  return child;
}

function inspectBackend(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/healthz`, response => {
      let raw = '';
      response.on('data', chunk => {
        raw += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolve({
            healthy: false,
            reachable: true,
            service: null,
            statusCode: response.statusCode,
          });
          return;
        }

        try {
          const payload = raw ? JSON.parse(raw) : {};
          const health = payload?.data ?? payload;
          resolve({
            healthy: health?.status === 'ok',
            reachable: true,
            service: typeof health?.service === 'string' ? health.service : null,
            statusCode: response.statusCode,
          });
        } catch {
          resolve({
            healthy: false,
            reachable: true,
            service: null,
            statusCode: response.statusCode,
          });
        }
      });
    });

    req.on('error', () => {
      resolve({
        healthy: false,
        reachable: false,
        service: null,
        statusCode: null,
      });
    });
    req.setTimeout(1200, () => {
      req.destroy();
      resolve({
        healthy: false,
        reachable: false,
        service: null,
        statusCode: null,
      });
    });
  });
}

function inspectMetro() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${metroPort}/status`, response => {
      resolve({
        reachable: true,
        statusCode: response.statusCode,
      });
      response.resume();
    });

    req.on('error', () => {
      resolve({
        reachable: false,
        statusCode: null,
      });
    });
    req.setTimeout(1200, () => {
      req.destroy();
      resolve({
        reachable: false,
        statusCode: null,
      });
    });
  });
}

async function waitForHealthyNode(retries = 120) {
  const startedAt = Date.now();

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const state = await inspectBackend(nodeBackendPort);
    if (state.reachable && state.healthy && state.service === 'node') {
      return {
        readyMs: Date.now() - startedAt,
      };
    }
    await sleep(250);
  }

  throw new Error(`Node backend failed to become healthy on port ${nodeBackendPort}`);
}

async function waitForMetro(retries = 120) {
  const startedAt = Date.now();

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const state = await inspectMetro();
    if (state.reachable && state.statusCode === 200) {
      return {
        readyMs: Date.now() - startedAt,
      };
    }
    await sleep(250);
  }

  throw new Error(`Metro failed to become ready on port ${metroPort}`);
}

async function cleanPorts(ports) {
  const uniquePorts = Array.from(new Set(ports.map(value => String(value).trim()).filter(Boolean)));
  if (uniquePorts.length === 0) {
    return;
  }

  const result = spawnSync(process.execPath, [cleanerScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      BACKEND_CLEAN_FORCE: 'true',
      BACKEND_CLEAN_KILL_UNKNOWN: process.env.BACKEND_CLEAN_KILL_UNKNOWN || 'true',
      BACKEND_CLEAN_PORTS: uniquePorts.join(','),
    },
  });

  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message || String(result.stderr || '').trim() || `exit code ${result.status}`;
    const error = new Error(`clean backend ports failed: ${detail}`);
    if (result.error?.code) {
      error.code = result.error.code;
    }
    throw error;
  }

  if (waitAfterCleanMs > 0) {
    await sleep(waitAfterCleanMs);
  }
}

async function runBootCleaner() {
  const enabled = isTruthy(process.env.BACKEND_CLEAN_ON_START, true);
  if (!enabled) {
    return 'skipped (BACKEND_CLEAN_ON_START=0)';
  }

  const selected = startMetro ? [nodeBackendPort, metroPort] : [nodeBackendPort];
  try {
    await cleanPorts(selected);
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : '';
    const message = String(error?.message || error || '');
    if (
      code === 'EPERM' ||
      code === 'EACCES' ||
      message.includes('EPERM') ||
      message.includes('EACCES')
    ) {
      return `skipped (clean permission: ${code || 'EPERM'})`;
    }
    throw error;
  }
  return `ports ${selected.join(',')} cleaned`;
}

async function ensureNodeBackend() {
  let state = await inspectBackend(nodeBackendPort);

  if (state.reachable && state.statusCode !== 200) {
    await cleanPorts([nodeBackendPort]);
    state = await inspectBackend(nodeBackendPort);
  }

  if (state.reachable && state.statusCode === 200 && state.healthy && state.service === 'node') {
    return `already running on port ${nodeBackendPort}`;
  }

  if (state.reachable) {
    await cleanPorts([nodeBackendPort]);
    state = await inspectBackend(nodeBackendPort);
    if (state.reachable && state.statusCode === 200 && state.healthy && state.service === 'node') {
      return `already running on port ${nodeBackendPort}`;
    }
  }

  spawnProcess(
    'node-backend',
    process.execPath,
    [path.join(root, 'backend', 'scripts', 'start-node-server.js')],
    {
      env: {
        ...process.env,
        NODE_PORT: nodeBackendPort,
        PORT: nodeBackendPort,
      },
    },
  );

  const { readyMs } = await waitForHealthyNode();
  return `started on port ${nodeBackendPort} in ${readyMs}ms`;
}

async function ensureNodeSelfCheck() {
  if (!runNodeSelfCheckOnStart) {
    return 'skipped (NODE_START_SELF_CHECK=0)';
  }

  const result = spawnSync(process.execPath, [selfCheckScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_PORT: nodeBackendPort,
      PORT: nodeBackendPort,
    },
  });

  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message ||
      String(result.stderr || '').trim() ||
      String(result.stdout || '').trim() ||
      `exit code ${result.status}`;
    throw new Error(`node self-check failed: ${detail}`);
  }

  const stdout = String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const summary = stdout[stdout.length - 1] || 'health + auth contract OK';
  return summary;
}

function applyCssInteropPatch() {
  const patchScript = path.join(root, 'scripts', 'patch-css-interop.js');
  const result = spawnSync(process.execPath, [patchScript], {
    cwd: root,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    console.warn('[metro] css interop patch skipped.');
  }
}

async function ensureMetro() {
  if (!startMetro) {
    return 'skipped (START_METRO=0)';
  }

  let state = await inspectMetro();
  if (state.reachable && state.statusCode === 200) {
    return `already running on port ${metroPort}`;
  }

  if (state.reachable && state.statusCode !== 200) {
    await cleanPorts([metroPort]);
    state = await inspectMetro();
    if (state.reachable && state.statusCode === 200) {
      return `recovered on port ${metroPort}`;
    }
  }

  applyCssInteropPatch();
  const maxWorkers = String(process.env.METRO_MAX_WORKERS || '0');
  spawnProcess(
    'metro',
    process.execPath,
    [resolveReactNativeCli(), 'start', '--max-workers', maxWorkers],
    {
      env: process.env,
    },
  );

  const { readyMs } = await waitForMetro();
  return `started on port ${metroPort} in ${readyMs}ms`;
}

async function main() {
  await withStartupStep('Clean backend stack', runBootCleaner);
  await withStartupStep('Node backend', ensureNodeBackend);
  await withStartupStep('Node self-check', ensureNodeSelfCheck);
  if (startMetro) {
    await withStartupStep('Metro bundler', ensureMetro);
  }
}

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main()
  .then(() => {
    printStartupReport('Node Stack');
  })
  .catch(error => {
    printStartupReport('Node Stack', error);
    shutdown(1);
  });
