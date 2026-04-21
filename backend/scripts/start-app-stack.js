const http = require('node:http');
const { Buffer } = require('node:buffer');
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { withStartupStep, printStartupReport } = require('./startup-report');
const { ensureGoExploreSeed } = require('./ensure-go-explore-seed');
const { verifyMessagesCameraMatrix } = require('./verify-messaging-camera-matrix');

const GO_BACKEND_PORT = String(process.env.GO_PORT || '8090');
const NODE_BACKEND_PORT = String(process.env.NODE_PORT || '8091');
const RUST_SENSOR_HOST = String(process.env.RUST_SENSOR_HOST || '127.0.0.1');
const RUST_SENSOR_PORT = String(process.env.RUST_SENSOR_PORT || '8181');
const METRO_PORT = '8081';
const root = path.resolve(__dirname, '..', '..');
const CLEANER_SCRIPT = path.join(root, 'backend', 'scripts', 'clean-backend-stack.js');
const WAIT_AFTER_CLEAN_MS = Number(process.env.BACKEND_CLEAN_WAIT_MS || '1200');

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

const children = [];

function resolveReactNativeCli() {
  return path.join(root, 'node_modules', 'react-native', 'cli.js');
}

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runBootCleaner() {
  const enabled = isTruthy(process.env.BACKEND_CLEAN_ON_START, true);
  if (!enabled) {
    return 'skipped (BACKEND_CLEAN_ON_START=0)';
  }

  const selectedPorts = String(
    process.env.BACKEND_CLEAN_PORTS ||
      `${GO_BACKEND_PORT},${NODE_BACKEND_PORT},${RUST_SENSOR_PORT},${METRO_PORT}`,
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

function applyCssInteropPatch() {
  const patchScript = path.join(root, 'scripts', 'patch-css-interop.js');
  const result = spawnSync(process.execPath, [patchScript], {
    cwd: root,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    console.warn('[metro] css-interop patch uygulanamadi, yine de devam ediliyor.');
  }
}

function inspectBackend(port, host = '127.0.0.1') {
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
    port: GO_BACKEND_PORT,
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

  const shouldCheckNode = isTruthy(process.env.START_NODE_BACKEND, true);
  if (shouldCheckNode) {
    const nodeHealth = await requestHttp({
      port: NODE_BACKEND_PORT,
      path: '/healthz',
    });
    if (nodeHealth.statusCode !== 200) {
      throw new Error(`node /healthz beklenen 200, alinan ${nodeHealth.statusCode}`);
    }
    checks.push('node:/healthz=200');
  }

  const exploreFriends = await requestHttp({
    port: GO_BACKEND_PORT,
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
    port: GO_BACKEND_PORT,
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
    port: GO_BACKEND_PORT,
    path: '/api/v1/profile/request-summary',
  });
  if (profileSummary.statusCode !== 401) {
    throw new Error(`/api/v1/profile/request-summary beklenen 401, alinan ${profileSummary.statusCode}`);
  }
  checks.push('profile/request-summary=401');

  const mapPreferences = await requestHttp({
    port: GO_BACKEND_PORT,
    path: '/api/v1/map/preferences',
  });
  if (mapPreferences.statusCode !== 401) {
    throw new Error(`/api/v1/map/preferences beklenen 401, alinan ${mapPreferences.statusCode}`);
  }
  checks.push('map/preferences=401');

  const profilePrivacy = await requestHttp({
    port: GO_BACKEND_PORT,
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
    port: GO_BACKEND_PORT,
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
    port: GO_BACKEND_PORT,
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
    port: GO_BACKEND_PORT,
  });
}

async function verifyProfileContract() {
  const goState = await inspectBackend(GO_BACKEND_PORT);
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

function inspectMetro() {
  return new Promise(resolve => {
    const request = http.get(`http://127.0.0.1:${METRO_PORT}/status`, response => {
      resolve({
        reachable: true,
        statusCode: response.statusCode,
      });
      response.resume();
    });

    request.on('error', () => resolve({
      reachable: false,
      statusCode: null,
    }));
    request.setTimeout(1200, () => {
      request.destroy();
      resolve({
        reachable: false,
        statusCode: null,
      });
    });
  });
}

function assertBackendSlotFree(port, expectedService, state) {
  if (!state.reachable) {
    return;
  }

  if (state.statusCode !== 200) {
    throw new Error(
      `Port ${port} is occupied by a non-backend HTTP service (status ${state.statusCode}). Stop it and rerun npm start.`,
    );
  }

  if (state.healthy && state.service === expectedService) {
    return;
  }

  const holder = state.service ? `"${state.service}"` : 'unknown service';
  throw new Error(`Port ${port} is occupied by ${holder}. Stop it and rerun npm start.`);
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

function cleanPortForMetro(port) {
  const autoResolveEnabled = isTruthy(process.env.BACKEND_AUTO_RESOLVE_PORTS, true);
  if (!autoResolveEnabled) {
    return false;
  }

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
    throw new Error(`Auto clean failed for port ${port}: ${result.error?.message || String(result.stderr || '').trim() || `code ${result.status}`}`);
  }

  return true;
}

async function recoverMetroPort(state) {
  const statusInfo = state?.statusCode == null ? 'unknown' : state.statusCode;
  console.warn(`[metro] Port ${METRO_PORT} is occupied (status ${statusInfo}). Trying automatic recovery...`);

  cleanPortForMetro(METRO_PORT);
  if (WAIT_AFTER_CLEAN_MS > 0) {
    await sleep(WAIT_AFTER_CLEAN_MS);
  }

  const after = await inspectMetro();
  if (after.reachable && after.statusCode === 200) {
    return true;
  }

  return false;
}

async function startRustSensorNodeFallback(reason, disableRustSensorBridge, options = {}) {
  const shouldStartFallback = isTruthy(process.env.START_RUST_SENSOR_NODE_FALLBACK, true);
  if (!shouldStartFallback) {
    disableRustSensorBridge(reason);
    return null;
  }

  const shouldLogReason = options.logReason !== false;
  if (shouldLogReason) {
    console.log(`[rust-sensor] node sensor backend baslatiliyor (${reason})...`);
  } else {
    console.log('[rust-sensor] node sensor backend baslatiliyor...');
  }
  spawnProcess(
    'rust-sensor-fallback',
    process.execPath,
    [path.join(root, 'backend', 'scripts', 'start-rust-sensor-fallback.js')],
    {
      env: {
        ...process.env,
        RUST_SENSOR_HOST,
        RUST_SENSOR_PORT,
      },
    },
  );

  try {
    const { readyMs } = await waitForHealthy(RUST_SENSOR_PORT, 'rust-sensor', 120, RUST_SENSOR_HOST);
    return readyMs;
  } catch {
    disableRustSensorBridge(`node fallback healthy olmadi (${reason})`);
    return null;
  }
}

async function waitForHealthy(port, expectedService, retries = 60, host = '127.0.0.1') {
  const startedAt = Date.now();

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const state = await inspectBackend(port, host);
    if (state.reachable && state.statusCode !== 200) {
      throw new Error(
        `${expectedService} backend port ${port} is occupied by non-backend service (status ${state.statusCode}).`,
      );
    }

    if (state.healthy && state.service === expectedService) {
      const readyMs = Date.now() - startedAt;
      return { readyMs };
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(`${expectedService} backend failed to become healthy on port ${port}`);
}

async function waitForMetro(retries = 80) {
  const startedAt = Date.now();

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const state = await inspectMetro();
    if (state.reachable && state.statusCode === 200) {
      return { readyMs: Date.now() - startedAt };
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error('Metro did not become ready on port 8081');
}

async function ensureRustSensorBackend() {
  const disableRustSensorBridge = reason => {
    process.env.RUST_SENSOR_BRIDGE_ENABLED = 'false';
    console.warn(`[rust-sensor] atlandi: ${reason}`);
  };

  const shouldStartRust = isTruthy(process.env.START_RUST_SENSOR_BACKEND, true);
  if (!shouldStartRust) {
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

  const state = await inspectBackend(RUST_SENSOR_PORT, RUST_SENSOR_HOST);
  if (state.reachable && state.statusCode !== 200) {
    throw new Error(
      `Port ${RUST_SENSOR_PORT} is occupied by a non-rust-sensor service (status ${state.statusCode}). Stop it and rerun npm start.`,
    );
  }

  if (!state.healthy) {
    if (!hasCargo()) {
      const fallbackStarted = await startRustSensorNodeFallback('cargo bulunamadi', disableRustSensorBridge, {
        logReason: false,
      });
      return fallbackStarted ? 'fallback started (cargo yok)' : 'fallback skipped';
    }
    if (!hasWindowsMsvcLinker()) {
      const fallbackStarted = await startRustSensorNodeFallback(
        'MSVC linker (link.exe) bulunamadi',
        disableRustSensorBridge,
        { logReason: false },
      );
      return fallbackStarted ? 'fallback started (linker yok)' : 'fallback skipped';
    }

    spawnProcess('rust-sensor', process.execPath, [
      path.join(root, 'backend', 'scripts', 'start-rust-sensor.js'),
    ], {
      env: {
        ...process.env,
        RUST_SENSOR_HOST,
        RUST_SENSOR_PORT,
      },
    });
    const { readyMs } = await waitForHealthy(RUST_SENSOR_PORT, 'rust-sensor', 240, RUST_SENSOR_HOST);
    return `started in ${readyMs}ms`;
  }

  if (state.service !== 'rust-sensor') {
    throw new Error(
      `Port ${RUST_SENSOR_PORT} is occupied by ${state.service || 'another'} service. Stop it and rerun npm start.`,
    );
  }

  return `already running on port ${RUST_SENSOR_PORT}`;
}

async function ensureNodeBackend() {
  const shouldStartNode = isTruthy(process.env.START_NODE_BACKEND, true);
  if (!shouldStartNode) {
    return 'skipped (START_NODE_BACKEND=0)';
  }

  const nodeState = await inspectBackend(NODE_BACKEND_PORT);
  assertBackendSlotFree(NODE_BACKEND_PORT, 'node', nodeState);
  if (!nodeState.healthy) {
    spawnProcess('node-backend', process.execPath, [
      path.join(root, 'backend', 'node', 'server.js'),
    ], {
      env: {
        ...process.env,
        PORT: NODE_BACKEND_PORT,
      },
    });
    const { readyMs } = await waitForHealthy(NODE_BACKEND_PORT, 'node');
    return `started on port ${NODE_BACKEND_PORT} in ${readyMs}ms`;
  }

  return `already running on port ${NODE_BACKEND_PORT}`;
}

async function ensureGoBackend() {
  const goState = await inspectBackend(GO_BACKEND_PORT);
  assertBackendSlotFree(GO_BACKEND_PORT, 'go', goState);
  if (!goState.healthy) {
    spawnProcess('go-backend', process.execPath, [
      path.join(root, 'backend', 'scripts', 'start-go.js'),
    ], {
      env: {
        ...process.env,
        GO_PORT: GO_BACKEND_PORT,
        PORT: GO_BACKEND_PORT,
        AUTH_DEBUG_PREVIEW:
          process.env.AUTH_DEBUG_PREVIEW || 'true',
        GO_FORCE_GO_RUN:
          process.env.GO_FORCE_GO_RUN || '0',
        RUST_SENSOR_BRIDGE_ENABLED:
          process.env.RUST_SENSOR_BRIDGE_ENABLED || 'true',
        RUST_SENSOR_WS_URL:
          process.env.RUST_SENSOR_WS_URL ||
          `ws://${RUST_SENSOR_HOST}:${RUST_SENSOR_PORT}/ws/sensors`,
      },
    });
    const { readyMs } = await waitForHealthy(GO_BACKEND_PORT, 'go', 180);
    return `started on port ${GO_BACKEND_PORT} in ${readyMs}ms`;
  }

  return `already running on port ${GO_BACKEND_PORT}`;
}

async function ensureMetro() {
  let metroState = await inspectMetro();
  if (metroState.reachable && metroState.statusCode === 200) {
    return `already running on port ${METRO_PORT}`;
  }

  if (metroState.reachable && metroState.statusCode !== 200) {
    const recovered = await recoverMetroPort(metroState);
    if (recovered) {
      return `recovered from stale service on port ${METRO_PORT}`;
    }
  }

  const metroMaxWorkers = String(process.env.METRO_MAX_WORKERS || '0');
  spawnProcess('metro', process.execPath, [
    resolveReactNativeCli(),
    'start',
    '--max-workers',
    metroMaxWorkers,
  ], {
    env: process.env,
  });

  const { readyMs } = await waitForMetro();
  return `started on port ${METRO_PORT} in ${readyMs}ms`;
}

async function main() {
  await withStartupStep('Clean backend stack', async () => runBootCleaner());
  await withStartupStep('Voice storage', async () => ensureVoiceStorage());
  await withStartupStep('Rust sensor backend', ensureRustSensorBackend);
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
  applyCssInteropPatch();
  await withStartupStep('Metro bundler', ensureMetro);
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
    printStartupReport('App Stack');
  })
  .catch(error => {
    printStartupReport('App Stack', error);
    shutdown(1);
  });
