const http = require('node:http');
const { Buffer } = require('node:buffer');

const seedUsers = [
  {
    city: 'Istanbul',
    email: 'seed.route.alp@macradar.app',
    fullName: 'Alp Route',
    provider: 'google',
    username: 'alproute',
  },
  {
    city: 'Istanbul',
    email: 'seed.night.driver@macradar.app',
    fullName: 'Night Driver',
    provider: 'google',
    username: 'nightdriver',
  },
  {
    city: 'Istanbul',
    email: 'seed.city.line@macradar.app',
    fullName: 'City Line',
    provider: 'google',
    username: 'cityline',
  },
];

const seedPosts = [
  {
    caption:
      '#istanbul #macradar Gece rotasi acildi. Seed akisi backend uzerinden canli.',
    location: 'Besiktas',
    mediaType: 'photo',
    mediaUrl:
      'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=1200&q=80',
  },
  {
    caption:
      '#sahil #sizinicin Sabah surusu icin yeni rota. Kesfet ve takipte listeleri aktif.',
    location: 'Kadikoy',
    mediaType: 'photo',
    mediaUrl:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    caption:
      '#citydrive #trendtag Soguk baslangic tamamlandi. Realtime feed backend ile senkron.',
    location: 'Sisli',
    mediaType: 'photo',
    mediaUrl:
      'https://images.unsplash.com/photo-1510525009512-ad7fc13eefab?auto=format&fit=crop&w=1200&q=80',
  },
];

function requestHttp({
  host = '127.0.0.1',
  port,
  path: requestPath = '/',
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 3500,
}) {
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
        host,
        port,
        path: requestPath,
        method,
        headers: requestHeaders,
      },
      res => {
        let raw = '';
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({
            body: raw,
            statusCode: res.statusCode || 0,
          });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout ${method} ${requestPath}`));
    });

    if (hasBody) {
      req.write(payload);
    }
    req.end();
  });
}

function parseJSON(rawBody, pathLabel) {
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Error(`${pathLabel} response parse edilemedi`);
  }
}

function unwrapEnvelope(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }
  return payload;
}

async function fetchOverview(host, port) {
  const response = await requestHttp({
    host,
    port,
    path: '/api/v1/app/overview',
  });
  if (response.statusCode !== 200) {
    throw new Error(`/api/v1/app/overview beklenen 200, alinan ${response.statusCode}`);
  }

  const payload = parseJSON(response.body, '/api/v1/app/overview');
  return unwrapEnvelope(payload);
}

async function socialLogin(host, port, user) {
  const response = await requestHttp({
    host,
    port,
    path: '/api/v1/auth/social',
    method: 'POST',
    body: user,
  });
  if (response.statusCode !== 200) {
    throw new Error(`/api/v1/auth/social beklenen 200, alinan ${response.statusCode}`);
  }

  const payload = parseJSON(response.body, '/api/v1/auth/social');
  const data = unwrapEnvelope(payload);
  const token = data?.session?.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('/api/v1/auth/social session token donmedi');
  }

  return token;
}

async function createProfilePost(host, port, token, post) {
  const response = await requestHttp({
    host,
    port,
    path: '/api/v1/profile/me/posts',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: post,
  });

  if (response.statusCode !== 201 && response.statusCode !== 200) {
    throw new Error(`/api/v1/profile/me/posts beklenen 201/200, alinan ${response.statusCode}`);
  }
}

async function ensureGoExploreSeed({
  host = '127.0.0.1',
  minLivePosts = 3,
  port,
} = {}) {
  const before = await fetchOverview(host, port);
  const beforeCount = Number(before?.activePostsCount || 0);
  if (beforeCount >= minLivePosts) {
    return {
      details: `seed atlandi (activePostsCount=${beforeCount})`,
      status: 'READY',
    };
  }

  for (let index = 0; index < seedUsers.length; index += 1) {
    const token = await socialLogin(host, port, seedUsers[index]);
    await createProfilePost(host, port, token, seedPosts[index % seedPosts.length]);
  }

  const after = await fetchOverview(host, port);
  const afterCount = Number(after?.activePostsCount || 0);
  if (afterCount < minLivePosts) {
    throw new Error(`explore seed sonrasi activePostsCount yetersiz (${afterCount})`);
  }

  return {
    details: `seed tamamlandi (activePostsCount ${beforeCount} -> ${afterCount})`,
    status: 'READY',
  };
}

module.exports = {
  ensureGoExploreSeed,
};
