const fs = require('fs');
const path = require('path');

const cssInteropFilePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-css-interop',
  'dist',
  'metro',
  'index.js',
);

const cssInteropTarget = 'if (!fs.getSha1.__css_interop_patched) {';
const cssInteropReplacement = [
  'if (!fs || typeof fs.getSha1 !== "function") {',
  '        return fs;',
  '    }',
  '    if (!fs.getSha1.__css_interop_patched) {',
].join('\n');

const runServerFilePath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native',
  'community-cli-plugin',
  'dist',
  'commands',
  'start',
  'runServer.js',
);

const devToolsTarget = [
  '  const { middleware, websocketEndpoints } = (0,',
  '  _devMiddleware.createDevMiddleware)({',
  '    serverBaseUrl: devServerUrl,',
  '    logger: (0, _createDevMiddlewareLogger.default)(terminalReporter),',
  '  });',
].join('\n');

const devToolsReplacement = [
  '  const { middleware, websocketEndpoints } = (0,',
  '  _devMiddleware.createDevMiddleware)({',
  '    serverBaseUrl: devServerUrl,',
  '    logger: (0, _createDevMiddlewareLogger.default)(terminalReporter),',
  '    unstable_experiments: {',
  '      enableStandaloneFuseboxShell: false,',
  '    },',
  '  });',
].join('\n');

function patchFile(filePath, alreadyPatchedCheck, target, replacement, label) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const source = fs.readFileSync(filePath, 'utf8');
  if (alreadyPatchedCheck(source)) {
    return;
  }

  if (!source.includes(target)) {
    console.warn(`[${label}] Target snippet not found, skipping.`);
    return;
  }

  const patched = source.replace(target, replacement);
  fs.writeFileSync(filePath, patched, 'utf8');
  console.log(`[${label}] Patch applied.`);
}

function run() {
  patchFile(
    cssInteropFilePath,
    source => source.includes('typeof fs.getSha1 !== "function"'),
    cssInteropTarget,
    cssInteropReplacement,
    'patch-css-interop',
  );

  patchFile(
    runServerFilePath,
    source => source.includes('enableStandaloneFuseboxShell: false'),
    devToolsTarget,
    devToolsReplacement,
    'patch-rn-devtools',
  );
}

run();
