const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const rustRoot = path.join(root, 'backend', 'rust', 'sensor-hub');
const sensorHost = String(process.env.RUST_SENSOR_HOST || '127.0.0.1');
const sensorPort = String(process.env.RUST_SENSOR_PORT || '8181');

const child = spawn('cargo', ['run', '--release'], {
  cwd: rustRoot,
  env: {
    ...process.env,
    RUST_SENSOR_HOST: sensorHost,
    RUST_SENSOR_PORT: sensorPort,
  },
  stdio: 'inherit',
});

child.on('error', error => {
  console.error(`[rust-sensor] ${error.message}`);
  process.exit(1);
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
