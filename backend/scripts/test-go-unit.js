const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildGoEnv } = require('./go-env');

const root = path.resolve(__dirname, '..', '..');
const goRoot = path.join(root, 'backend', 'go');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function run() {
  const repoGoModCache = path.join(root, '.gomodcache');
  const repoGoBuildCache = path.join(root, '.gocache');
  const repoGoTmpDir = path.join(root, '.gotmp');
  const defaultGoModCache = fs.existsSync(repoGoModCache)
    ? repoGoModCache
    : path.join(root, 'backend', '.cache', 'go-mod');
  const goModCache = ensureDir(
    process.env.GOMODCACHE || defaultGoModCache,
  );
  const goBuildCache = ensureDir(process.env.GOCACHE || repoGoBuildCache);
  const goTmpDir = ensureDir(process.env.GOTMPDIR || repoGoTmpDir);

  const env = buildGoEnv({
    ...process.env,
    GOCACHE: goBuildCache,
    GOMODCACHE: goModCache,
    GOTMPDIR: goTmpDir,
  });

  const windowsPolicySafeArgs = [
    'test',
    './cmd/...',
    './internal/account',
    './internal/config',
    './internal/explore',
    './internal/mail',
    './internal/messages',
    './internal/migrate',
    './internal/realtime',
    './internal/sensors',
  ];
  const defaultArgs = ['test', './...'];
  const skipServerPackage =
    String(process.env.GO_UNIT_SKIP_SERVER || '').trim().toLowerCase() === '1' ||
    String(process.env.GO_UNIT_SKIP_SERVER || '').trim().toLowerCase() === 'true';
  const shouldUseWindowsFallback =
    process.platform === 'win32' && skipServerPackage;
  const args = shouldUseWindowsFallback ? windowsPolicySafeArgs : defaultArgs;

  if (shouldUseWindowsFallback) {
    console.warn(
      '[go-unit] GO_UNIT_SKIP_SERVER etkin; internal/server paketi bu turda atlandi.',
    );
  }

  const result = spawnSync('go', args, {
    cwd: goRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[go-unit] ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

run();
