const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function ensureWritableDir(dirPath) {
  const resolved = ensureDir(dirPath);
  const probePath = path.join(
    resolved,
    `.write-probe-${process.pid}-${Date.now()}.tmp`,
  );
  fs.writeFileSync(probePath, 'ok');
  fs.unlinkSync(probePath);
  return resolved;
}

function resolveCacheRoot(baseEnv = process.env) {
  const configuredRoot = baseEnv.MACRADAR_CACHE_DIR?.trim();
  const localAppData = baseEnv.LOCALAPPDATA?.trim();
  const candidates = [
    configuredRoot,
    localAppData
      ? path.join(localAppData, 'MacRadar', 'backend-cache')
      : null,
    path.join(os.tmpdir(), 'macradar-backend-cache'),
    path.join(root, 'backend', '.cache'),
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return ensureWritableDir(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function buildGoEnv(baseEnv = process.env) {
  if (
    process.platform === 'win32' &&
    String(baseEnv.MACRADAR_FORCE_CUSTOM_GO_CACHE || '').trim().toLowerCase() !== '1'
  ) {
    // Let the Go toolchain decide cache/temp paths on Windows because
    // custom GOTMPDIR executables can be blocked by local policy.
    return {
      ...baseEnv,
    };
  }

  const cacheRoot = resolveCacheRoot(baseEnv);
  const goCache = ensureDir(path.join(cacheRoot, 'go-build'));
  const goTmpDir = ensureDir(path.join(cacheRoot, 'go-tmp'));

  return {
    ...baseEnv,
    GOCACHE: baseEnv.GOCACHE || goCache,
    GOTMPDIR: baseEnv.GOTMPDIR || goTmpDir,
  };
}

module.exports = {
  buildGoEnv,
};
