const http = require('node:http');
const { Buffer } = require('node:buffer');

const HOST = process.env.GO_HOST || '127.0.0.1';
const PORT = process.env.GO_PORT || process.env.PORT || '8090';

function request({ path, method = 'GET', headers = {}, body = null }) {
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
        host: HOST,
        method,
        path,
        port: PORT,
        headers: requestHeaders,
      },
      response => {
        let raw = '';
        response.on('data', chunk => {
          raw += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode || 0, body: raw });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error(`Request timeout for ${method} ${path}`));
    });

    if (hasBody) {
      req.write(payload);
    }
    req.end();
  });
}

function parseJSON(rawBody, label) {
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Error(`${label} response is not valid JSON`);
  }
}

function unwrapData(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }
  return payload;
}

function expectStatus(response, expectedStatus, label) {
  if (response.statusCode !== expectedStatus) {
    throw new Error(`${label} failed (${response.statusCode})`);
  }
}

async function authenticate() {
  const unique = Date.now();
  const uniqueSuffix = unique.toString(36).slice(-8);
  const login = await request({
    path: '/api/v1/auth/social',
    method: 'POST',
    body: {
      provider: 'google',
      email: `smoke.profile.${unique}@macradar.app`,
      fullName: 'Smoke Profile User',
      username: `smokepf${uniqueSuffix}`,
      city: 'Istanbul',
    },
  });

  expectStatus(login, 200, 'Go social login');

  const payload = unwrapData(parseJSON(login.body, 'Go social login'));
  const token = payload?.session?.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Go social login did not return a session token');
  }

  return token;
}

(async () => {
  const helpUnauth = await request({ path: '/api/v1/profile/help' });
  expectStatus(helpUnauth, 401, 'Go profile help unauthenticated check');

  const privacyUnauth = await request({ path: '/api/v1/profile/privacy' });
  expectStatus(privacyUnauth, 401, 'Go profile privacy unauthenticated check');

  const token = await authenticate();
  const authHeader = { Authorization: `Bearer ${token}` };

  const help = await request({
    path: '/api/v1/profile/help',
    headers: authHeader,
  });
  expectStatus(help, 200, 'Go profile help');

  const helpPayload = unwrapData(parseJSON(help.body, 'Go profile help'));
  if (!Array.isArray(helpPayload?.items) || helpPayload.items.length === 0) {
    throw new Error('Go profile help payload did not include help items');
  }
  if (typeof helpPayload?.supportEmail !== 'string' || helpPayload.supportEmail.trim().length === 0) {
    throw new Error('Go profile help payload did not include supportEmail');
  }

  const privacy = await request({
    path: '/api/v1/profile/privacy',
    headers: authHeader,
  });
  expectStatus(privacy, 200, 'Go profile privacy');

  const privacyPayload = unwrapData(parseJSON(privacy.body, 'Go profile privacy'));
  if (typeof privacyPayload?.isMapVisible !== 'boolean' || typeof privacyPayload?.isPrivateAccount !== 'boolean') {
    throw new Error('Go profile privacy payload shape is invalid');
  }

  console.log('[smoke] Go profile settings endpoints are reachable and protected');
})().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
