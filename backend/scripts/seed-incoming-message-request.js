/**
 * Creates an incoming message request for a target user.
 *
 * Usage (PowerShell):
 *   cd backend
 *   $env:TARGET_USERNAME="ozcankb"; node scripts/seed-incoming-message-request.js
 *
 * Optional:
 *   $env:TARGET_EMAIL="you@example.com"
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
  timeoutMs = 4000,
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
      {
        host,
        port,
        path,
        method,
        headers: nextHeaders,
      },
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
    die('DATABASE_URL is not set. Add it to .env (repo root or backend/.env).');
  }

  const targetEmail = (process.env.TARGET_EMAIL || '').trim();
  const targetUsername = (process.env.TARGET_USERNAME || '').trim();
  if (!targetEmail && !targetUsername) {
    die('Set TARGET_EMAIL or TARGET_USERNAME.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  let target;
  if (targetEmail) {
    const result = await client.query(
      'select id, username, email from users where lower(email) = lower($1) limit 1',
      [targetEmail],
    );
    target = result.rows[0];
  } else {
    const result = await client.query(
      'select id, username, email from users where lower(username) = lower($1) limit 1',
      [targetUsername],
    );
    target = result.rows[0];
  }

  if (!target) {
    await client.end();
    die('Target user not found.');
  }

  const host = process.env.GO_HOST?.trim() || '127.0.0.1';
  const port = String(
    process.env.GO_PORT || process.env.PORT || process.env.API_PORT || '8090',
  );
  const uniqueSeed = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000).toString(36)}`;
  const senderUsername = normalizeUsername(`mxsender${uniqueSeed}`);
  const senderEmail = `matrix.sender.${uniqueSeed}@macradar.app`;

  const authResponse = await requestHttp({
    host,
    port,
    path: '/api/v1/auth/social',
    method: 'POST',
    body: {
      city: 'Istanbul',
      email: senderEmail,
      fullName: `Matrix Sender ${uniqueSeed.slice(-4)}`,
      provider: 'google',
      username: senderUsername,
    },
  });
  if (authResponse.statusCode !== 200) {
    await client.end();
    die(
      `auth/social failed (${authResponse.statusCode}). Is Go backend running on ${host}:${port}?`,
    );
  }
  const authPayload = unwrapData(parseJson(authResponse.body, 'auth/social'));
  const senderToken = String(authPayload?.session?.token || '').trim();
  const senderProfile = authPayload?.profile || {};
  const senderUserID = String(senderProfile?.id || '').trim();
  if (!senderToken || !senderUserID) {
    await client.end();
    die('auth/social token or sender user id missing.');
  }
  if (senderUserID === target.id) {
    await client.end();
    die('Sender and target must be different users.');
  }

  const createResponse = await requestHttp({
    host,
    port,
    path: '/api/v1/messages/conversations',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${senderToken}`,
    },
    body: {
      recipientId: target.id,
      initialMessage: `Selam! Bu bir mesaj istegi testi (${uniqueSeed}).`,
    },
  });

  if (createResponse.statusCode !== 201 && createResponse.statusCode !== 200) {
    await client.end();
    die(
      `create conversation failed (${createResponse.statusCode}): ${createResponse.body}`,
    );
  }

  const createPayload = unwrapData(
    parseJson(createResponse.body, 'messages/conversations'),
  );
  const conversation = createPayload?.conversation || null;

  const summary = await client.query(
    `select
      c.id,
      c.last_message_at,
      dcr_target.request_accepted_at as target_request_accepted_at,
      dcr_target.request_rejected_at as target_request_rejected_at,
      dcr_sender.request_accepted_at as sender_request_accepted_at
    from direct_conversations c
    left join direct_conversation_reads dcr_target
      on dcr_target.conversation_id = c.id and dcr_target.user_id = $1
    left join direct_conversation_reads dcr_sender
      on dcr_sender.conversation_id = c.id and dcr_sender.user_id = $2
    where c.id = $3
    limit 1`,
    [target.id, senderUserID, String(createPayload?.conversationId || '')],
  );

  await client.end();

  console.log(
    JSON.stringify(
      {
        ok: true,
        target: {
          id: target.id,
          username: target.username,
        },
        sender: {
          id: senderUserID,
          username: senderProfile?.username || senderUsername,
          email: senderEmail,
        },
        conversationId: createPayload?.conversationId || null,
        conversationChatRequestStatus: conversation?.chatRequestStatus || null,
        conversationChatRequestDirection: conversation?.chatRequestDirection || null,
        dbConversationState: summary.rows[0] || null,
        hint: 'Mesajlar ekraninda "Istekler" filtresini acip kontrol et.',
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

