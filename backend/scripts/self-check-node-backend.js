const http = require('node:http');
const { Buffer } = require('node:buffer');
require('./load-backend-env');

const HOST = process.env.NODE_HOST || '127.0.0.1';
const PORT = process.env.NODE_PORT || process.env.PORT || '8090';

function request({ path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const hasBody = body != null && method !== 'GET' && method !== 'HEAD';
    const payload = hasBody
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : '';

    const requestHeaders = { ...headers };
    if (hasBody && !requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    if (hasBody) {
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
          resolve({ body: raw, statusCode: response.statusCode || 0 });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error(`Request timeout for ${method} ${path}`));
    });

    if (hasBody) {
      req.write(payload);
    }
    req.end();
  });
}

function parseJson(raw, label) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${label}: response is not valid JSON`);
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

function readErrorCode(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const target = payload.error && typeof payload.error === 'object'
    ? payload.error
    : payload;
  return typeof target.code === 'string' ? target.code : '';
}

function expectStatus(response, expectedStatus, label) {
  if (response.statusCode !== expectedStatus) {
    throw new Error(`${label}: expected ${expectedStatus}, got ${response.statusCode}`);
  }
}

function expectErrorCode(response, expectedCode, label) {
  const payload = parseJson(response.body, label);
  const actualCode = readErrorCode(payload);
  if (actualCode !== expectedCode) {
    throw new Error(`${label}: expected error code "${expectedCode}", got "${actualCode || 'unknown'}"`);
  }
}

function expectErrorCodeOneOf(response, expectedCodes, label) {
  const payload = parseJson(response.body, label);
  const actualCode = readErrorCode(payload);
  if (!expectedCodes.includes(actualCode)) {
    throw new Error(
      `${label}: expected one of [${expectedCodes.join(', ')}], got "${actualCode || 'unknown'}"`,
    );
  }
}

async function runSelfCheck() {
  const health = await request({ path: '/healthz' });
  expectStatus(health, 200, 'healthz');
  const healthPayload = unwrapData(parseJson(health.body, 'healthz'));
  if (healthPayload?.status !== 'ok' || healthPayload?.service !== 'node') {
    throw new Error('healthz: unexpected payload');
  }

  const meUnauthorized = await request({ path: '/api/v1/profile/me' });
  expectStatus(meUnauthorized, 401, 'profile/me unauthorized');
  expectErrorCode(meUnauthorized, 'unauthorized', 'profile/me unauthorized');

  const invalidLogin = await request({
    body: {},
    method: 'POST',
    path: '/api/v1/auth/login',
  });
  expectStatus(invalidLogin, 400, 'auth/login invalid payload');
  expectErrorCode(invalidLogin, 'invalid_request', 'auth/login invalid payload');

  const invalidSocial = await request({
    body: { provider: 'apple' },
    method: 'POST',
    path: '/api/v1/auth/social',
  });
  expectStatus(invalidSocial, 400, 'auth/social invalid provider');
  expectErrorCode(
    invalidSocial,
    'invalid_provider',
    'auth/social invalid provider',
  );

  const invalidRegister = await request({
    body: {},
    method: 'POST',
    path: '/api/v1/auth/register',
  });
  expectStatus(invalidRegister, 400, 'auth/register invalid payload');
  expectErrorCodeOneOf(
    invalidRegister,
    ['invalid_full_name', 'invalid_username'],
    'auth/register invalid payload',
  );

  const invalidResetRequest = await request({
    body: {},
    method: 'POST',
    path: '/api/v1/auth/password-reset/request',
  });
  expectStatus(
    invalidResetRequest,
    400,
    'auth/password-reset/request invalid payload',
  );
  expectErrorCode(
    invalidResetRequest,
    'invalid_email',
    'auth/password-reset/request invalid payload',
  );

  const invalidJson = await request({
    body: '{"email":',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    path: '/api/v1/auth/login',
  });
  expectStatus(invalidJson, 400, 'invalid json payload');
  expectErrorCode(invalidJson, 'invalid_json', 'invalid json payload');

  const exploreUsers = await request({
    method: 'GET',
    path: '/api/v1/explore/search/users?limit=3&cursor=0',
  });
  expectStatus(exploreUsers, 200, 'explore/search/users');
  const exploreUsersPayload = unwrapData(
    parseJson(exploreUsers.body, 'explore/search/users'),
  );
  if (!Array.isArray(exploreUsersPayload?.users)) {
    throw new Error('explore/search/users: users array missing');
  }
  if (
    exploreUsersPayload?.hasMore != null &&
    typeof exploreUsersPayload.hasMore !== 'boolean'
  ) {
    throw new Error('explore/search/users: hasMore must be boolean');
  }

  const explorePosts = await request({
    method: 'GET',
    path: '/api/v1/explore/search/posts?limit=3&mediaType=photo&sort=recent',
  });
  expectStatus(explorePosts, 200, 'explore/search/posts');
  const explorePostsPayload = unwrapData(
    parseJson(explorePosts.body, 'explore/search/posts'),
  );
  if (!Array.isArray(explorePostsPayload?.posts)) {
    throw new Error('explore/search/posts: posts array missing');
  }
  if (
    explorePostsPayload?.hasMore != null &&
    typeof explorePostsPayload.hasMore !== 'boolean'
  ) {
    throw new Error('explore/search/posts: hasMore must be boolean');
  }
}

runSelfCheck()
  .then(() => {
    console.log('[self-check] Node health + auth + explore search contract OK');
  })
  .catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
