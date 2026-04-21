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

  const overview = await request('/api/v1/app/overview');
  if (overview.statusCode !== 200) {
    throw new Error(`Go backend overview endpoint failed (${overview.statusCode})`);
  }

  console.log('[smoke] Go auth flow endpoints are reachable');
})().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
