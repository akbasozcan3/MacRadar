const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Buffer } = require('node:buffer');
require('./load-backend-env');

const HOST = process.env.NODE_HOST || '127.0.0.1';
const PORT = process.env.NODE_PORT || process.env.PORT || '8090';
const STORE_CANDIDATES = [
  path.resolve(__dirname, '..', 'node', 'data', 'local-store.json'),
  path.resolve(__dirname, '..', 'node', 'data', 'local-store-go-fallback.json'),
];

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function request({ path: requestPath, method = 'GET', headers = {}, body = null }) {
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
        path: requestPath,
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
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error(`Request timeout for ${method} ${requestPath}`));
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

function expectErrorCode(response, expectedCode, label) {
  const payload = parseJSON(response.body, label);
  const body = payload?.error ?? payload;
  if (body?.code !== expectedCode) {
    throw new Error(`${label} expected code "${expectedCode}" but received "${body?.code || 'unknown'}"`);
  }
}

function hasErrorCode(response, expectedCode, label) {
  const payload = parseJSON(response.body, label);
  const body = payload?.error ?? payload;
  return body?.code === expectedCode;
}

function readStoreState() {
  for (const filePath of STORE_CANDIDATES) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // ignore malformed transient reads and keep trying
    }
  }
  return null;
}

function pickLatestCodeFromState(state, listKey, email) {
  if (!state || typeof state !== 'object') {
    return '';
  }

  const list = Array.isArray(state[listKey]) ? state[listKey] : [];
  const targetEmail = normalizeEmail(email);
  const now = Date.now();

  const candidates = list
    .filter(item => item && typeof item === 'object')
    .filter(item => normalizeEmail(item.email) === targetEmail)
    .filter(item => item.used !== true)
    .filter(item => typeof item.code === 'string' && item.code.trim().length > 0)
    .filter(item => {
      const expiresMs = new Date(item.expiresAt || 0).getTime();
      return Number.isFinite(expiresMs) ? expiresMs > now : true;
    })
    .sort((left, right) => {
      const leftMs = new Date(left.createdAt || 0).getTime();
      const rightMs = new Date(right.createdAt || 0).getTime();
      return rightMs - leftMs;
    });

  if (candidates.length === 0) {
    return '';
  }

  return String(candidates[0].code).trim();
}

async function waitForCodeFromStore({ email, listKey, timeoutMs = 6000 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const state = readStoreState();
    const code = pickLatestCodeFromState(state, listKey, email);
    if (code.length > 0) {
      return code;
    }
    await sleep(120);
  }
  return '';
}

async function resolveChallengeCode({
  challenge,
  email,
  listKey,
  label,
}) {
  if (typeof challenge?.debugCode === 'string' && challenge.debugCode.trim().length > 0) {
    return challenge.debugCode.trim();
  }

  const fallbackCode = await waitForCodeFromStore({ email, listKey });
  if (fallbackCode.length > 0) {
    return fallbackCode;
  }

  throw new Error(`${label} did not include a usable verification code`);
}

async function cleanupAccount(token, label) {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return;
  }

  const response = await request({
    path: '/api/v1/profile/me',
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.statusCode === 200) {
    return;
  }

  if (response.statusCode === 401) {
    return;
  }

  const payload = parseJSON(response.body, `${label} cleanup`);
  const body = payload?.error ?? payload;
  const code = typeof body?.code === 'string' ? body.code : 'unknown';
  throw new Error(`${label} cleanup failed (${response.statusCode}:${code})`);
}

async function cleanupAccounts(targets) {
  const failures = [];
  for (const target of targets) {
    try {
      await cleanupAccount(target.token, target.label);
    } catch (error) {
      failures.push(error?.message || String(error));
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join(' | '));
  }
}

async function registerVerifyAndLogin() {
  const unique = Date.now();
  const uniqueSuffix = unique.toString(36).slice(-8);
  const email = `smoke.register.${unique}@macradar.app`;
  const basePassword = 'Secret987!';
  const rotatedPassword = 'Secret876!';

  const register = await request({
    path: '/api/v1/auth/register',
    method: 'POST',
    body: {
      city: 'Istanbul',
      email,
      favoriteCar: 'BMW M4',
      fullName: 'Smoke Register User',
      password: basePassword,
      username: `smokerg${uniqueSuffix}`,
    },
  });
  if (register.statusCode === 503 && hasErrorCode(register, 'verification_email_failed', 'Node register challenge')) {
    return {
      reason: 'verification_email_failed',
      skipped: true,
    };
  }
  expectStatus(register, 201, 'Node register challenge');
  const registerPayload = unwrapData(parseJSON(register.body, 'Node register challenge'));
  if (registerPayload?.status !== 'pending_verification') {
    throw new Error('Register challenge status must be pending_verification');
  }

  const verificationCode = await resolveChallengeCode({
    challenge: registerPayload,
    email,
    listKey: 'verificationCodes',
    label: 'Register challenge',
  });

  const verify = await request({
    path: '/api/v1/auth/verify-email/confirm',
    method: 'POST',
    body: {
      code: verificationCode,
      email,
    },
  });
  expectStatus(verify, 200, 'Node verify email confirm');

  const login = await request({
    path: '/api/v1/auth/login',
    method: 'POST',
    body: {
      email,
      password: basePassword,
    },
  });
  expectStatus(login, 200, 'Node login after verification');
  const loginPayload = unwrapData(parseJSON(login.body, 'Node login'));
  const token = loginPayload?.session?.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Login did not return a valid session token');
  }

  const resetRequest = await request({
    path: '/api/v1/auth/password-reset/request',
    method: 'POST',
    body: { email },
  });
  if (
    resetRequest.statusCode === 503 &&
    hasErrorCode(resetRequest, 'password_reset_email_failed', 'Node password reset request')
  ) {
    return {
      cleanupToken: token,
      reason: 'password_reset_email_failed',
      skipped: true,
      token,
    };
  }
  expectStatus(resetRequest, 200, 'Node password reset request');
  const resetPayload = unwrapData(parseJSON(resetRequest.body, 'Node password reset request'));

  const resetCode = await resolveChallengeCode({
    challenge: resetPayload,
    email,
    listKey: 'passwordResetCodes',
    label: 'Password reset challenge',
  });

  const resetConfirm = await request({
    path: '/api/v1/auth/password-reset/confirm',
    method: 'POST',
    body: {
      code: resetCode,
      email,
      newPassword: rotatedPassword,
    },
  });
  expectStatus(resetConfirm, 200, 'Node password reset confirm');

  const loginWithNewPassword = await request({
    path: '/api/v1/auth/login',
    method: 'POST',
    body: {
      email,
      password: rotatedPassword,
    },
  });
  expectStatus(loginWithNewPassword, 200, 'Node login with rotated password');
  const rotatedPayload = unwrapData(parseJSON(loginWithNewPassword.body, 'Node rotated login'));
  const rotatedToken = rotatedPayload?.session?.token;
  if (typeof rotatedToken !== 'string' || rotatedToken.trim().length === 0) {
    throw new Error('Rotated password login did not return a valid session token');
  }

  const missingReset = await request({
    path: '/api/v1/auth/password-reset/request',
    method: 'POST',
    body: { email: `missing.${unique}@macradar.app` },
  });
  expectStatus(missingReset, 404, 'Node password reset missing account');
  const missingPayload = parseJSON(missingReset.body, 'Node password reset missing account');
  const missingError = missingPayload?.error ?? missingPayload;
  if (missingError?.code !== 'password_reset_not_allowed') {
    throw new Error('Missing account reset must return password_reset_not_allowed');
  }

  return { cleanupToken: rotatedToken, token };
}

async function registerAndLoginWithoutVerification() {
  const unique = Date.now();
  const uniqueSuffix = unique.toString(36).slice(-8);
  const email = `smoke.pending.${unique}@macradar.app`;
  const password = 'Secret987!';

  const register = await request({
    path: '/api/v1/auth/register',
    method: 'POST',
    body: {
      city: 'Istanbul',
      email,
      favoriteCar: 'BMW M4',
      fullName: 'Smoke Pending User',
      password,
      username: `smokepn${uniqueSuffix}`,
    },
  });
  if (
    register.statusCode === 503 &&
    hasErrorCode(register, 'verification_email_failed', 'Node register pending account')
  ) {
    return {
      reason: 'verification_email_failed',
      skipped: true,
    };
  }
  expectStatus(register, 201, 'Node register pending account');
  const registerPayload = unwrapData(parseJSON(register.body, 'Node register pending account'));
  if (registerPayload?.status !== 'pending_verification') {
    throw new Error('Pending register account must start as pending_verification');
  }

  const login = await request({
    path: '/api/v1/auth/login',
    method: 'POST',
    body: {
      email,
      password,
    },
  });
  expectStatus(login, 200, 'Node login without verification');
  const loginPayload = unwrapData(parseJSON(login.body, 'Node login without verification'));
  const token = loginPayload?.session?.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Pending account login did not return a valid session token');
  }
  if (loginPayload?.profile?.isEmailVerified === true) {
    throw new Error('Pending account must not be marked as email verified');
  }
  if (loginPayload?.profile?.status !== 'pending_verification') {
    throw new Error('Pending account status must remain pending_verification on login');
  }

  return token;
}

async function authenticateSocialSmoke() {
  const unique = Date.now();
  const uniqueSuffix = unique.toString(36).slice(-8);
  const login = await request({
    path: '/api/v1/auth/social',
    method: 'POST',
    body: {
      provider: 'google',
      email: `smoke.node.${unique}@macradar.app`,
      fullName: 'Smoke Node User',
      username: `smokend${uniqueSuffix}`,
      city: 'Istanbul',
    },
  });

  expectStatus(login, 200, 'Node social login');
  const payload = unwrapData(parseJSON(login.body, 'Node social login'));
  const token = payload?.session?.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Node social login did not return a session token');
  }
  return token;
}

async function validateBadRequests() {
  const invalidLogin = await request({
    path: '/api/v1/auth/login',
    method: 'POST',
    body: {},
  });
  expectStatus(invalidLogin, 400, 'Node login invalid payload');
  expectErrorCode(invalidLogin, 'invalid_request', 'Node login invalid payload');

  const invalidProvider = await request({
    path: '/api/v1/auth/social',
    method: 'POST',
    body: {
      provider: 'apple',
      email: 'invalid.provider@macradar.app',
    },
  });
  expectStatus(invalidProvider, 400, 'Node social invalid provider');
  expectErrorCode(invalidProvider, 'invalid_provider', 'Node social invalid provider');

  const invalidJson = await request({
    path: '/api/v1/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email":',
  });
  expectStatus(invalidJson, 400, 'Node invalid json payload');
  expectErrorCode(invalidJson, 'invalid_json', 'Node invalid json payload');
}

(async () => {
  const cleanupTargets = [];
  const limitedReasons = [];
  try {
    const health = await request({ path: '/healthz' });
    expectStatus(health, 200, 'Node backend health check');
    const healthPayload = unwrapData(parseJSON(health.body, 'Node backend health check'));
    if (healthPayload?.service !== 'node') {
      throw new Error('Node backend health payload does not report node service');
    }

    const bootstrap = await request({ path: '/api/v1/app/bootstrap' });
    expectStatus(bootstrap, 200, 'Node backend bootstrap check');
    const bootstrapPayload = unwrapData(
      parseJSON(bootstrap.body, 'Node backend bootstrap check'),
    );
    if (bootstrapPayload?.status !== 'ok') {
      throw new Error('Node backend bootstrap payload does not report ok status');
    }

    const meUnauth = await request({ path: '/api/v1/profile/me' });
    expectStatus(meUnauth, 401, 'Node profile me unauthenticated check');

    await validateBadRequests();

    const pendingFlow = await registerAndLoginWithoutVerification();
    if (typeof pendingFlow === 'string') {
      cleanupTargets.push({
        label: 'Node pending account',
        token: pendingFlow,
      });
    } else if (pendingFlow?.skipped) {
      limitedReasons.push(`pending:${pendingFlow.reason}`);
    }

    const registerFlow = await registerVerifyAndLogin();
    if (!registerFlow?.skipped) {
      cleanupTargets.push({
        label: 'Node local smoke account',
        token: registerFlow.cleanupToken,
      });
    } else {
      if (typeof registerFlow.cleanupToken === 'string' && registerFlow.cleanupToken.trim().length > 0) {
        cleanupTargets.push({
          label: 'Node local smoke account (partial)',
          token: registerFlow.cleanupToken,
        });
      }
      limitedReasons.push(`register:${registerFlow.reason}`);
    }

    const socialToken = await authenticateSocialSmoke();
    cleanupTargets.push({
      label: 'Node social smoke account',
      token: socialToken,
    });

    const primaryToken =
      !registerFlow?.skipped &&
      typeof registerFlow?.token === 'string' &&
      registerFlow.token.trim().length > 0
        ? registerFlow.token
        : socialToken;
    const authHeader = { Authorization: `Bearer ${primaryToken}` };

    const help = await request({
      path: '/api/v1/profile/help',
      headers: authHeader,
    });
    expectStatus(help, 200, 'Node profile help');
    const helpPayload = unwrapData(parseJSON(help.body, 'Node profile help'));
    if (!Array.isArray(helpPayload?.items) || helpPayload.items.length === 0) {
      throw new Error('Node profile help payload did not include help items');
    }
    if (typeof helpPayload?.supportEmail !== 'string' || helpPayload.supportEmail.trim().length === 0) {
      throw new Error('Node profile help payload did not include supportEmail');
    }

    const socialHelp = await request({
      path: '/api/v1/profile/help',
      headers: { Authorization: `Bearer ${socialToken}` },
    });
    expectStatus(socialHelp, 200, 'Node social profile help');
  } finally {
    if (cleanupTargets.length > 0) {
      await cleanupAccounts(cleanupTargets);
    }
  }

  if (limitedReasons.length > 0) {
    console.log(
      `[smoke] Node auth smoke passed with SMTP-limited coverage (${limitedReasons.join(', ')})`,
    );
  } else {
    console.log('[smoke] Node auth flows (register/verify/login/reset/social) are reachable and protected');
  }
})().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
