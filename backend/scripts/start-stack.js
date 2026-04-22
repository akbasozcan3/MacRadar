const http = require('node:http');
const { Buffer } = require('node:buffer');
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { buildGoEnv } = require('./go-env');
const { withStartupStep, printStartupReport } = require('./startup-report');
const { ensureGoExploreSeed } = require('./ensure-go-explore-seed');
const { verifyMessagesCameraMatrix } = require('./verify-messaging-camera-matrix');

const root = path.resolve(__dirname, '..', '..');
const STRICT_MODE = process.argv.includes('--strict') || ['1', 'true', 'yes', 'on'].includes(
  String(process.env.START_STACK_STRICT || '').trim().toLowerCase(),
);
const strictDefaultsApplied = [];

function setDefaultEnv(key, value) {
  if (process.env[key] == null || String(process.env[key]).trim().length === 0) {
    process.env[key] = value;
    strictDefaultsApplied.push(`${key}=${value}`);
  }
}

if (STRICT_MODE) {
  setDefaultEnv('AUTH_DEBUG_PREVIEW', 'false');
  setDefaultEnv('DB_MAX_CONNS', '24');
  setDefaultEnv('DB_MIN_CONNS', '4');
  setDefaultEnv('GO_ENABLE_NODE_FALLBACK', '0');
  setDefaultEnv('START_NODE_BACKEND', '0');
  setDefaultEnv('RUST_SENSOR_BRIDGE_ENABLED', 'true');
  setDefaultEnv('RUST_SENSOR_BRIDGE_HANDSHAKE_TIMEOUT', '3s');
  setDefaultEnv('RUST_SENSOR_BRIDGE_RECONNECT_DELAY', '750ms');
  setDefaultEnv('START_MESSAGES_CAMERA_MATRIX', '0');
}

const goPort = String(process.env.GO_PORT || '8090');
const nodePort = String(process.env.NODE_PORT || '8091');
const sensorHost = String(process.env.RUST_SENSOR_HOST || '127.0.0.1');
const sensorPort = String(process.env.RUST_SENSOR_PORT || '8181');
const CLEANER_SCRIPT = path.join(root, 'backend', 'scripts', 'clean-backend-stack.js');
const WAIT_AFTER_CLEAN_MS = Number(process.env.BACKEND_CLEAN_WAIT_MS || '1200');
const children = [];

const PROFILE_CONTRACT_LABEL = 'Harital\u0131 profil s\u00f6zle\u015fmesi haz\u0131r';
const PROFILE_CONTRACT_SUMMARY = 'mapFilterMode=street_friends, trackingEnabled=false';
const GO_PROFILE_CONTRACT_SOURCE = path.join(root, 'backend', 'go', 'internal', 'account', 'repository.go');
const VOICE_MESSAGES_STORAGE_DIR = path.join(root, 'backend', 'storage', 'voice', 'messages');

const PROFILE_CONTRACT_EXPECTED = {
  mapFilterMode: 'street_friends',
  trackingEnabled: false,
};

const PROFILE_CONTRACT_WARNING_CODES = {
  mapFilterMode: 'PC_MAPFILTER_MISMATCH',
  trackingEnabled: 'PC_TRACKING_MISMATCH',
  sourceMissing: 'PC_SOURCE_MISSING',
  sourceParse: 'PC_SOURCE_PARSE_FAIL',
};

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

function strictError(message) {
  return new Error(`[strict-mode] ${message}`);
}

function hasCargo() {
  const result = spawnSync('cargo', ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function hasWindowsMsvcLinker() {
  if (process.platform !== 'win32') {
    return true;
  }

  const result = spawnSync('where', ['link.exe'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function runBootCleaner() {
  const enabled = isTruthy(process.env.BACKEND_CLEAN_ON_START, true);
  if (!enabled) {
    return 'skipped (BACKEND_CLEAN_ON_START=0)';
  }

  const selectedPorts = String(
    process.env.BACKEND_CLEAN_PORTS || `${goPort},${nodePort},${sensorPort}`,
  )
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(Boolean);

  if (selectedPorts.length === 0) {
    return 'skipped (no ports selected)';
  }

  const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
  if (netstat.error || netstat.status !== 0) {
    if (netstat?.error?.code === 'EPERM' || netstat?.error?.code === 'EACCES') {
      return `skipped (clean permission: ${netstat.error.code})`;
    }
    throw new Error(
      `netstat failed: ${netstat.error?.message || String(netstat.stderr || '').trim() || `exit code ${netstat.status}`}`,
    );
  }

  const portSet = new Set(selectedPorts);
  const pids = new Set();
  for (const line of String(netstat.stdout || '').split(/\r?\n/)) {
    if (!line.includes('LISTENING')) {
      continue;
    }
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5) {
      continue;
    }
    const localAddress = tokens[1] || '';
    const match = localAddress.match(/:(\d+)$/);
    if (!match || !portSet.has(match[1])) {
      continue;
    }
    const pid = Number.parseInt(tokens[tokens.length - 1], 10);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  let killedCount = 0;
  const sortedPids = Array.from(pids).sort((a, b) => a - b);
  for (const pid of sortedPids) {
    const taskkill = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (taskkill.error) {
      if (taskkill.error.code === 'EPERM' || taskkill.error.code === 'EACCES') {
        return `skipped (clean permission: ${taskkill.error.code})`;
      }
      continue;
    }

    if (taskkill.status === 0) {
      killedCount += 1;
    }
  }

  return `ports ${selectedPorts.join(',')} cleaned; killed ${killedCount} pid`;
}

function ensureVoiceStorage() {
  mkdirSync(VOICE_MESSAGES_STORAGE_DIR, { recursive: true });
  return 'voice folders ready: backend/storage/voice/messages';
}

function describeStrictMode() {
  if (!STRICT_MODE) {
    return 'disabled';
  }

  if (strictDefaultsApplied.length === 0) {
    return 'enabled (strict defaults already configured via env)';
  }

  return `enabled (${strictDefaultsApplied.join(', ')})`;
}

function probe(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const request = http.get(`http://${host}:${port}/healthz`, response => {
      let raw = '';
      response.on('data', chunk => {
        raw += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolve({
            healthy: false,
            service: null,
            reachable: true,
            statusCode: response.statusCode,
          });
          return;
        }

        try {
          const payload = raw ? JSON.parse(raw) : {};
          const health = payload?.data ?? payload;
          resolve({
            healthy: health?.status === 'ok',
            service: typeof health?.service === 'string' ? health.service : null,
            reachable: true,
            statusCode: response.statusCode,
          });
        } catch {
          resolve({
            healthy: false,
            service: null,
            reachable: true,
            statusCode: response.statusCode,
          });
        }
      });
    });

    request.on('error', () =>
      resolve({
        healthy: false,
        service: null,
        reachable: false,
        statusCode: null,
      }));
    request.setTimeout(1200, () => {
      request.destroy();
      resolve({
        healthy: false,
        service: null,
        reachable: false,
        statusCode: null,
      });
    });
  });
}

function requestHttp({
  host = '127.0.0.1',
  port,
  path: requestPath = '/',
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 2500,
}) {
  return new Promise((resolve, reject) => {
    const hasBody = body != null && method !== 'GET' && method !== 'HEAD';
    const payload = hasBody
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : '';

    const requestHeaders = {
      ...headers,
    };
    if (hasBody) {
      if (!requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json';
      }
      requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        host,
        port,
        path: requestPath,
        method,
        headers: requestHeaders,
      },
      res => {
        let raw = '';
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: raw,
          });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout ${method} ${requestPath}`));
    });

    if (hasBody) {
      req.write(payload);
    }
    req.end();
  });
}

async function verifyCoreApis() {
  const checks = [];
  const goHealth = await requestHttp({
    port: goPort,
    path: '/healthz',
  });
  if (goHealth.statusCode !== 200) {
    throw new Error(`go /healthz beklenen 200, alinan ${goHealth.statusCode}`);
  }
  checks.push('go:/healthz=200');
  let goImplementation = 'go';
  try {
    const payload = goHealth.body ? JSON.parse(goHealth.body) : {};
    const health = payload?.data ?? payload;
    if (typeof health?.implementation === 'string' && health.implementation.trim().length > 0) {
      goImplementation = health.implementation.trim();
    }
  } catch {
    goImplementation = 'go';
  }

  if (
    STRICT_MODE &&
    goImplementation !== 'go' &&
    !isTruthy(process.env.GO_ENABLE_NODE_FALLBACK, false)
  ) {
    throw strictError(`go backend implementation beklenen "go", alinan "${goImplementation}"`);
  }

  const shouldCheckNode = isTruthy(process.env.START_NODE_BACKEND, true);
  if (shouldCheckNode) {
    const nodeHealth = await requestHttp({
      port: nodePort,
      path: '/healthz',
    });
    if (nodeHealth.statusCode !== 200) {
      throw new Error(`node /healthz beklenen 200, alinan ${nodeHealth.statusCode}`);
    }
    checks.push('node:/healthz=200');
  }

  const exploreFriends = await requestHttp({
    port: goPort,
    path: '/api/v1/explore/friends',
  });
  if (goImplementation === 'node-fallback') {
    if (exploreFriends.statusCode !== 200 && exploreFriends.statusCode !== 401) {
      throw new Error(`/api/v1/explore/friends node-fallback icin 200/401 bekleniyor, alinan ${exploreFriends.statusCode}`);
    }
  } else if (exploreFriends.statusCode !== 200) {
    throw new Error(`/api/v1/explore/friends beklenen 200, alinan ${exploreFriends.statusCode}`);
  }
  checks.push(`explore/friends=${exploreFriends.statusCode}`);

  const resetProbeEmail = `startup.check.${Date.now()}@example.com`;
  const passwordReset = await requestHttp({
    port: goPort,
    path: '/api/v1/auth/password-reset/request',
    method: 'POST',
    body: {
      email: resetProbeEmail,
    },
  });
  let passwordResetCode = '';
  if (passwordReset.body) {
    try {
      const payload = JSON.parse(passwordReset.body);
      const errorPayload = payload?.error;
      if (typeof errorPayload?.code === 'string') {
        passwordResetCode = errorPayload.code;
      }
    } catch {
      passwordResetCode = '';
    }
  }

  if (goImplementation === 'node-fallback') {
    if (passwordReset.statusCode !== 200 && passwordReset.statusCode !== 404) {
      throw new Error(`/api/v1/auth/password-reset/request node-fallback icin 200/404 bekleniyor, alinan ${passwordReset.statusCode}`);
    }
  } else if (passwordReset.statusCode !== 404) {
    throw new Error(`/api/v1/auth/password-reset/request beklenen 404, alinan ${passwordReset.statusCode}`);
  } else if (passwordResetCode && passwordResetCode !== 'password_reset_not_allowed') {
    throw new Error(`/api/v1/auth/password-reset/request beklenen password_reset_not_allowed, alinan ${passwordResetCode}`);
  }
  const passwordResetCheck = passwordResetCode
    ? `password-reset/request=${passwordReset.statusCode}:${passwordResetCode}`
    : `password-reset/request=${passwordReset.statusCode}`;
  checks.push(passwordResetCheck);

  const profileSummary = await requestHttp({
    port: goPort,
    path: '/api/v1/profile/request-summary',
  });
  if (profileSummary.statusCode !== 401) {
    throw new Error(`/api/v1/profile/request-summary beklenen 401, alinan ${profileSummary.statusCode}`);
  }
  checks.push('profile/request-summary=401');

  const mapPreferences = await requestHttp({
    port: goPort,
    path: '/api/v1/map/preferences',
  });
  if (mapPreferences.statusCode !== 401) {
    throw new Error(`/api/v1/map/preferences beklenen 401, alinan ${mapPreferences.statusCode}`);
  }
  checks.push('map/preferences=401');

  const profilePrivacy = await requestHttp({
    port: goPort,
    path: '/api/v1/profile/privacy',
  });
  if (profilePrivacy.statusCode !== 401) {
    throw new Error(`/api/v1/profile/privacy beklenen 401, alinan ${profilePrivacy.statusCode}`);
  }
  checks.push('profile/privacy=401');

  const authDebugPreview = isTruthy(process.env.AUTH_DEBUG_PREVIEW, true) ? 'on' : 'off';
  const details = `${checks.join(', ')}, impl=${goImplementation}; AUTH_DEBUG_PREVIEW=${authDebugPreview}`;
  console.log(`[backend] API smoke check tamam: ${details}`);
  return {
    status: 'CHECKED',
    details,
  };
}

async function verifyTrendingTags() {
  const trendingTags = await requestHttp({
    port: goPort,
    path: '/api/v1/explore/search/trending-tags?limit=8',
  });
  if (trendingTags.statusCode !== 200) {
    throw new Error(
      `/api/v1/explore/search/trending-tags beklenen 200, alinan ${trendingTags.statusCode}`,
    );
  }

  let tags = [];
  try {
    const payload = trendingTags.body ? JSON.parse(trendingTags.body) : {};
    const data = payload?.data ?? payload;
    tags = Array.isArray(data?.tags) ? data.tags : [];
  } catch {
    throw new Error('/api/v1/explore/search/trending-tags response parse edilemedi');
  }

  const topTag =
    typeof tags[0]?.tag === 'string' && tags[0].tag.trim().length > 0
      ? tags[0].tag.trim()
      : 'none';
  const details = `trending-tags=200, count=${tags.length}, top=${topTag}`;
  console.log(`[backend] Trend tags check tamam: ${details}`);
  return {
    status: 'CHECKED',
    details,
  };
}

async function verifyMessagesCameraMatrixContract() {
  const shouldCheck = isTruthy(process.env.START_MESSAGES_CAMERA_MATRIX, true);
  if (!shouldCheck) {
    return 'skipped (START_MESSAGES_CAMERA_MATRIX=0)';
  }

  return verifyMessagesCameraMatrix({
    host: '127.0.0.1',
    port: goPort,
  });
}

async function ensureExploreSeed() {
  const appEnv = String(process.env.APP_ENV || 'development')
    .trim()
    .toLowerCase();
  if (appEnv === 'production') {
    return 'skipped (APP_ENV=production)';
  }

  const shouldSeed = isTruthy(process.env.START_GO_EXPLORE_SEED, false);
  if (!shouldSeed) {
    return 'skipped (START_GO_EXPLORE_SEED=0)';
  }

  return ensureGoExploreSeed({
    host: '127.0.0.1',
    minLivePosts: 3,
    port: goPort,
  });
}

function spawnProcess(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: 'inherit',
  });

  children.push(child);
  child.on('error', error => {
    console.error(`[${label}] ${error.message}`);
  });
  child.on('exit', code => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }
  });

  return child;
}

function cleanPortForBackend(port, reason) {
  const autoResolveEnabled = isTruthy(process.env.BACKEND_AUTO_RESOLVE_PORTS, true);
  if (!autoResolveEnabled) {
    return false;
  }

  console.warn(`[backend] Port ${port} is occupied (${reason}). Trying automatic recovery...`);

  const result = spawnSync(
    process.execPath,
    [CLEANER_SCRIPT],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BACKEND_CLEAN_PORTS: String(port),
        BACKEND_CLEAN_FORCE: 'true',
      },
    },
  );

  if (result.error || result.status !== 0) {
    console.warn(`[backend] Automatic recovery command failed on port ${port}.`);
    return false;
  }

  if (WAIT_AFTER_CLEAN_MS > 0) {
    return waitForSleep(WAIT_AFTER_CLEAN_MS).then(() => true);
  }

  return Promise.resolve(true);
}

function waitForSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function assertBackendSlotFree(port, expectedService, state, host = '127.0.0.1') {
  if (!state.reachable) {
    return state;
  }

  if (state.statusCode !== 200) {
    const recovered = await cleanPortForBackend(port, `non-backend HTTP status ${state.statusCode}`);
    if (recovered) {
      const after = await probe(port, host);
      if (!after.reachable) {
        return after;
      }

      if (after.statusCode === 200 && (!after.healthy || after.service === expectedService)) {
        return after;
      }
    }

    throw new Error(
      `Port ${port} is occupied by a non-backend HTTP service (status ${state.statusCode}). Start cancelled.`,
    );
  }

  if (state.healthy && state.service === expectedService) {
    return state;
  }

  const recovered = await cleanPortForBackend(port, `service mismatch: ${state.service || 'unknown'}`);
  if (recovered) {
    const after = await probe(port, host);
    if (!after.reachable) {
      return after;
    }

    if (after.statusCode === 200 && after.healthy && after.service === expectedService) {
      return after;
    }
  }

  const holder = state.service ? `"${state.service}"` : 'unknown service';
  throw new Error(`Port ${port} is occupied by ${holder}. Start cancelled.`);
}

async function startRustSensorNodeFallback(reason, disableRustSensorBridge, options = {}) {
  const shouldStartFallback = isTruthy(process.env.START_RUST_SENSOR_NODE_FALLBACK, true);
  if (!shouldStartFallback) {
    if (STRICT_MODE) {
      throw strictError(
        `rust sensor fallback kapali ve gercek rust sensor bulunamadi (${reason})`,
      );
    }
    disableRustSensorBridge(reason);
    return false;
  }

  const shouldLogReason = options.logReason !== false;
  if (shouldLogReason) {
    console.log(`[rust-sensor] node sensor backend baslatiliyor (${reason})...`);
  } else {
    console.log('[rust-sensor] node sensor backend baslatiliyor...');
  }

  spawnProcess('rust-sensor-fallback', process.execPath, ['backend/scripts/start-rust-sensor-fallback.js'], {
    env: {
      ...process.env,
      RUST_SENSOR_HOST: sensorHost,
      RUST_SENSOR_PORT: sensorPort,
    },
  });

  try {
    const { readyMs } = await waitForHealthy(sensorPort, 'rust-sensor', 120, sensorHost);
    return readyMs;
  } catch {
    disableRustSensorBridge(`node fallback healthy olmadi (${reason})`);
    return null;
  }
}

async function ensureRustSensor() {
  const disableRustSensorBridge = reason => {
    if (STRICT_MODE) {
      throw strictError(`rust sensor bridge devre disi birakilamaz: ${reason}`);
    }
    process.env.RUST_SENSOR_BRIDGE_ENABLED = 'false';
    console.warn(`[rust-sensor] atlandi: ${reason}`);
  };

  const shouldStartRust = isTruthy(process.env.START_RUST_SENSOR_BACKEND, true);
  if (!shouldStartRust) {
    if (STRICT_MODE) {
      throw strictError('START_RUST_SENSOR_BACKEND=0 strict modda desteklenmiyor');
    }
    const startedFallback = await startRustSensorNodeFallback(
      'START_RUST_SENSOR_BACKEND=0',
      disableRustSensorBridge,
      { logReason: false },
    );
    if (!startedFallback) {
      disableRustSensorBridge('START_RUST_SENSOR_BACKEND=0 ve START_RUST_SENSOR_NODE_FALLBACK=0');
      return 'skipped (legacy rust bridge disabled)';
    }
    return 'node fallback started';
  }

  const state = await probe(sensorPort, sensorHost);
  if (state.reachable && state.statusCode !== 200) {
    throw new Error(
      `Port ${sensorPort} is occupied by a non-rust-sensor service (status ${state.statusCode}). Stop it and rerun npm start.`,
    );
  }

  if (!state.healthy) {
    if (!hasCargo()) {
      const fallbackStarted = await startRustSensorNodeFallback('cargo bulunamadi', disableRustSensorBridge, {
        logReason: false,
      });
      if (STRICT_MODE && !fallbackStarted) {
        throw strictError('cargo bulunamadi, rust sensor backend strict modda baslatilamadi');
      }
      return fallbackStarted ? 'fallback started (cargo yok)' : 'fallback skipped';
    }
    if (!hasWindowsMsvcLinker()) {
      const fallbackStarted = await startRustSensorNodeFallback(
        'MSVC linker (link.exe) bulunamadi',
        disableRustSensorBridge,
        { logReason: false },
      );
      if (STRICT_MODE && !fallbackStarted) {
        throw strictError('MSVC linker bulunamadi, rust sensor backend strict modda baslatilamadi');
      }
      return fallbackStarted ? 'fallback started (linker yok)' : 'fallback skipped';
    }

    spawnProcess('rust-sensor', process.execPath, ['backend/scripts/start-rust-sensor.js'], {
      env: {
        ...process.env,
        RUST_SENSOR_HOST: sensorHost,
        RUST_SENSOR_PORT: sensorPort,
      },
    });
    const { readyMs } = await waitForHealthy(sensorPort, 'rust-sensor', 240, sensorHost);
    return `started in ${readyMs}ms`;
  }

  if (state.service !== 'rust-sensor') {
    throw new Error(`port ${sensorPort} is occupied by ${state.service || 'another'} service`);
  }

  return `already running on port ${sensorPort}`;
}

async function ensureNodeBackend() {
  const shouldStartNode = isTruthy(process.env.START_NODE_BACKEND, true);
  if (!shouldStartNode) {
    return 'skipped (START_NODE_BACKEND=0)';
  }

  let nodeState = await probe(nodePort);
  nodeState = await assertBackendSlotFree(nodePort, 'node', nodeState);
  if (!nodeState.healthy) {
    spawnProcess('node-backend', process.execPath, ['backend/node/server.js'], {
      env: {
        ...process.env,
        PORT: nodePort,
      },
    });
    const { readyMs } = await waitForHealthy(nodePort, 'node');
    return `started on port ${nodePort} in ${readyMs}ms`;
  }

  return `already running on port ${nodePort}`;
}

async function ensureGoBackend() {
  let goState = await probe(goPort);
  goState = await assertBackendSlotFree(goPort, 'go', goState);
  if (!goState.healthy) {
    spawnProcess('go-backend', process.execPath, ['backend/scripts/start-go.js'], {
      env: buildGoEnv({
        ...process.env,
        GO_PORT: goPort,
        MIGRATIONS_DIR:
          process.env.MIGRATIONS_DIR ||
          path.join(root, 'backend', 'migrations'),
        PORT: goPort,
        AUTH_DEBUG_PREVIEW:
          process.env.AUTH_DEBUG_PREVIEW || 'true',
        GO_FORCE_GO_RUN:
          process.env.GO_FORCE_GO_RUN || '0',
        GO_ENABLE_NODE_FALLBACK:
          process.env.GO_ENABLE_NODE_FALLBACK || '0',
        RUST_SENSOR_BRIDGE_ENABLED:
          process.env.RUST_SENSOR_BRIDGE_ENABLED || 'true',
        RUST_SENSOR_WS_URL:
          process.env.RUST_SENSOR_WS_URL ||
          `ws://${sensorHost}:${sensorPort}/ws/sensors`,
      }),
    });
    const { readyMs } = await waitForHealthy(goPort, 'go', 180);
    return `started on port ${goPort} in ${readyMs}ms`;
  }

  return `already running on port ${goPort}`;
}

async function verifyProfileContract() {
  const goState = await probe(goPort);
  if (!goState.reachable) {
    return `${PROFILE_CONTRACT_LABEL} atlandi (go backend reachable degil)`;
  }

  if (!goState.healthy || goState.service !== 'go') {
    return `${PROFILE_CONTRACT_LABEL} atlandi (go backend beklenmiyor, servis=${goState.service || 'unknown'})`;
  }

  const warnings = validateGoProfileContractDefaults();
  if (warnings.length > 0) {
    const warnCode = warnings.join(',');
    console.warn(
      `[backend] Harital\u0131 profil s\u00f6zle\u015fmesi uyari: [${warnCode}] ${PROFILE_CONTRACT_SUMMARY}`,
    );
    return {
      status: 'CHECK_WARN',
      details: `${PROFILE_CONTRACT_LABEL}: uyari (${warnCode}) - ${PROFILE_CONTRACT_SUMMARY}`,
    };
  }

  console.log(`[backend] ${PROFILE_CONTRACT_LABEL}: ${PROFILE_CONTRACT_SUMMARY}`);
  return {
    status: 'CHECKED',
    details: `haz\u0131r (${PROFILE_CONTRACT_SUMMARY})`,
  };
}

function validateGoProfileContractDefaults() {
  if (!existsSync(GO_PROFILE_CONTRACT_SOURCE)) {
    return [PROFILE_CONTRACT_WARNING_CODES.sourceMissing];
  }

  try {
    const raw = readFileSync(GO_PROFILE_CONTRACT_SOURCE, 'utf8');
    const warnings = [];

    const mapFilterModeMatch = raw.match(/coalesce\(p\.map_filter_mode,\s*'([^']+)'\)/i);
    if (!mapFilterModeMatch) {
      warnings.push(PROFILE_CONTRACT_WARNING_CODES.sourceParse);
    } else if (mapFilterModeMatch[1].trim() !== PROFILE_CONTRACT_EXPECTED.mapFilterMode) {
      warnings.push(PROFILE_CONTRACT_WARNING_CODES.mapFilterMode);
    }

    const trackingEnabledMatch = raw.match(/coalesce\(p\.tracking_enabled,\s*(true|false)\)/i);
    if (!trackingEnabledMatch) {
      if (!warnings.includes(PROFILE_CONTRACT_WARNING_CODES.sourceParse)) {
        warnings.push(PROFILE_CONTRACT_WARNING_CODES.sourceParse);
      }
    } else {
      const trackingEnabled = trackingEnabledMatch[1].trim().toLowerCase() === 'true';
      if (trackingEnabled !== PROFILE_CONTRACT_EXPECTED.trackingEnabled) {
        warnings.push(PROFILE_CONTRACT_WARNING_CODES.trackingEnabled);
      }
    }

    return warnings;
  } catch {
    return [PROFILE_CONTRACT_WARNING_CODES.sourceParse];
  }
}

async function waitForHealthy(port, expectedService, retries = 40, host = '127.0.0.1') {
  const startedAt = Date.now();

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const state = await probe(port, host);
    if (state.reachable && state.statusCode !== 200) {
      throw new Error(
        `${expectedService} backend port ${port} is occupied by non-backend service (status ${state.statusCode}).`,
      );
    }

    if (state.healthy && state.service === expectedService) {
      return {
        readyMs: Date.now() - startedAt,
      };
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(`${expectedService} backend failed to become healthy on port ${port}`);
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

async function main() {
  await withStartupStep('Clean backend stack', async () => runBootCleaner());
  await withStartupStep('Strict mode', async () => describeStrictMode());
  await withStartupStep('Voice storage', async () => ensureVoiceStorage());
  await withStartupStep('Rust sensor backend', ensureRustSensor);
  await withStartupStep('Legacy node backend', ensureNodeBackend);
  await withStartupStep('Go backend', ensureGoBackend);
  await withStartupStep('Explore seed', ensureExploreSeed);
  await withStartupStep('Profile contract', verifyProfileContract, {
    successStatus: 'CHECKED',
  });
  await withStartupStep('Core API contract', verifyCoreApis, {
    successStatus: 'CHECKED',
  });
  await withStartupStep('Messaging + Camera matrix', verifyMessagesCameraMatrixContract, {
    successStatus: 'CHECKED',
  });
  await withStartupStep('TREND_TAGS_OK', verifyTrendingTags, {
    successStatus: 'CHECKED',
  });
}

main()
  .then(() => {
    printStartupReport('Backend Stack');
  })
  .catch(error => {
    printStartupReport('Backend Stack', error);
    shutdown(1);
  });
