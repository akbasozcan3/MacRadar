const fs = require('node:fs');
const path = require('node:path');

function parseEnvContent(raw) {
  const output = {};
  const lines = String(raw || '').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const index = trimmed.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }

  return output;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const parsed = parseEnvContent(fs.readFileSync(filePath, 'utf8'));
  Object.entries(parsed).forEach(([key, value]) => {
    if (process.env[key] == null || String(process.env[key]).trim().length === 0) {
      process.env[key] = value;
    }
  });
}

function loadBackendEnv() {
  const backendRoot = path.resolve(__dirname, '..');
  const projectRoot = path.resolve(backendRoot, '..');
  loadEnvFile(path.join(projectRoot, '.env'));
  loadEnvFile(path.join(backendRoot, '.env'));
}

loadBackendEnv();

