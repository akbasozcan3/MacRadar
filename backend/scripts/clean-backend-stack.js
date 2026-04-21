const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_MARKERS = [
  path.join(ROOT, 'backend', 'scripts', 'start-go.js').toLowerCase(),
  path.join(ROOT, 'backend', 'scripts', 'start-stack.js').toLowerCase(),
  path.join(ROOT, 'backend', 'scripts', 'start-app-stack.js').toLowerCase(),
  path.join(ROOT, 'backend', 'scripts', 'start-node-stack.js').toLowerCase(),
  path.join(ROOT, 'backend', 'scripts', 'start-node-app-stack.js').toLowerCase(),
  path.join(ROOT, 'backend', 'scripts', 'start-node-server.js').toLowerCase(),
  path.join(ROOT, 'backend', 'scripts', 'start-rust-sensor.js').toLowerCase(),
  path.join(ROOT, 'backend', 'scripts', 'start-rust-sensor-fallback.js').toLowerCase(),
  path.join(ROOT, 'backend', 'node', 'server.js').toLowerCase(),
  path.join(ROOT, 'backend', 'go', 'server.exe').toLowerCase(),
  path.join(ROOT, 'backend', 'go', 'server').toLowerCase(),
  path.join(ROOT, 'node_modules', 'react-native', 'cli.js').toLowerCase(),
  'react-native start',
];

const DEFAULT_TARGET_PORTS = ['8090', '8091', '8081', '8181'];
const TARGET_PORTS = parseTargetPorts(process.env.BACKEND_CLEAN_PORTS);
const DRY_RUN = parseBoolean(process.env.BACKEND_CLEAN_DRY_RUN, false);
const FORCE = parseBoolean(process.env.BACKEND_CLEAN_FORCE || process.env.CLEAN_BACKEND_STACK, true);
const KILL_UNKNOWN = parseBoolean(process.env.BACKEND_CLEAN_KILL_UNKNOWN, false);
const WAIT_MS = Number(process.env.BACKEND_CLEAN_WAIT_MS || '1800');
const PORT_SET = new Set(TARGET_PORTS);
const PREFERRED_NAMES = new Set(['node.exe', 'node', 'server.exe', 'server', 'go.exe', 'go']);
const USE_COLOR = !parseBoolean(process.env.BACKEND_CLEAN_NO_COLOR, false);
const USE_ICONS = !parseBoolean(process.env.BACKEND_CLEAN_NO_ICON, false);
const steps = [];
const killEvents = [];
const startupStartedAt = Date.now();

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[36m',
  bold: '\x1b[1m',
};

const STATUS = {
  DONE: { text: 'OK', color: COLORS.green },
  SKIP: { text: 'INFO', color: COLORS.blue },
  FAIL: { text: 'FAIL', color: COLORS.red },
  INFO: { text: 'INFO', color: COLORS.blue },
};

const ICONS = {
  DONE: '+',
  SKIP: '-',
  FAIL: 'x',
  INFO: '-',
};

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseTargetPorts(value) {
  const source = value || DEFAULT_TARGET_PORTS.join(',');
  const parsed = String(source)
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => Number.parseInt(token, 10))
    .filter(port => Number.isInteger(port) && port > 0 && port <= 65535)
    .map(port => String(port));

  return parsed.length ? Array.from(new Set(parsed)) : [...DEFAULT_TARGET_PORTS];
}

function colorize(text, color) {
  if (!USE_COLOR || !process.stdout.isTTY || process.env.FORCE_COLOR === '0') {
    return text;
  }
  return `${color}${text}${COLORS.reset}`;
}

function statusIcon(status) {
  if (!USE_ICONS) {
    return '';
  }
  return ` ${ICONS[status] || ''}`;
}

function startStep(name) {
  return {
    name,
    startedAt: Date.now(),
    index: steps.length + 1,
    status: 'INFO',
    detail: '',
  };
}

function finishStep(step, status, detail = '') {
  step.status = status;
  step.detail = detail;
  step.durationMs = Date.now() - step.startedAt;
  steps.push(step);

  const statusInfo = STATUS[status] || STATUS.INFO;
  const statusText = colorize(
    `[${statusInfo.text}]${statusIcon(status)}`,
    statusInfo.color,
  );
  const indexText = String(step.index).padStart(2, '0');
  console.log(
    `[${indexText}] ${statusText} ${step.name} (${step.durationMs}ms)${detail ? ` - ${detail}` : ''}`,
  );
}

function formatError(error) {
  if (error?.message) {
    return error.message;
  }
  return String(error);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/"/g, '')
    .replace(/\//g, '\\');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseNetstatOutput() {
  const step = startStep(`Discover listeners on ports ${TARGET_PORTS.join(', ')}`);
  const proc = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
  if (proc.error || proc.status !== 0) {
    const detail = `netstat failed: ${proc.error?.message || `exit code ${proc.status}`}`;
    finishStep(step, 'FAIL', detail);
    throw new Error(detail);
  }

  const pids = new Set();
  const lines = String(proc.stdout || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('LISTENING')) {
      continue;
    }

    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5) {
      continue;
    }

    const localAddress = tokens[1];
    const state = tokens[3];
    if (state !== 'LISTENING') {
      continue;
    }

    const portMatch = localAddress.match(/:(\d+)$/);
    if (!portMatch) {
      continue;
    }

    const localPort = portMatch[1];
    if (!PORT_SET.has(localPort)) {
      continue;
    }

    const pidToken = tokens[tokens.length - 1];
    const pid = Number.parseInt(pidToken, 10);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  const found = Array.from(pids);
  finishStep(step, 'DONE', `found ${found.length} PID candidate`);
  return found;
}

function parseWmicField(text, field) {
  const match = new RegExp(`^${field}=(.*)$`, 'im').exec(text);
  return match ? match[1].trim() : null;
}

function getProcessSnapshot(pid) {
  const proc = spawnSync(
    'wmic',
    ['process', 'where', `ProcessId=${pid}`, 'get', 'Name,CommandLine', '/format:list'],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );

  if (proc.error || proc.status !== 0) {
    return null;
  }

  const text = String(proc.stdout || '');
  const name = parseWmicField(text, 'Name');
  if (!name) {
    return null;
  }

  return {
    pid,
    name: normalizeText(name),
    commandLine: normalizeText(parseWmicField(text, 'CommandLine')),
  };
}

function isBackendCandidate(processInfo) {
  if (!processInfo || !processInfo.name) {
    return false;
  }

  const name = processInfo.name;
  const commandLine = processInfo.commandLine;

  if (!PREFERRED_NAMES.has(name)) {
    return false;
  }

  if (!commandLine) {
    return false;
  }

  if (TARGET_MARKERS.some(marker => commandLine.includes(marker))) {
    return true;
  }

  if ((name === 'node.exe' || name === 'node') && /backend[\\/]node[\\/]server\.js/.test(commandLine)) {
    return true;
  }

  if ((name === 'server.exe' || name === 'server') && /backend[\\/]go[\\/]server/.test(commandLine)) {
    return true;
  }

  if ((name === 'go.exe' || name === 'go') && /backend[\\/]go[\\/]/.test(commandLine)) {
    return true;
  }

  if (name === 'node.exe' || name === 'node') {
    return /backend[\\/]scripts[\\/]/.test(commandLine);
  }

  return false;
}

function killProcess(pid) {
  const proc = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (proc.error || proc.status !== 0) {
    throw new Error(
      `Failed to kill PID ${pid}: ${proc.error?.message || String(proc.stderr || '').trim() || `exit code ${proc.status}`}`,
    );
  }
}

function formatCandidate(processInfo) {
  const name = processInfo?.name || 'unknown';
  const command = processInfo?.commandLine ? ` - ${processInfo.commandLine}` : '';
  return `${name}(${processInfo?.pid})${command}`;
}

function pushKillEvent(type, pid, detail = '') {
  killEvents.push({ type, pid, detail });
}

async function cleanStack() {
  const pids = parseNetstatOutput();
  const inspectStep = startStep('Inspect backend candidates');

  if (!pids.length) {
    finishStep(inspectStep, 'INFO', `no listeners found on ${TARGET_PORTS.join('/')}`);
    printReport();
    return;
  }

  const killList = [];
  let ignoredUnknownCount = 0;
  let forceQueuedUnknownCount = 0;
  for (const pid of pids) {
    const info = getProcessSnapshot(pid);
    if (isBackendCandidate(info)) {
      killList.push(info);
      continue;
    }

    const unknownInfo = info || {
      pid,
      name: 'unknown',
      commandLine: '',
    };
    if (FORCE && KILL_UNKNOWN) {
      killList.push(unknownInfo);
      forceQueuedUnknownCount += 1;
      continue;
    }
    ignoredUnknownCount += 1;
  }

  const unique = [];
  const seen = new Set();
  for (const item of killList) {
    if (item?.pid && !seen.has(item.pid)) {
      seen.add(item.pid);
      unique.push(item);
    }
  }

  let inspectDetail = `selected ${unique.length} backend process(es)`;
  if (ignoredUnknownCount > 0) {
    inspectDetail += `, ignored ${ignoredUnknownCount} unrelated listener(s)`;
  }
  if (forceQueuedUnknownCount > 0) {
    inspectDetail += `, queued ${forceQueuedUnknownCount} unrecognized listener(s)`;
  }
  finishStep(inspectStep, 'DONE', inspectDetail);

  const killStep = startStep('Terminate stale backend processes');
  if (!unique.length) {
    finishStep(killStep, 'INFO', 'nothing recognized to kill');
    printReport();
    return;
  }

  if (DRY_RUN) {
    for (const item of unique) {
      pushKillEvent('SKIP', item.pid, 'dry-run mode');
      console.log(colorize(`[backend:clean] dry-run skip: ${formatCandidate(item)}`, COLORS.blue));
    }
    finishStep(killStep, 'INFO', `dry-run enabled, requested ${unique.length}`);
    printReport();
    return;
  }

  for (const item of unique) {
    if (!FORCE) {
      pushKillEvent('SKIP', item.pid, 'FORCE disabled');
      console.log(colorize(`[backend:clean] FORCE disabled; skipping ${formatCandidate(item)}`, COLORS.blue));
      continue;
    }

    try {
      killProcess(item.pid);
      pushKillEvent('DONE', item.pid, formatCandidate(item));
      console.log(colorize(`[backend:clean] killed: ${formatCandidate(item)}`, COLORS.green));
    } catch (error) {
      pushKillEvent('FAIL', item.pid, error?.message || String(error));
      console.error(colorize(`[backend:clean] failed to kill ${formatCandidate(item)}: ${error?.message || String(error)}`, COLORS.red));
    }
  }

  const killedCount = killEvents.filter(item => item.type === 'DONE').length;
  const failedCount = killEvents.filter(item => item.type === 'FAIL').length;
  if (WAIT_MS > 0) {
    await sleep(Math.max(0, WAIT_MS));
  }

  let detail = `requested ${unique.length}, killed ${killedCount}`;
  if (failedCount) {
    detail += `, failed ${failedCount}`;
  }
  finishStep(killStep, failedCount ? 'INFO' : 'DONE', detail);
  printReport();
}

function printReport() {
  const totalMs = Date.now() - startupStartedAt;
  const header = colorize('[backend:clean] startup report', COLORS.bold);
  console.log(`\n${header}`);

  for (const step of steps) {
    const marker = STATUS[step.status] || STATUS.INFO;
    const line = `[${String(step.index).padStart(2, '0')}] [${marker.text}]${statusIcon(step.status)} ${step.name} (${step.durationMs}ms)`;
    if (step.detail) {
      console.log(colorize(line, marker.color) + ` - ${step.detail}`);
    } else {
      console.log(colorize(line, marker.color));
    }
  }

  if (killEvents.length) {
    console.log(colorize('\n[backend:clean] pid action report', COLORS.bold));
    for (const event of killEvents) {
      const marker = STATUS[event.type] || STATUS.INFO;
      const eventStatus = event.type === 'DONE'
        ? `killed by pid ${event.pid}`
        : event.type === 'SKIP'
          ? `skipped by pid ${event.pid}`
          : `failed for pid ${event.pid}`;
      const line = `${eventStatus}${event.detail ? ` - ${event.detail}` : ''}`;
      console.log(colorize(`  [${marker.text}]${statusIcon(event.type)} ${line}`, marker.color));
    }
  }

  const summaryStatus = steps.every(step => step.status !== 'FAIL') ? 'SUCCESS' : 'FAILED';
  const summaryColor = summaryStatus === 'SUCCESS' ? COLORS.green : COLORS.red;
  console.log(colorize(`\n[backend:clean] ${summaryStatus} in ${totalMs}ms`, summaryColor));
}

(async () => {
  try {
    await cleanStack();
    process.exit(0);
  } catch (error) {
    steps.push({
      name: 'Terminal failure',
      startedAt: Date.now(),
      durationMs: 0,
      index: steps.length + 1,
      status: 'FAIL',
      detail: formatError(error),
    });
    printReport();
    process.exit(1);
  }
})();
