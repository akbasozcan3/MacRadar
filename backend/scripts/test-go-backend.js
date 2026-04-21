const http = require('node:http');

const HOST = process.env.GO_HOST || '127.0.0.1';
const PORT = process.env.GO_PORT || process.env.PORT || '8090';

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${HOST}:${PORT}${path}`, response => {
      let raw = '';
      response.on('data', chunk => {
        raw += chunk;
      });
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body: raw });
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error(`Request timeout for ${path}`));
    });
  });
}

(async () => {
  const health = await request('/healthz');
  if (health.statusCode !== 200) {
    throw new Error(`Go backend health check failed (${health.statusCode})`);
  }
  let payload = {};
  try {
    payload = health.body ? JSON.parse(health.body) : {};
  } catch {
    throw new Error('Go backend health response is not valid JSON');
  }

  if (payload?.data?.service !== 'go') {
    throw new Error('Go backend health payload does not report go service');
  }

  const bootstrap = await request('/api/v1/app/bootstrap');
  if (bootstrap.statusCode !== 200) {
    throw new Error(`Go backend bootstrap check failed (${bootstrap.statusCode})`);
  }
  let bootstrapPayload = {};
  try {
    bootstrapPayload = bootstrap.body ? JSON.parse(bootstrap.body) : {};
  } catch {
    throw new Error('Go backend bootstrap response is not valid JSON');
  }

  if (bootstrapPayload?.data?.status !== 'ok') {
    throw new Error('Go backend bootstrap payload does not report ok status');
  }

  console.log('[smoke] Go backend health + bootstrap endpoints are reachable');
})().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
