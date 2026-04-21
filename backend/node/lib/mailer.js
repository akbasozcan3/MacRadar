const net = require('node:net');
const tls = require('node:tls');
const { randomBytes } = require('node:crypto');
const { Buffer } = require('node:buffer');

const DEFAULT_TIMEOUT_MS = 12000;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function parseBoolean(value, fallback = false) {
  if (value == null) {
    return fallback;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(normalizeText(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function parseFromEnvelopeAddress(fromValue) {
  const from = normalizeText(fromValue);
  const bracketMatch = from.match(/<([^>]+)>/);
  const candidate = bracketMatch ? bracketMatch[1] : from;
  return normalizeText(candidate).toLowerCase();
}

function buildMailConfig() {
  const host = normalizeText(process.env.SMTP_HOST);
  const port = parsePort(process.env.SMTP_PORT, 587);
  const user = normalizeText(process.env.SMTP_USER);
  const pass = normalizeText(process.env.SMTP_PASS);
  const from = normalizeText(process.env.SMTP_FROM);
  const fromEnvelope = parseFromEnvelopeAddress(from);
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);
  const requireStartTls = parseBoolean(
    process.env.SMTP_REQUIRE_TLS,
    !secure,
  );
  const rejectUnauthorized = parseBoolean(
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED,
    false,
  );
  const timeoutMs = parsePort(process.env.SMTP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  const enabled =
    host.length > 0 &&
    from.length > 0 &&
    fromEnvelope.includes('@') &&
    user.length > 0 &&
    pass.length > 0;

  const missing = [];
  if (host.length === 0) missing.push('SMTP_HOST');
  if (from.length === 0) missing.push('SMTP_FROM');
  if (user.length === 0) missing.push('SMTP_USER');
  if (pass.length === 0) missing.push('SMTP_PASS');
  if (!fromEnvelope.includes('@')) missing.push('SMTP_FROM(address)');

  return {
    enabled,
    from,
    fromEnvelope,
    host,
    missing,
    pass,
    port,
    rejectUnauthorized,
    requireStartTls,
    secure,
    timeoutMs,
    user,
  };
}

function createMailError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

function createLineReader(socket) {
  let buffer = '';
  const pendingLines = [];
  const waiters = [];
  let closedError = null;

  function flushWaiters() {
    while (waiters.length > 0 && pendingLines.length > 0) {
      const resolve = waiters.shift();
      const line = pendingLines.shift();
      resolve(line);
    }
  }

  function onData(chunk) {
    buffer += String(chunk);
    while (true) {
      const separatorIndex = buffer.indexOf('\r\n');
      if (separatorIndex < 0) {
        break;
      }
      const line = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      pendingLines.push(line);
    }
    flushWaiters();
  }

  function onError(error) {
    closedError = error || createMailError('smtp_socket_error', 'SMTP socket error');
    while (waiters.length > 0) {
      const resolve = waiters.shift();
      resolve(null);
    }
  }

  function onClose() {
    if (!closedError) {
      closedError = createMailError('smtp_socket_closed', 'SMTP socket closed');
    }
    while (waiters.length > 0) {
      const resolve = waiters.shift();
      resolve(null);
    }
  }

  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);

  function readLine(timeoutMs) {
    if (pendingLines.length > 0) {
      return Promise.resolve(pendingLines.shift());
    }
    if (closedError) {
      return Promise.reject(closedError);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = waiters.indexOf(onLine);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(createMailError('smtp_timeout', 'SMTP response timeout'));
      }, Math.max(1000, timeoutMs));

      function onLine(line) {
        clearTimeout(timeoutId);
        if (line == null) {
          reject(closedError || createMailError('smtp_socket_closed', 'SMTP socket closed'));
          return;
        }
        resolve(line);
      }

      waiters.push(onLine);
    });
  }

  function dispose() {
    socket.off('data', onData);
    socket.off('error', onError);
    socket.off('close', onClose);
  }

  return {
    dispose,
    readLine,
  };
}

async function readSmtpResponse(lineReader, timeoutMs) {
  const firstLine = await lineReader.readLine(timeoutMs);
  const match = /^(\d{3})([ -])(.*)$/.exec(firstLine || '');
  if (!match) {
    throw createMailError(
      'smtp_protocol_error',
      `Unexpected SMTP response: ${firstLine || '<empty>'}`,
    );
  }

  const code = Number.parseInt(match[1], 10);
  const lines = [firstLine];
  if (match[2] === '-') {
    while (true) {
      const nextLine = await lineReader.readLine(timeoutMs);
      lines.push(nextLine);
      if (nextLine.startsWith(`${match[1]} `)) {
        break;
      }
    }
  }

  return {
    code,
    lines,
    text: lines.join('\n'),
  };
}

async function expectSmtp(
  lineReader,
  expectedCodes,
  timeoutMs,
  contextLabel,
) {
  const response = await readSmtpResponse(lineReader, timeoutMs);
  if (!expectedCodes.includes(response.code)) {
    throw createMailError(
      'smtp_unexpected_response',
      `${contextLabel} failed (${response.code})`,
      { response: response.text },
    );
  }
  return response;
}

function smtpWrite(socket, value) {
  return new Promise((resolve, reject) => {
    socket.write(value, error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function sendSmtpCommand(
  socket,
  lineReader,
  command,
  expectedCodes,
  timeoutMs,
  contextLabel,
) {
  await smtpWrite(socket, `${command}\r\n`);
  return expectSmtp(lineReader, expectedCodes, timeoutMs, contextLabel);
}

function parseCapabilities(responseLines) {
  const capabilities = new Set();
  responseLines.forEach(line => {
    const capability = normalizeText(line.slice(4)).toUpperCase();
    if (capability.length > 0) {
      capabilities.add(capability);
    }
  });
  return capabilities;
}

function buildPlainTextMail({ from, to, subject, text }) {
  const messageIdDomain = parseFromEnvelopeAddress(from).split('@')[1] || 'localhost';
  const messageId = `<${randomBytes(12).toString('hex')}@${messageIdDomain}>`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];

  const normalizedBody = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');

  return `${headers.join('\r\n')}\r\n\r\n${normalizedBody}\r\n`;
}

async function connectSocket(config) {
  if (config.secure) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: config.host,
          port: config.port,
          rejectUnauthorized: config.rejectUnauthorized,
          servername: config.host,
        },
        () => {
          resolve(socket);
        },
      );
      socket.setEncoding('utf8');
      socket.setTimeout(config.timeoutMs);
      socket.once('error', reject);
      socket.once('timeout', () => {
        socket.destroy(
          createMailError('smtp_timeout', 'SMTP TLS connection timeout'),
        );
      });
    });
  }

  return new Promise((resolve, reject) => {
    const socket = net.connect(
      {
        host: config.host,
        port: config.port,
      },
      () => {
        resolve(socket);
      },
    );
    socket.setEncoding('utf8');
    socket.setTimeout(config.timeoutMs);
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy(createMailError('smtp_timeout', 'SMTP connection timeout'));
    });
  });
}

async function maybeUpgradeStartTls(socket, lineReader, config, capabilities) {
  if (config.secure || !config.requireStartTls) {
    return { capabilities, lineReader, socket };
  }

  const hasStartTls = Array.from(capabilities).some(cap => cap.startsWith('STARTTLS'));
  if (!hasStartTls) {
    throw createMailError(
      'smtp_starttls_not_supported',
      'SMTP server STARTTLS desteklemiyor.',
    );
  }

  await sendSmtpCommand(
    socket,
    lineReader,
    'STARTTLS',
    [220],
    config.timeoutMs,
    'STARTTLS',
  );

  const secureSocket = await new Promise((resolve, reject) => {
    const wrapped = tls.connect(
      {
        rejectUnauthorized: config.rejectUnauthorized,
        servername: config.host,
        socket,
      },
      () => resolve(wrapped),
    );
    wrapped.setEncoding('utf8');
    wrapped.setTimeout(config.timeoutMs);
    wrapped.once('error', reject);
    wrapped.once('timeout', () => {
      wrapped.destroy(createMailError('smtp_timeout', 'SMTP STARTTLS timeout'));
    });
  });

  lineReader.dispose();
  const upgradedLineReader = createLineReader(secureSocket);
  const ehloResponse = await sendSmtpCommand(
    secureSocket,
    upgradedLineReader,
    `EHLO ${config.heloName}`,
    [250],
    config.timeoutMs,
    'EHLO(after STARTTLS)',
  );

  return {
    capabilities: parseCapabilities(ehloResponse.lines),
    lineReader: upgradedLineReader,
    socket: secureSocket,
  };
}

async function maybeAuthenticate(socket, lineReader, config) {
  if (config.user.length === 0 || config.pass.length === 0) {
    return;
  }

  await sendSmtpCommand(
    socket,
    lineReader,
    'AUTH LOGIN',
    [334],
    config.timeoutMs,
    'AUTH LOGIN',
  );
  await sendSmtpCommand(
    socket,
    lineReader,
    Buffer.from(config.user, 'utf8').toString('base64'),
    [334],
    config.timeoutMs,
    'AUTH LOGIN(user)',
  );
  await sendSmtpCommand(
    socket,
    lineReader,
    Buffer.from(config.pass, 'utf8').toString('base64'),
    [235],
    config.timeoutMs,
    'AUTH LOGIN(pass)',
  );
}

async function sendViaSmtp({ config, to, subject, text }) {
  let socket = null;
  let lineReader = null;

  try {
    socket = await connectSocket(config);
    lineReader = createLineReader(socket);

    await expectSmtp(lineReader, [220], config.timeoutMs, 'SMTP greeting');
    const ehloResponse = await sendSmtpCommand(
      socket,
      lineReader,
      `EHLO ${config.heloName}`,
      [250],
      config.timeoutMs,
      'EHLO',
    );
    let capabilities = parseCapabilities(ehloResponse.lines);

    const upgraded = await maybeUpgradeStartTls(
      socket,
      lineReader,
      config,
      capabilities,
    );
    socket = upgraded.socket;
    lineReader = upgraded.lineReader;
    capabilities = upgraded.capabilities;

    await maybeAuthenticate(socket, lineReader, config, capabilities);

    await sendSmtpCommand(
      socket,
      lineReader,
      `MAIL FROM:<${config.fromEnvelope}>`,
      [250],
      config.timeoutMs,
      'MAIL FROM',
    );
    await sendSmtpCommand(
      socket,
      lineReader,
      `RCPT TO:<${to}>`,
      [250, 251],
      config.timeoutMs,
      'RCPT TO',
    );
    await sendSmtpCommand(
      socket,
      lineReader,
      'DATA',
      [354],
      config.timeoutMs,
      'DATA',
    );

    const mailData = buildPlainTextMail({
      from: config.from,
      subject,
      text,
      to,
    });
    await smtpWrite(socket, `${mailData}\r\n.\r\n`);
    await expectSmtp(lineReader, [250], config.timeoutMs, 'DATA body');
    await sendSmtpCommand(socket, lineReader, 'QUIT', [221], config.timeoutMs, 'QUIT');
  } finally {
    if (lineReader) {
      lineReader.dispose();
    }
    if (socket && !socket.destroyed) {
      socket.end();
      socket.destroy();
    }
  }
}

function ensureSmtpConfig() {
  const raw = buildMailConfig();
  if (!raw.enabled) {
    throw createMailError(
      'smtp_not_configured',
      'SMTP ayarlari eksik. Dogrulama maili gonderilemedi.',
      { missing: raw.missing },
    );
  }

  const heloName = normalizeText(process.env.SMTP_HELO_NAME) || 'macradar.local';
  return {
    ...raw,
    heloName,
  };
}

function ensureMailAddress(address, label) {
  const normalized = normalizeText(address).toLowerCase();
  if (!normalized.includes('@')) {
    throw createMailError('invalid_email', `${label} gecersiz.`);
  }
  return normalized;
}

async function sendVerificationCodeMail({ code, email, fullName, expiresAt }) {
  const config = ensureSmtpConfig();
  const to = ensureMailAddress(email, 'Hedef email');
  const subject = 'MacRadar email dogrulama kodunuz';
  const greeting = normalizeText(fullName) || 'Merhaba';
  const expiresText = normalizeText(expiresAt) || '';
  const text = [
    `${greeting},`,
    '',
    'MacRadar hesabiniz icin email dogrulama kodunuz:',
    `${code}`,
    '',
    expiresText
      ? `Kod son kullanim zamani: ${expiresText}`
      : 'Kodun gecerlilik suresi sinirlidir.',
    '',
    'Bu islemi siz yapmadiysaniz bu maili dikkate almayin.',
  ].join('\n');

  await sendViaSmtp({ config, subject, text, to });
}

async function sendPasswordResetCodeMail({ code, email, fullName, expiresAt }) {
  const config = ensureSmtpConfig();
  const to = ensureMailAddress(email, 'Hedef email');
  const subject = 'MacRadar sifre yenileme kodunuz';
  const greeting = normalizeText(fullName) || 'Merhaba';
  const expiresText = normalizeText(expiresAt) || '';
  const text = [
    `${greeting},`,
    '',
    'MacRadar sifre yenileme kodunuz:',
    `${code}`,
    '',
    expiresText
      ? `Kod son kullanim zamani: ${expiresText}`
      : 'Kodun gecerlilik suresi sinirlidir.',
    '',
    'Bu istegi siz yapmadiysaniz hesabinizi kontrol edin.',
  ].join('\n');

  await sendViaSmtp({ config, subject, text, to });
}

module.exports = {
  buildMailConfig,
  createMailError,
  sendPasswordResetCodeMail,
  sendVerificationCodeMail,
};
