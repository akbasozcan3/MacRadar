/**
 * Creates incoming follow + street-friend requests through API (realtime events included).
 *
 * Usage:
 *   cd backend
 *   $env:TARGET_USERNAME="ozcanakb"; node scripts/seed-incoming-profile-requests-live.js
 *
 * Optional:
 *   $env:TARGET_EMAIL="you@example.com"
 *   $env:GO_HOST="127.0.0.1"
 *   $env:GO_PORT="8090"
 */

require('./load-backend-env');
const http = require('node:http');
const { Client } = require('pg');

function die(message) {
  console.error(message);
  process.exit(1);
}

function requestHttp({
  host = '127.0.0.1',
  port,
  path,
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 4500,
}) {
  return new Promise((resolve, reject) => {
    const hasBody = body != null && method !== 'GET' && method !== 'HEAD';
    const payload = hasBody ? JSON.stringify(body) : '';
    const nextHeaders = { ...headers };
    if (hasBody) {
      if (!nextHeaders['Content-Type']) {
        nextHeaders['Content-Type'] = 'application/json';
      }
      nextHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      { host, port, path, method, headers: nextHeaders },
      res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: raw,
          });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout ${method} ${path}`));
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
    throw new Error(`${label} response parse edilemedi`);
  }
}

function unwrapData(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

function normalizeUsername(raw) {
  const compact = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  if (compact.length >= 3) {
    return compact;
  }
  return `mx${Date.now().toString(36).slice(-8)}`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    die('DATABASE_URL is not set.');
  }

  const targetEmail = (process.env.TARGET_EMAIL || '').trim();
  const targetUsername = (process.env.TARGET_USERNAME || '').trim();
  if (!targetEmail && !targetUsername) {
    die('Set TARGET_EMAIL or TARGET_USERNAME.');
  }

  const db = new Client({ connectionString });
  await db.connect();

  let target;
  if (targetEmail) {
    const result = await db.query(
      'select id, username, email from users where lower(email) = lower($1) limit 1',
      [targetEmail],
    );
    target = result.rows[0];
  } else {
    const result = await db.query(
      'select id, username, email from users where lower(username) = lower($1) limit 1',
      [targetUsername],
    );
    target = result.rows[0];
  }
  if (!target) {
    await db.end();
    die('Target user not found.');
  }

  // Ensure follow goes into request flow for private accounts.
  await db.query(
    'update users set is_private_account = true, updated_at = now() where id = $1',
    [target.id],
  );
  await db.end();

  const host = process.env.GO_HOST?.trim() || '127.0.0.1';
  const port = String(
    process.env.GO_PORT || process.env.PORT || process.env.API_PORT || '8090',
  );

  const uniqueSeed = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000).toString(36)}`;
  const senderUsername = normalizeUsername(`mxreq${uniqueSeed}`);
  const senderEmail = `matrix.req.${uniqueSeed}@macradar.app`;

  const authResponse = await requestHttp({
    host,
    port,
    path: '/api/v1/auth/social',
    method: 'POST',
    body: {
      city: 'Istanbul',
      email: senderEmail,
      fullName: `Matrix Request Sender ${uniqueSeed.slice(-4)}`,
      provider: 'google',
      username: senderUsername,
    },
  });
  if (authResponse.statusCode !== 200) {
    die(`auth/social failed (${authResponse.statusCode}): ${authResponse.body}`);
  }
  const authPayload = unwrapData(parseJson(authResponse.body, 'auth/social'));
  const senderToken = String(authPayload?.session?.token || '').trim();
  const senderId = String(authPayload?.profile?.id || '').trim();
  if (!senderToken || !senderId) {
    die('auth/social token or sender profile missing.');
  }

  const authHeader = { Authorization: `Bearer ${senderToken}` };

  const followResponse = await requestHttp({
    host,
    port,
    path: `/api/v1/explore/creators/${target.id}/follow`,
    method: 'POST',
    headers: authHeader,
    body: {},
  });
  if (followResponse.statusCode !== 200) {
    die(`follow request failed (${followResponse.statusCode}): ${followResponse.body}`);
  }
  const followPayload = unwrapData(parseJson(followResponse.body, 'follow'));

  const streetResponse = await requestHttp({
    host,
    port,
    path: `/api/v1/explore/creators/${target.id}/street-friend`,
    method: 'POST',
    headers: authHeader,
    body: {},
  });
  if (streetResponse.statusCode !== 200) {
    die(
      `street request failed (${streetResponse.statusCode}): ${streetResponse.body}`,
    );
  }
  const streetPayload = unwrapData(parseJson(streetResponse.body, 'street-friend'));

  console.log(
    JSON.stringify(
      {
        ok: true,
        target: {
          id: target.id,
          username: target.username,
        },
        sender: {
          id: senderId,
          username: authPayload?.profile?.username || senderUsername,
          email: senderEmail,
        },
        followResponse: {
          followRequestStatus: followPayload?.followRequestStatus || null,
          isFollowing: Boolean(followPayload?.isFollowing),
        },
        streetResponse: {
          streetFriendStatus: streetPayload?.streetFriendStatus || null,
          isStreetFriend: Boolean(streetPayload?.isStreetFriend),
        },
        hint: 'Bildirim socket aciksa takip/yakindakiler notification.created eventi anlik dusmelidir.',
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});

