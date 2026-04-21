const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function slugifyUsername(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');

  return normalized || 'macdriver';
}

function avatarForName(name) {
  const options = [
    'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=200&q=80',
  ];
  const hash = Array.from(String(name || '')).reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );

  return options[hash % options.length];
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  try {
    const [salt, digest] = String(storedHash || '').split(':');
    if (!salt || !digest) {
      return false;
    }

    const comparison = crypto
      .scryptSync(String(password), salt, 64)
      .toString('hex');
    const expectedBuffer = Buffer.from(digest, 'hex');
    const comparisonBuffer = Buffer.from(comparison, 'hex');

    if (expectedBuffer.length !== comparisonBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, comparisonBuffer);
  } catch {
    return false;
  }
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function expiresIn(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    const MAX_JSON_BYTES = 16 * 1024 * 1024;
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_JSON_BYTES) {
        reject(new Error('request payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid json payload'));
      }
    });
    req.on('error', reject);
  });
}

function readMultipartForm(req, options = {}) {
  return new Promise((resolve, reject) => {
    const contentType = normalizeText(req?.headers?.['content-type']);
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      reject(new Error('invalid multipart boundary'));
      return;
    }

    const boundary = normalizeText(boundaryMatch[1] || boundaryMatch[2]);
    if (!boundary) {
      reject(new Error('invalid multipart boundary'));
      return;
    }

    const maxBytes = Number.isFinite(options.maxBytes)
      ? Math.max(1, Math.floor(options.maxBytes))
      : 80 * 1024 * 1024;
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = error => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    req.on('data', chunk => {
      if (settled) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        fail(new Error('request payload too large'));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });

    req.on('end', () => {
      if (settled) {
        return;
      }
      try {
        const buffer = Buffer.concat(chunks);
        resolve(parseMultipartFormBuffer(buffer, boundary));
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error('invalid multipart payload'),
        );
      }
    });

    req.on('error', error => {
      fail(error);
    });
  });
}

function parseMultipartFormBuffer(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const delimiterBuffer = Buffer.from('\r\n\r\n');
  const fields = {};
  const files = [];
  let position = 0;

  while (position < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, position);
    if (boundaryIndex < 0) {
      break;
    }

    let cursor = boundaryIndex + boundaryBuffer.length;
    const suffix = buffer.slice(cursor, cursor + 2).toString('utf8');
    if (suffix === '--') {
      break;
    }
    if (suffix === '\r\n') {
      cursor += 2;
    }

    const headerEnd = buffer.indexOf(delimiterBuffer, cursor);
    if (headerEnd < 0) {
      break;
    }

    const headerText = buffer.slice(cursor, headerEnd).toString('utf8');
    const nextBoundaryIndex = buffer.indexOf(
      boundaryBuffer,
      headerEnd + delimiterBuffer.length,
    );
    if (nextBoundaryIndex < 0) {
      break;
    }

    let contentEnd = nextBoundaryIndex;
    if (
      contentEnd >= 2 &&
      buffer[contentEnd - 2] === 13 &&
      buffer[contentEnd - 1] === 10
    ) {
      contentEnd -= 2;
    }
    const content = buffer.slice(
      headerEnd + delimiterBuffer.length,
      contentEnd,
    );
    const part = parseMultipartPart(headerText, content);
    if (part) {
      if (part.kind === 'file') {
        files.push(part);
      } else {
        fields[part.name] = part.value;
      }
    }

    position = nextBoundaryIndex;
  }

  return { fields, files };
}

function parseMultipartPart(headerText, content) {
  const headers = {};
  for (const line of String(headerText || '').split('\r\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      headers[key] = value;
    }
  }

  const disposition = headers['content-disposition'] || '';
  const nameMatch = disposition.match(/name="([^"]+)"/i);
  if (!nameMatch) {
    return null;
  }
  const name = normalizeText(nameMatch[1]);
  if (!name) {
    return null;
  }

  const fileNameMatch = disposition.match(/filename="([^"]*)"/i);
  if (fileNameMatch) {
    return {
      contentType: normalizeText(headers['content-type']),
      data: content,
      fieldName: name,
      filename: normalizeText(fileNameMatch[1], 'upload.bin'),
      kind: 'file',
      name,
    };
  }

  return {
    kind: 'field',
    name,
    value: content.toString('utf8'),
  };
}

function sendJson(res, statusCode, payload, extraHeaders = undefined) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    Connection: 'keep-alive',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    ...(extraHeaders || {}),
  });
  res.end(body);
}

function sendEmpty(res, statusCode = 204) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  });
  res.end();
}

function errorPayload(code, message, details = undefined) {
  const payload = { code, message };
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    payload.details = details;
  }
  return payload;
}

function getBearerToken(req) {
  const value = normalizeText(req.headers.authorization);
  if (!value.toLowerCase().startsWith('bearer ')) {
    const requestUrl = normalizeText(req?.url);
    const normalizedUrl = requestUrl.toLowerCase();
    const allowQueryToken =
      normalizedUrl.startsWith('/ws/') ||
      normalizedUrl.startsWith('/api/v1/messages/voice/files/') ||
      normalizedUrl.startsWith('/api/v1/profile/post-media/files/');
    if (!allowQueryToken) {
      return '';
    }

    try {
      const parsed = new URL(requestUrl, 'http://localhost');
      const token = normalizeText(
        parsed.searchParams.get('token') ||
          parsed.searchParams.get('access_token'),
      );
      return token;
    } catch {
      return '';
    }
  }

  return value.slice(7).trim();
}

module.exports = {
  avatarForName,
  createId,
  createToken,
  errorPayload,
  expiresIn,
  getBearerToken,
  hashPassword,
  normalizeEmail,
  normalizeText,
  nowIso,
  readMultipartForm,
  readJson,
  sendEmpty,
  sendJson,
  slugifyUsername,
  verifyPassword,
};
