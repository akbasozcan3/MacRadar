const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const goPort = String(process.env.GO_PORT || process.env.PORT || '8090');
const nodePort = String(process.env.NODE_PORT || '8091');
const children = new Set();
let shuttingDown = false;

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function probe(port) {
  return new Promise(resolve => {
    const request = http.get(`http://127.0.0.1:${port}/healthz`, response => {
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
            implementation:
              typeof health?.implementation === 'string' ? health.implementation : null,
            reachable: true,
            service: typeof health?.service === 'string' ? health.service : null,
            statusCode: response.statusCode,
          });
        } catch {
          resolve({
            healthy: false,
            implementation: null,
            reachable: true,
            service: null,
            statusCode: response.statusCode,
          });
        }
      });
    });

    request.on('error', () => {
      resolve({
        healthy: false,
        implementation: null,
        reachable: false,
        service: null,
        statusCode: null,
      });
    });
    request.setTimeout(1200, () => {
      request.destroy();
      resolve({
        healthy: false,
        implementation: null,
        reachable: false,
        service: null,
        statusCode: null,
      });
    });
  });
}

function spawnManaged(label, scriptPath, extraEnv = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: root,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: 'inherit',
  });

  children.add(child);
  child.on('exit', () => {
    children.delete(child);
  });

  return child;
}

async function waitForHealthy(port, expectedService, timeoutMs = 180000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await probe(port);
    if (state.reachable && state.statusCode === 200 && state.healthy && state.service === expectedService) {
      return state;
    }
    await sleep(250);
  }
  throw new Error(`Timeout waiting for ${expectedService} on port ${port}`);
}

async function ensureBackend({
  expectedService,
  label,
  port,
  scriptPath,
  spawnEnv,
  timeoutMs,
}) {
  const state = await probe(port);
  if (state.reachable) {
    if (state.statusCode === 200 && state.healthy && state.service === expectedService) {
      console.log(`[backend:test] ${label} already healthy on port ${port}`);
      return;
    }
    throw new Error(
      `[backend:test] Port ${port} occupied by unexpected service/status (${state.service || 'unknown'} / ${state.statusCode})`,
    );
  }

  console.log(`[backend:test] starting ${label} on port ${port}`);
  spawnManaged(label, scriptPath, spawnEnv);
  const ready = await waitForHealthy(port, expectedService, timeoutMs);
  const impl = ready.implementation ? ` (${ready.implementation})` : '';
  console.log(`[backend:test] ${label} ready on ${port}${impl}`);
}

function runNodeScript(label, scriptPath, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        ...env,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', code => {
      if ((code ?? 0) === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed (${code})`));
    });
  });
}

function shutdown(exitCode = 0) {
  shuttingDown = true;
  if (children.size === 0) {
    process.exit(exitCode);
    return;
  }

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(exitCode);
  }, 1000);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

async function main() {
  await ensureBackend({
    expectedService: 'node',
    label: 'node backend',
    port: nodePort,
    scriptPath: path.join(root, 'backend', 'scripts', 'start-node-server.js'),
    spawnEnv: {
      NODE_PORT: nodePort,
      PORT: nodePort,
    },
    timeoutMs: 120000,
  });

  await ensureBackend({
    expectedService: 'go',
    label: 'go backend',
    port: goPort,
    scriptPath: path.join(root, 'backend', 'scripts', 'start-go.js'),
    spawnEnv: {
      GO_PORT: goPort,
      PORT: goPort,
    },
    timeoutMs: 240000,
  });

  await runNodeScript(
    'backend:test',
    path.join(root, 'backend', 'scripts', 'test-go-auth-flow.js'),
    { GO_PORT: goPort, PORT: goPort },
  );
  await runNodeScript(
    'backend:test:profile',
    path.join(root, 'backend', 'scripts', 'test-go-profile-settings.js'),
    { GO_PORT: goPort, PORT: goPort },
  );
  await runNodeScript(
    'backend:test:go',
    path.join(root, 'backend', 'scripts', 'test-go-backend.js'),
    { GO_PORT: goPort, PORT: goPort },
  );
  await runNodeScript(
    'backend:test:go:matrix',
    path.join(root, 'backend', 'scripts', 'test-go-flow-matrix.js'),
    { GO_PORT: goPort, PORT: goPort },
  );
  await runNodeScript(
    'backend:test:feed',
    path.join(root, 'backend', 'scripts', 'test-feed-service-core.js'),
  );
  await runNodeScript(
    'backend:test:tabs',
    path.join(root, 'backend', 'scripts', 'test-tab-backend-contracts.js'),
    { GO_PORT: goPort, PORT: goPort },
  );
  await runNodeScript(
    'backend:test:node',
    path.join(root, 'backend', 'scripts', 'test-node-backend.js'),
    { NODE_PORT: nodePort, PORT: nodePort },
  );
  await runNodeScript(
    'backend:test:go:unit',
    path.join(root, 'backend', 'scripts', 'test-go-unit.js'),
    { GO_PORT: goPort, PORT: goPort },
  );
}

main()
  .then(() => shutdown(0))
  .catch(error => {
    if (!shuttingDown) {
      console.error(error?.message || error);
    }
    shutdown(1);
  });
