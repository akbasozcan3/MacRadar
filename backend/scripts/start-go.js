const { spawn } = require('node:child_process');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
require('./load-backend-env');
const { buildGoEnv } = require('./go-env');

const root = path.resolve(__dirname, '..', '..');
const goRoot = path.join(root, 'backend', 'go');
const port = String(process.env.GO_PORT || process.env.PORT || '8090');
const prebuiltBinary = process.platform === 'win32'
  ? path.join(goRoot, 'server.exe')
  : path.join(goRoot, 'server');

function collectNewestSourceMtimeMs(paths) {
  const stack = [...paths];
  let newest = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    const stats = fs.statSync(current);
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        if (entry === '.git' || entry === '.cache' || entry === 'vendor') {
          continue;
        }
        stack.push(path.join(current, entry));
      }
      continue;
    }

    const fileName = path.basename(current);
    if (fileName.endsWith('.go') || fileName === 'go.mod' || fileName === 'go.sum') {
      newest = Math.max(newest, stats.mtimeMs);
    }
  }

  return newest;
}

function isSourceNewerThanBinary(binaryPath) {
  if (!fs.existsSync(binaryPath)) {
    return true;
  }

  const binaryMtimeMs = fs.statSync(binaryPath).mtimeMs;
  const newestSourceMtimeMs = collectNewestSourceMtimeMs([
    path.join(goRoot, 'cmd'),
    path.join(goRoot, 'internal'),
    path.join(goRoot, 'go.mod'),
    path.join(goRoot, 'go.sum'),
  ]);

  return newestSourceMtimeMs > binaryMtimeMs;
}

function isTruthy(value) {
  if (typeof value !== 'string') {
    return false;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
}

const runtimeEnv = buildGoEnv({
  ...process.env,
  MIGRATIONS_DIR:
    process.env.MIGRATIONS_DIR || path.join(root, 'backend', 'migrations'),
  PORT: port,
});

const forceGoRun = isTruthy(process.env.GO_FORCE_GO_RUN);
const allowGoRunFallback =
  process.platform !== 'win32' || isTruthy(process.env.GO_ALLOW_GO_RUN_FALLBACK);
const enableNodeGoFallback =
  process.platform === 'win32'
    ? process.env.GO_ENABLE_NODE_FALLBACK == null
      ? false
      : isTruthy(process.env.GO_ENABLE_NODE_FALLBACK)
    : isTruthy(process.env.GO_ENABLE_NODE_FALLBACK);
const preferPrebuiltBinary = !forceGoRun && (
  process.platform === 'win32' || isTruthy(process.env.GO_USE_PREBUILT_BINARY)
);
const binaryExists = fs.existsSync(prebuiltBinary);
const forceRebuildBinary = isTruthy(process.env.GO_REBUILD_BINARY);
const sourceIsNewerThanBinary =
  preferPrebuiltBinary && binaryExists && isSourceNewerThanBinary(prebuiltBinary);
const shouldRebuildBinary =
  preferPrebuiltBinary && (forceRebuildBinary || !binaryExists || sourceIsNewerThanBinary);

if (shouldRebuildBinary) {
  if (sourceIsNewerThanBinary && !forceRebuildBinary) {
    console.log('[go-backend] source changes detected, prebuilt binary rebuilding...');
  }

  const buildResult = spawnSync('go', ['build', '-o', prebuiltBinary, './cmd/server'], {
    cwd: goRoot,
    env: runtimeEnv,
    stdio: 'inherit',
  });

  if (buildResult.error || buildResult.status !== 0) {
    const reason = buildResult.error?.message || `go build failed with code ${buildResult.status}`;
    if (binaryExists && !forceRebuildBinary) {
      console.warn(`[go-backend] ${reason}`);
      console.warn('[go-backend] continuing with existing prebuilt binary.');
    } else {
      console.error(`[go-backend] ${reason}`);
      process.exit(1);
    }
  }
}

const usePrebuiltBinary =
  !forceGoRun && preferPrebuiltBinary && fs.existsSync(prebuiltBinary);
const command = usePrebuiltBinary ? prebuiltBinary : 'go';
const args = usePrebuiltBinary ? [] : ['run', './cmd/server'];

function startNodeGoFallback(reason) {
  if (!enableNodeGoFallback) {
    return false;
  }

  console.warn(`[go-backend] ${reason}`);
  console.warn('[go-backend] switching to node go-fallback on port ' + port);

  const fallbackStorePath = path.join(
    root,
    'backend',
    'node',
    'data',
    'local-store-go-fallback.json',
  );

  const child = spawn(process.execPath, [path.join(root, 'backend', 'node', 'server.js')], {
    cwd: root,
    env: {
      ...runtimeEnv,
      MACRADAR_IMPLEMENTATION: 'node-fallback',
      MACRADAR_SERVICE_NAME: 'go',
      NODE_STORE_PATH: fallbackStorePath,
      NODE_PORT: port,
      PORT: port,
    },
    stdio: 'inherit',
  });

  child.on('error', error => {
    console.error(`[go-backend] node go-fallback failed: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', code => {
    process.exit(code ?? 0);
  });

  return true;
}

function spawnServer(nextCommand, nextArgs, allowFallback) {
  let child;
  try {
    child = spawn(nextCommand, nextArgs, {
      cwd: goRoot,
      env: runtimeEnv,
      stdio: 'inherit',
    });
  } catch (error) {
    if (allowFallback) {
      console.error(`[go-backend] ${error.message}`);
      console.warn(
        '[go-backend] prebuilt binary failed to start; falling back to "go run ./cmd/server".',
      );
      console.warn(
        '[go-backend] set GO_FORCE_GO_RUN=1 to skip prebuilt binaries.',
      );
      spawnServer('go', ['run', './cmd/server'], false);
      return;
    }

    if (process.platform === 'win32') {
      console.error(
        '[go-backend] Windows policy blocked startup. Use prebuilt server.exe and keep GO_FORCE_GO_RUN=0.',
      );
      if (startNodeGoFallback(error.message)) {
        return;
      }
    }
    console.error(`[go-backend] ${error.message}`);
    process.exit(1);
  }

  child.on('error', error => {
    if (allowFallback) {
      console.error(`[go-backend] ${error.message}`);
      console.warn(
        '[go-backend] prebuilt binary failed to start; falling back to "go run ./cmd/server".',
      );
      console.warn(
        '[go-backend] set GO_FORCE_GO_RUN=1 to skip prebuilt binaries.',
      );
      spawnServer('go', ['run', './cmd/server'], false);
      return;
    }

    if (process.platform === 'win32') {
      console.error(
        '[go-backend] Windows policy blocked startup. Use prebuilt server.exe and keep GO_FORCE_GO_RUN=0.',
      );
      if (startNodeGoFallback(error.message)) {
        return;
      }
    }
    console.error(`[go-backend] ${error.message}`);
    process.exit(1);
  });

  child.on('exit', code => {
    const exitCode = code ?? 0;
    if (exitCode !== 0) {
      if (startNodeGoFallback(`go backend exited with code ${exitCode}`)) {
        return;
      }
    }
    process.exit(exitCode);
  });
}

spawnServer(command, args, usePrebuiltBinary && allowGoRunFallback);
