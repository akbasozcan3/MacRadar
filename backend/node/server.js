const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const WebSocket = require('ws');

const { MacRadarBackend } = require('./lib/backend');
const {
  ExploreHub,
  PlayersHub,
  MessagesHub,
  NotificationsHub,
} = require('./lib/hubs');
const { searchLocationSuggestions } = require('./lib/location-search');
const { LocalStore } = require('./lib/store');
const {
  errorPayload,
  nowIso,
  readJson,
  readMultipartForm,
  sendEmpty,
  sendJson,
} = require('./lib/utils');

let PORT = Number(
  process.env.PORT || process.env.NODE_PORT || process.env.GO_PORT || 8090,
);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  console.warn(
    `[node-backend] Invalid PORT "${
      process.env.PORT || process.env.NODE_PORT || process.env.GO_PORT
    }", using default 8090`,
  );
  PORT = 8090;
}
const store = new LocalStore();
const exploreHub = new ExploreHub();
const playersHub = new PlayersHub();
const messagesHub = new MessagesHub();
const notificationsHub = new NotificationsHub();
const FASTIFY_MESSAGES_PORT = Number(
  process.env.FASTIFY_MESSAGES_PORT || (PORT === 8090 ? 8094 : 8095),
);
const backend = new MacRadarBackend(store, exploreHub, {
  adminPostHardDeleteToken: process.env.ADMIN_POST_HARD_DELETE_TOKEN || '',
  implementation: process.env.MACRADAR_IMPLEMENTATION || 'node',
  messagesHub,
  notificationsHub,
  serviceName: process.env.MACRADAR_SERVICE_NAME || 'node',
});
const buildFastifyMessagesApp = require('./fastify-messages');
const fastifyMessagesApp = buildFastifyMessagesApp(backend);
fastifyMessagesApp.listen({ port: FASTIFY_MESSAGES_PORT, host: '0.0.0.0' }, (err) => {
  if (err) console.error('[fastify] failed to start', err);
});

const I18N_EN_JSON_PATH = path.join(__dirname, '../../src/i18n/bundles/en.json');
let i18nEnglishCache = null;

function getI18nEnglishBundle() {
  if (!i18nEnglishCache) {
    const raw = fs.readFileSync(I18N_EN_JSON_PATH, 'utf8');
    const strings = JSON.parse(raw);
    const version = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    i18nEnglishCache = { strings, version };
  }
  return i18nEnglishCache;
}

const LOCATION_SEARCH_PATHS = new Set([
  '/api/v1/explore/search/places',
  '/api/v1/location/autocomplete',
  '/api/v1/location/search',
  '/api/v1/locations/autocomplete',
  '/api/v1/locations/search',
  '/api/v1/places/search',
]);

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, errorPayload('invalid_request', 'invalid request'));
      return;
    }
    if (req.method === 'OPTIONS') {
      sendEmpty(res);
      return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const path = url.pathname;
    const method = req.method;

    const shouldLogRequest = !(
      method === 'GET' && path.startsWith('/api/v1/messages/voice/files/')
    );
    if (shouldLogRequest) {
      console.log(
        JSON.stringify({ level: 'info', method, path, time: nowIso() }),
      );
    }

    if (path.startsWith('/api/v1/messages')) {
      const proxyReq = http.request({
        hostname: '127.0.0.1',
        port: FASTIFY_MESSAGES_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${FASTIFY_MESSAGES_PORT}` }
      }, proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', err => {
        sendJson(res, 502, errorPayload('bad_gateway', 'fastify backend offline'));
      });
      req.pipe(proxyReq);
      return;
    }

    // ── Health & Overview ────────────────────────────────────────────────────
    if (method === 'GET' && path === '/healthz') {
      const health = backend.health();
      if (
        health.implementation === 'node-fallback' &&
        health.service === 'go'
      ) {
        sendJson(res, 200, { data: health });
        return;
      }
      sendJson(res, 200, health);
      return;
    }
    if (method === 'GET' && path === '/api/v1/app/overview') {
      sendJson(res, 200, backend.overview());
      return;
    }
    if (method === 'GET' && path === '/api/v1/app/bootstrap') {
      sendJson(res, 200, backend.bootstrap());
      return;
    }
    if (method === 'GET' && path === '/api/v1/meta/country-calling-codes') {
      try {
        const callingCodesPath = path.join(
          __dirname,
          '..',
          'go',
          'internal',
          'meta',
          'calling_codes.json',
        );
        const raw = fs.readFileSync(callingCodesPath, 'utf8');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.writeHead(200);
        res.end(raw);
      } catch {
        sendJson(
          res,
          500,
          errorPayload('calling_codes_failed', 'Ulke kodlari yuklenemedi.'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/app/i18n') {
      const locale = (url.searchParams.get('locale') || 'en').trim().toLowerCase();
      if (locale === 'en') {
        const { strings, version } = getI18nEnglishBundle();
        sendJson(res, 200, {
          data: { locale: 'en', strings, version },
          success: true,
        });
        return;
      }
      if (locale === 'tr') {
        sendJson(res, 200, {
          data: { locale: 'tr', strings: {}, version: '0' },
          success: true,
        });
        return;
      }
      sendJson(
        res,
        400,
        errorPayload('invalid_locale', 'locale yalnizca en veya tr olabilir.'),
      );
      return;
    }
    if (method === 'GET' && path === '/api/v1/username/check') {
      const response = backend.checkUsernameAvailability(
        url.searchParams.get('username') || '',
      );
      if (response.error) {
        sendJson(res, 400, response.error);
        return;
      }
      sendJson(res, 200, response);
      return;
    }

    // Voice Service Webhook
    if (method === 'POST' && path === '/api/v1/voice/webhook') {
      try {
        const payload = await readJson(req);
        console.log('[node-backend] Voice webhook received:', payload.type);
        
        // Handle voice events from voice service
        switch (payload.type) {
          case 'voice_stream':
            // Handle real-time voice streaming
            console.log('[node-backend] Voice stream data received');
            // You can add specific logic here to handle voice streams
            sendJson(res, 200, { success: true, message: 'Voice stream processed' });
            break;
          case 'voice_upload':
            // Handle voice upload notifications
            console.log('[node-backend] Voice upload notification received');
            sendJson(res, 200, { success: true, message: 'Voice upload processed' });
            break;
          default:
            sendJson(res, 200, { success: true, message: 'Voice event processed' });
        }
        return;
      } catch (error) {
        console.error('[node-backend] Voice webhook error:', error);
        sendJson(res, 500, errorPayload('webhook_error', 'Failed to process voice webhook'));
        return;
      }
    }

    // ── Auth ─────────────────────────────────────────────────────────────────
    if (method === 'POST' && path === '/api/v1/auth/register') {
      const payload = await readJson(req);
      const response = await backend.register(payload);
      if (response.error) {
        const status =
          response.error.code === 'email_in_use'
            ? 409
            : response.error.code === 'username_taken'
            ? 409
            : response.error.code === 'account_disabled'
            ? 403
            : response.error.code === 'verification_email_failed'
            ? 503
            : 400;
        sendJson(res, status, response.error);
        return;
      }
      sendJson(res, 201, response);
      return;
    }
    if (method === 'POST' && path === '/api/v1/auth/login') {
      const payload = await readJson(req);
      const response = await backend.login(payload);
      if (response.error) {
        const status =
          response.error.code === 'email_not_verified' ||
          response.error.code === 'account_disabled'
            ? 403
            : response.error.code === 'verification_email_failed'
            ? 503
            : response.error.code === 'invalid_credentials'
            ? 401
            : 400;
        sendJson(res, status, response.error);
        return;
      }
      sendJson(res, 200, response);
      return;
    }
    if (method === 'POST' && path === '/api/v1/auth/social') {
      const payload = await readJson(req);
      const response = backend.socialLogin(payload);
      if (response.error) {
        sendJson(res, 400, response.error);
        return;
      }
      sendJson(res, 200, response);
      return;
    }
    if (method === 'POST' && path === '/api/v1/auth/logout') {
      sendJson(res, 200, backend.logout(req));
      return;
    }
    if (method === 'POST' && path === '/api/v1/auth/resend-verification') {
      const payload = await readJson(req);
      const response = await backend.resendVerification(payload);
      if (response.error) {
        const status =
          response.error.code === 'user_not_found'
            ? 404
            : response.error.code === 'verification_resend_rate_limited'
            ? 429
            : response.error.code === 'verification_email_failed'
            ? 503
            : response.error.code === 'already_verified'
            ? 409
            : 400;
        sendJson(res, status, response.error);
        return;
      }
      sendJson(res, 200, response);
      return;
    }
    if (method === 'POST' && path === '/api/v1/auth/verify-email/confirm') {
      const payload = await readJson(req);
      const response = backend.confirmVerification(payload);
      if (response.error) {
        const status =
          response.error.code === 'user_not_found'
            ? 404
            : response.error.code === 'invalid_verification_code'
            ? 400
            : 400;
        sendJson(res, status, response.error);
        return;
      }
      sendJson(res, 200, response);
      return;
    }
    if (method === 'POST' && path === '/api/v1/auth/password-reset/request') {
      const payload = await readJson(req);
      const response = await backend.requestPasswordReset(payload);
      if (response.error) {
        const status =
          response.error.code === 'password_reset_not_allowed'
            ? 404
            : response.error.code === 'password_reset_rate_limited'
            ? 429
            : response.error.code === 'password_reset_email_failed'
            ? 503
            : response.error.code === 'invalid_email'
            ? 400
            : 400;
        sendJson(res, status, response.error);
        return;
      }
      sendJson(res, 200, response);
      return;
    }
    if (method === 'POST' && path === '/api/v1/auth/password-reset/confirm') {
      const payload = await readJson(req);
      const response = backend.confirmPasswordReset(payload);
      if (response.error) {
        const status = response.error.code === 'user_not_found' ? 404 : 400;
        sendJson(res, status, response.error);
        return;
      }
      sendJson(res, 200, response);
      return;
    }

    // ── Profile ──────────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/v1/profile/me') {
      try {
        sendJson(res, 200, backend.getProfile(req));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'PATCH' && path === '/api/v1/profile/me') {
      try {
        const payload = await readJson(req);
        const response = backend.updateProfile(req, payload);
        if (response.error) {
          sendJson(res, 400, response.error);
          return;
        }
        sendJson(res, 200, response);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'DELETE' && path === '/api/v1/profile/me') {
      try {
        sendJson(res, 200, backend.deleteMyAccount(req));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (
      method === 'POST' &&
      (
        path === '/api/v1/profile/me/delete/request-code' ||
        path === '/api/v1/profile/delete/request-code' ||
        path === '/api/v1/account/delete/request-code'
      )
    ) {
      try {
        const response = await backend.requestDeleteAccountVerification(req);
        if (response.error) {
          sendJson(res, 400, response.error);
          return;
        }
        sendJson(res, 200, response);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (
      method === 'POST' &&
      (
        path === '/api/v1/profile/me/delete/confirm' ||
        path === '/api/v1/profile/delete/confirm' ||
        path === '/api/v1/account/delete/confirm'
      )
    ) {
      try {
        const payload = await readJson(req);
        const response = backend.confirmDeleteMyAccount(req, payload);
        if (response.error) {
          sendJson(res, 400, response.error);
          return;
        }
        sendJson(res, 200, response);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/help') {
      try {
        sendJson(res, 200, backend.getProfileHelp(req));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/notifications') {
      try {
        sendJson(
          res,
          200,
          backend.getNotifications(req, {
            category: url.searchParams.get('category') || 'all',
            cursor: url.searchParams.get('cursor') || '',
            limit: url.searchParams.get('limit') || '',
          }),
          {
            'Cache-Control': 'private, max-age=8, stale-while-revalidate=24',
          },
        );
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'POST' && path === '/api/v1/profile/notifications/read') {
      try {
        const payload = await readJson(req);
        sendJson(res, 200, backend.markNotificationsRead(req, payload || {}));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'POST' && path === '/api/v1/tracking/live-follow/start') {
      try {
        const payload = await readJson(req);
        const result = backend.triggerLiveFollowNotification(req, payload || {});
        if (result.error) {
          sendJson(res, 400, result.error);
          return;
        }
        sendJson(res, 200, result);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/privacy') {
      try {
        sendJson(res, 200, backend.getPrivacy(req));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'PATCH' && path === '/api/v1/profile/privacy') {
      try {
        const payload = await readJson(req);
        const response = backend.updatePrivacy(req, payload);
        if (response.error) {
          sendJson(res, 400, response.error);
          return;
        }
        sendJson(res, 200, response);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/app-settings') {
      try {
        sendJson(res, 200, backend.getAppSettings(req));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'PATCH' && path === '/api/v1/profile/app-settings') {
      try {
        const payload = await readJson(req);
        const response = backend.updateAppSettings(req, payload);
        if (response.error) {
          sendJson(res, 400, response.error);
          return;
        }
        sendJson(res, 200, response);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/request-summary') {
      try {
        sendJson(res, 200, backend.getRequestSummary(req));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/follow-requests') {
      try {
        sendJson(res, 200, backend.getFollowRequests(req), {
          'Cache-Control': 'private, max-age=20, stale-while-revalidate=60',
        });
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/followers') {
      try {
        sendJson(res, 200, backend.getFollowers(req), {
          'Cache-Control': 'private, max-age=45, stale-while-revalidate=135',
        });
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/following') {
      try {
        sendJson(res, 200, backend.getFollowing(req), {
          'Cache-Control': 'private, max-age=45, stale-while-revalidate=135',
        });
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/blocked-users') {
      try {
        sendJson(res, 200, backend.getBlockedUsers(req));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'POST' && path === '/api/v1/profile/change-password') {
      try {
        const payload = await readJson(req);
        const r = backend.changePassword(req, payload);
        if (r.error) {
          sendJson(res, 400, r.error);
          return;
        }
        sendJson(res, 200, r);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // Profile me posts
    if (method === 'GET' && path === '/api/v1/profile/me/posts') {
      try {
        sendJson(
          res,
          200,
          backend.getMyPosts(req, {
            cursor: url.searchParams.get('cursor') || '',
            limit: url.searchParams.get('limit') || '',
          }),
        );
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'POST' && path === '/api/v1/profile/me/posts') {
      try {
        const payload = await readJson(req);
        const r = backend.createMyPost(req, payload);
        if (r.error) {
          sendJson(res, 400, r.error);
          return;
        }
        sendJson(res, 201, r);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'POST' && path === '/api/v1/profile/me/post-media') {
      try {
        const form = await readMultipartForm(req, {
          maxBytes: 80 * 1024 * 1024,
        });
        const result = backend.uploadProfilePostMedia(req, form);
        if (result.error) {
          const status =
            result.error.code === 'profile_post_media_too_large' ? 413 : 400;
          sendJson(res, status, result.error);
          return;
        }
        sendJson(res, 201, result);
      } catch (error) {
        if (error?.message === 'request payload too large') {
          sendJson(
            res,
            413,
            errorPayload(
              'profile_post_media_too_large',
              'Gonderi medyasi izin verilen boyutu asiyor.',
            ),
          );
          return;
        }
        if (
          error?.message === 'invalid multipart boundary' ||
          error?.message === 'invalid multipart payload'
        ) {
          sendJson(
            res,
            400,
            errorPayload(
              'invalid_profile_post_media',
              'Medya formu cozumlenemedi.',
            ),
          );
          return;
        }
        if (error?.message === 'authorization required') {
          sendJson(
            res,
            401,
            errorPayload('unauthorized', 'authorization required'),
          );
          return;
        }
        sendJson(
          res,
          500,
          errorPayload(
            'profile_post_media_upload_failed',
            error?.message || 'server error',
          ),
        );
      }
      return;
    }
    const softDeleteMyPostMatch = path.match(
      /^\/api\/v1\/profile\/me\/posts\/([^/]+)$/,
    );
    if (softDeleteMyPostMatch && method === 'PATCH') {
      try {
        const payload = await readJson(req);
        const r = backend.updateMyPost(req, softDeleteMyPostMatch[1], payload);
        if (r.error) {
          const status =
            r.error.code === 'post_not_found'
              ? 404
              : r.error.code === 'post_edit_forbidden'
              ? 403
              : 400;
          sendJson(res, status, r.error);
          return;
        }
        sendJson(res, 200, r);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (softDeleteMyPostMatch && method === 'DELETE') {
      try {
        const r = backend.softDeleteMyPost(req, softDeleteMyPostMatch[1]);
        if (r.error) {
          const status =
            r.error.code === 'post_not_found'
              ? 404
              : r.error.code === 'post_delete_forbidden'
              ? 403
              : 400;
          sendJson(res, status, r.error);
          return;
        }
        sendJson(res, 200, r);
      } catch (error) {
        if (error?.message === 'authorization required') {
          sendJson(
            res,
            401,
            errorPayload('unauthorized', 'authorization required'),
          );
          return;
        }
        sendJson(
          res,
          500,
          errorPayload(
            'profile_post_media_read_failed',
            error?.message || 'server error',
          ),
        );
      }
      return;
    }
    const hardDeleteAdminPostMatch = path.match(
      /^\/api\/v1\/admin\/profile\/posts\/([^/]+)$/,
    );
    if (hardDeleteAdminPostMatch && method === 'DELETE') {
      try {
        const r = backend.hardDeletePostAsAdmin(
          req,
          hardDeleteAdminPostMatch[1],
        );
        if (r.error) {
          const status =
            r.error.code === 'post_not_found'
              ? 404
              : r.error.code === 'admin_hard_delete_forbidden'
              ? 403
              : 400;
          sendJson(res, status, r.error);
          return;
        }
        sendJson(res, 200, r);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/me/liked-posts') {
      try {
        sendJson(
          res,
          200,
          backend.getMyLikedPosts(req, {
            cursor: url.searchParams.get('cursor') || '',
            limit: url.searchParams.get('limit') || '',
          }),
        );
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/profile/me/saved-posts') {
      try {
        sendJson(
          res,
          200,
          backend.getMySavedPosts(req, {
            cursor: url.searchParams.get('cursor') || '',
            limit: url.searchParams.get('limit') || '',
          }),
        );
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // Follow request decisions
    const acceptRejectMatch = path.match(
      /^\/api\/v1\/profile\/follow-requests\/([^/]+)\/(accept|reject)$/,
    );
    if (acceptRejectMatch && method === 'POST') {
      try {
        const [, requesterId, action] = acceptRejectMatch;
        const r =
          action === 'accept'
            ? backend.acceptFollowRequest(req, requesterId)
            : backend.rejectFollowRequest(req, requesterId);
        sendJson(res, 200, r);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // Remove follower
    const removeFollowerMatch = path.match(
      /^\/api\/v1\/profile\/followers\/([^/]+)$/,
    );
    if (removeFollowerMatch && method === 'DELETE') {
      try {
        sendJson(res, 200, backend.removeFollower(req, removeFollowerMatch[1]));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // Block / unblock user
    const blockMatch = path.match(
      /^\/api\/v1\/profile\/blocked-users\/([^/]+)$/,
    );
    if (blockMatch && method === 'POST') {
      try {
        sendJson(res, 200, backend.blockUser(req, blockMatch[1]));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (blockMatch && method === 'DELETE') {
      try {
        sendJson(res, 200, backend.unblockUser(req, blockMatch[1]));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // Public profile + user report
    const publicProfileReportMatch = path.match(
      /^\/api\/v1\/profile\/users\/([^/]+)\/report$/,
    );
    if (publicProfileReportMatch && method === 'POST') {
      try {
        const payload = await readJson(req);
        const r = backend.reportUser(req, publicProfileReportMatch[1], payload);
        sendJson(res, r.error ? 400 : 201, r.error || r);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    const publicProfileMatch = path.match(
      /^\/api\/v1\/profile\/users\/([^/]+)$/,
    );
    if (publicProfileMatch && method === 'GET') {
      const r = backend.getPublicProfile(req, publicProfileMatch[1]);
      if (r.error) {
        sendJson(res, 404, r.error);
        return;
      }
      sendJson(res, 200, r);
      return;
    }

    // Public profile posts
    const publicProfilePostsMatch = path.match(
      /^\/api\/v1\/profile\/users\/([^/]+)\/posts$/,
    );
    if (publicProfilePostsMatch && method === 'GET') {
      sendJson(
        res,
        200,
        backend.getPublicProfilePosts(req, publicProfilePostsMatch[1], {
          cursor: url.searchParams.get('cursor') || '',
          limit: url.searchParams.get('limit') || '',
        }),
      );
      return;
    }
    const profilePostMediaMatch = path.match(
      /^\/api\/v1\/profile\/post-media\/files\/([^/]+)$/,
    );
    const profilePostThumbnailMatch = path.match(
      /^\/api\/v1\/profile\/post-media\/files\/([^/]+)\/thumbnail$/,
    );
    if (
      (profilePostMediaMatch || profilePostThumbnailMatch) &&
      method === 'GET'
    ) {
      try {
        const mediaId = profilePostMediaMatch
          ? profilePostMediaMatch[1]
          : profilePostThumbnailMatch[1];
        const result = backend.getProfilePostMediaFileForUser(
          req,
          mediaId,
          profilePostThumbnailMatch ? 'thumbnail' : 'media',
        );
        if (result.error) {
          const status =
            result.error.code === 'profile_post_media_not_found'
              ? 404
              : result.error.code === 'profile_post_media_forbidden'
              ? 403
              : 400;
          sendJson(res, status, result.error);
          return;
        }

        if (result.inlineBuffer && Buffer.isBuffer(result.inlineBuffer)) {
          res.writeHead(200, {
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods':
              'GET, POST, PATCH, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'private, max-age=86400',
            'Content-Length': result.inlineBuffer.length,
            'Content-Type': result.mimeType || 'image/jpeg',
          });
          res.end(result.inlineBuffer);
          return;
        }

        const file = result.file;
        if (!file || !fs.existsSync(file.absolutePath)) {
          sendJson(
            res,
            404,
            errorPayload(
              'profile_post_media_not_found',
              'Gonderi medyasi bulunamadi.',
            ),
          );
          return;
        }
        const stats = fs.statSync(file.absolutePath);
        res.writeHead(200, {
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods':
            'GET, POST, PATCH, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'private, max-age=86400',
          'Content-Length': stats.size,
          'Content-Type': file.mimeType || 'application/octet-stream',
        });
        const readStream = fs.createReadStream(file.absolutePath);
        readStream.on('error', () => {
          if (!res.headersSent) {
            sendJson(
              res,
              500,
              errorPayload(
                'profile_post_media_read_failed',
                'Medya dosyasi okunamadi.',
              ),
            );
          } else {
            res.end();
          }
        });
        readStream.pipe(res);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // ── Map preferences ───────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/v1/map/preferences') {
      try {
        sendJson(res, 200, backend.getMapPreferences(req));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'PATCH' && path === '/api/v1/map/preferences') {
      try {
        const payload = await readJson(req);
        sendJson(res, 200, backend.updateMapPreferences(req, payload));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'POST' && path === '/api/v1/map/preferences') {
      try {
        const payload = await readJson(req);
        sendJson(res, 200, backend.updateMapPreferences(req, payload));
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // ── Explore ──────────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/v1/explore/feed') {
      const segment = url.searchParams.get('segment') || 'kesfet';
      sendJson(
        res,
        200,
        backend.feed(req, segment, {
          cursor: url.searchParams.get('cursor') || '',
          limit: url.searchParams.get('limit') || '',
        }),
        { 'Cache-Control': 'private, max-age=20, stale-while-revalidate=60' },
      );
      return;
    }
    if (method === 'GET' && path === '/api/v1/explore/search/users') {
      const r = backend.searchUsers(req, url.searchParams.get('q') || '', {
        cursor: url.searchParams.get('cursor') || '',
        limit: Number(url.searchParams.get('limit') || 20),
      });
      sendJson(res, 200, r, {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=90',
      });
      return;
    }
    if (method === 'GET' && path === '/api/v1/explore/search/posts') {
      const r = backend.searchPosts(req, url.searchParams.get('q') || '', {
        cursor: url.searchParams.get('cursor') || '',
        filter: url.searchParams.get('mediaType') || 'all',
        limit: Number(url.searchParams.get('limit') || 20),
        sort: url.searchParams.get('sort') || 'relevant',
      });
      sendJson(res, 200, r, {
        'Cache-Control': 'private, max-age=45, stale-while-revalidate=135',
      });
      return;
    }
    if (method === 'GET' && LOCATION_SEARCH_PATHS.has(path)) {
      const results = await searchLocationSuggestions(url.searchParams.get('q') || '', {
        country: url.searchParams.get('country') || 'tr',
        language: url.searchParams.get('language') || 'tr',
        limit: Number(url.searchParams.get('limit') || 6),
      });
      sendJson(
        res,
        200,
        { results },
        { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=180' },
      );
      return;
    }
    if (method === 'GET' && path === '/api/v1/explore/search/trending-tags') {
      let r;
      try {
        r = backend.searchTrendingTags(
          req,
          {
            limit: Number(url.searchParams.get('limit') || 12),
            query: url.searchParams.get('q') || '',
          },
        );
      } catch {
        r = { tags: [] };
      }
      sendJson(res, 200, r, {
        'Cache-Control': 'private, max-age=45, stale-while-revalidate=135',
      });
      return;
    }
    const tagDetailMatch = path.match(/^\/api\/v1\/explore\/tags\/([^/]+)$/);
    if (tagDetailMatch && method === 'GET') {
      const r = backend.getTagDetail(req, decodeURIComponent(tagDetailMatch[1]), {
        cursor: url.searchParams.get('cursor') || '',
        limit: Number(url.searchParams.get('limit') || 18),
      });
      if (r?.error) {
        const status = r.error.code === 'invalid_tag' ? 400 : 400;
        sendJson(res, status, r.error);
        return;
      }
      sendJson(res, 200, r);
      return;
    }
    if (method === 'GET' && path === '/api/v1/explore/friends') {
      try {
        sendJson(res, 200, backend.getStreetFriends(req), {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=90',
        });
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'GET' && path === '/api/v1/explore/street-friend-requests') {
      try {
        sendJson(res, 200, backend.getStreetFriendRequests(req), {
          'Cache-Control': 'private, max-age=20, stale-while-revalidate=60',
        });
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // Explore posts: comments + reactions
    const commentsMatch = path.match(
      /^\/api\/v1\/explore\/posts\/([^/]+)\/comments$/,
    );
    if (commentsMatch && method === 'GET') {
      sendJson(res, 200, backend.comments(req, commentsMatch[1]));
      return;
    }
    if (commentsMatch && method === 'POST') {
      const payload = await readJson(req);
      const r = backend.addComment(req, commentsMatch[1], payload);
      sendJson(res, r.error ? 400 : 201, r.error || r);
      return;
    }

    const commentLikeMatch = path.match(
      /^\/api\/v1\/explore\/comments\/([^/]+)\/like$/,
    );
    if (commentLikeMatch && method === 'POST') {
      const r = backend.toggleCommentLike(req, commentLikeMatch[1]);
      sendJson(res, r.error ? (r.error.status || 400) : 200, r.error || r);
      return;
    }

    const reactionsMatch = path.match(
      /^\/api\/v1\/explore\/posts\/([^/]+)\/reactions$/,
    );
    if (reactionsMatch && method === 'POST') {
      const payload = await readJson(req);
      const r = backend.react(req, reactionsMatch[1], payload);
      sendJson(res, r.error ? 400 : 200, r.error || r);
      return;
    }

    const reportMatch = path.match(
      /^\/api\/v1\/explore\/posts\/([^/]+)\/report$/,
    );
    if (reportMatch && method === 'POST') {
      const payload = await readJson(req);
      const r = backend.reportPost(req, reportMatch[1], payload);
      sendJson(res, r.error ? 400 : 201, r.error || r);
      return;
    }

    // Follow creator
    const followMatch = path.match(
      /^\/api\/v1\/explore\/creators\/([^/]+)\/follow$/,
    );
    if (followMatch && method === 'POST') {
      sendJson(res, 200, backend.follow(req, followMatch[1]));
      return;
    }

    // Street friend upsert
    const streetFriendMatch = path.match(
      /^\/api\/v1\/explore\/creators\/([^/]+)\/street-friend$/,
    );
    if (streetFriendMatch && method === 'POST') {
      try {
        sendJson(
          res,
          200,
          backend.upsertStreetFriend(req, streetFriendMatch[1]),
        );
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // Remove street friend
    const removeFriendMatch = path.match(
      /^\/api\/v1\/explore\/friends\/([^/]+)$/,
    );
    if (removeFriendMatch && method === 'DELETE') {
      try {
        sendJson(
          res,
          200,
          backend.removeStreetFriend(req, removeFriendMatch[1]),
        );
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    // ── Messages ──────────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/v1/messages/conversations') {
      try {
        sendJson(
          res,
          200,
          backend.fetchConversations(req, {
            cursor: url.searchParams.get('cursor') || '',
            limit: url.searchParams.get('limit') || '',
            search: url.searchParams.get('q') || '',
            unreadOnly: url.searchParams.get('unread') === 'true',
          }),
        );
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (method === 'POST' && path === '/api/v1/messages/conversations') {
      try {
        const payload = await readJson(req);
        const r = backend.createConversation(req, payload);
        if (r.error) {
          sendJson(res, 400, r.error);
          return;
        }
        sendJson(res, 201, r);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    if (method === 'POST' && path === '/api/v1/messages/voice/upload') {
      try {
        const payload = await readJson(req);
        const result = backend.uploadVoiceMessage(req, payload);
        if (result.error) {
          const status =
            result.error.code === 'conversation_not_found'
              ? 404
              : result.error.code === 'voice_payload_too_large'
              ? 413
              : 400;
          sendJson(res, status, result.error);
          return;
        }
        sendJson(res, 201, result);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    const voiceFileMatch = path.match(
      /^\/api\/v1\/messages\/voice\/files\/([^/]+)$/,
    );
    if (voiceFileMatch && method === 'GET') {
      try {
        const result = backend.getVoiceMessageFileForUser(
          req,
          voiceFileMatch[1],
        );
        if (result.error) {
          const status =
            result.error.code === 'voice_access_forbidden'
              ? 403
              : result.error.code === 'voice_not_found'
              ? 404
              : 400;
          sendJson(res, status, result.error);
          return;
        }

        const file = result.file;
        if (!file || !fs.existsSync(file.absolutePath)) {
          sendJson(
            res,
            404,
            errorPayload('voice_not_found', 'Ses dosyasi bulunamadi.'),
          );
          return;
        }
        const stats = fs.statSync(file.absolutePath);
        const safeFileName = String(file.fileName || 'voice-message.m4a')
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 128);
        const baseHeaders = {
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods':
            'GET, POST, PATCH, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=86400',
          'Content-Disposition': `inline; filename="${safeFileName}"`,
          'Content-Type': file.mimeType || 'audio/mp4',
        };
        let readStream = null;
        const rangeHeader =
          typeof req.headers.range === 'string' ? req.headers.range.trim() : '';
        const rangeMatch = rangeHeader.match(/^bytes=(\\d*)-(\\d*)$/);
        if (rangeMatch) {
          const parsedStart = Number.parseInt(rangeMatch[1], 10);
          const parsedEnd = Number.parseInt(rangeMatch[2], 10);
          const start = Number.isFinite(parsedStart) ? parsedStart : 0;
          const end = Number.isFinite(parsedEnd)
            ? Math.min(parsedEnd, stats.size - 1)
            : stats.size - 1;
          if (start <= end && start >= 0 && end < stats.size) {
            res.writeHead(206, {
              ...baseHeaders,
              'Content-Length': end - start + 1,
              'Content-Range': `bytes ${start}-${end}/${stats.size}`,
            });
            readStream = fs.createReadStream(file.absolutePath, { end, start });
          } else {
            res.writeHead(416, {
              ...baseHeaders,
              'Content-Range': `bytes */${stats.size}`,
            });
            res.end();
            return;
          }
        } else {
          res.writeHead(200, {
            ...baseHeaders,
            'Content-Length': stats.size,
          });
          readStream = fs.createReadStream(file.absolutePath);
        }
        readStream.on('error', () => {
          if (!res.headersSent) {
            sendJson(
              res,
              500,
              errorPayload('voice_stream_error', 'Ses dosyasi okunamadi.'),
            );
          } else {
            res.end();
          }
        });
        readStream.pipe(res);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    const conversationMessagesMatch = path.match(
      /^\/api\/v1\/messages\/conversations\/([^/]+)\/messages$/,
    );
    if (conversationMessagesMatch && method === 'GET') {
      try {
        const result = backend.fetchConversationMessages(
          req,
          conversationMessagesMatch[1],
          {
            cursor: url.searchParams.get('cursor') || '',
            limit: url.searchParams.get('limit') || '',
          },
        );
        if (result.error) {
          const status =
            result.error.code === 'conversation_not_found' ? 404 : 400;
          sendJson(res, status, result.error);
          return;
        }
        sendJson(res, 200, result);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }
    if (conversationMessagesMatch && method === 'POST') {
      try {
        const payload = await readJson(req);
        const r = backend.sendConversationMessage(
          req,
          conversationMessagesMatch[1],
          payload,
        );
        if (r.error) {
          sendJson(res, 400, r.error);
          return;
        }
        sendJson(res, 201, r);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    const markReadMatch = path.match(
      /^\/api\/v1\/messages\/conversations\/([^/]+)\/read$/,
    );
    if (markReadMatch && method === 'POST') {
      try {
        const payload = await readJson(req);
        const result = backend.markConversationRead(
          req,
          markReadMatch[1],
          payload,
        );
        if (result.error) {
          const status =
            result.error.code === 'conversation_not_found' ? 404 : 400;
          sendJson(res, status, result.error);
          return;
        }
        sendJson(res, 200, result);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    const conversationMuteMatch = path.match(
      /^\/api\/v1\/messages\/conversations\/([^/]+)\/mute$/,
    );
    if (conversationMuteMatch && method === 'PATCH') {
      try {
        const payload = await readJson(req);
        const result = backend.setConversationMuted(
          req,
          conversationMuteMatch[1],
          payload,
        );
        if (result.error) {
          const status =
            result.error.code === 'conversation_not_found' ? 404 : 400;
          sendJson(res, status, result.error);
          return;
        }
        sendJson(res, 200, result);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    const conversationClearMatch = path.match(
      /^\/api\/v1\/messages\/conversations\/([^/]+)\/clear$/,
    );
    if (conversationClearMatch && method === 'POST') {
      try {
        const result = backend.clearConversationMessages(
          req,
          conversationClearMatch[1],
        );
        if (result.error) {
          const status =
            result.error.code === 'conversation_not_found' ? 404 : 400;
          sendJson(res, status, result.error);
          return;
        }
        sendJson(res, 200, result);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    const conversationHardDeleteMatch = path.match(
      /^\/api\/v1\/messages\/conversations\/([^/]+)\/hard$/,
    );
    if (conversationHardDeleteMatch && method === 'DELETE') {
      try {
        const result = backend.hardDeleteConversationForAll(
          req,
          conversationHardDeleteMatch[1],
        );
        if (result.error) {
          const status =
            result.error.code === 'conversation_not_found' ? 404 : 400;
          sendJson(res, status, result.error);
          return;
        }
        sendJson(res, 200, result);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    const conversationDeleteMatch = path.match(
      /^\/api\/v1\/messages\/conversations\/([^/]+)$/,
    );
    if (conversationDeleteMatch && method === 'DELETE') {
      try {
        const result = backend.deleteConversationForUser(
          req,
          conversationDeleteMatch[1],
        );
        if (result.error) {
          const status =
            result.error.code === 'conversation_not_found' ? 404 : 400;
          sendJson(res, status, result.error);
          return;
        }
        sendJson(res, 200, result);
      } catch {
        sendJson(
          res,
          401,
          errorPayload('unauthorized', 'authorization required'),
        );
      }
      return;
    }

    sendJson(res, 404, errorPayload('not_found', 'route not found'));
  } catch (error) {
    if (error?.message === 'invalid json payload') {
      sendJson(
        res,
        400,
        errorPayload('invalid_json', 'Gecersiz JSON istek govdesi.'),
      );
      return;
    }
    if (error?.message === 'request payload too large') {
      sendJson(
        res,
        413,
        errorPayload('payload_too_large', 'Istek govdesi cok buyuk.'),
      );
      return;
    }
    sendJson(
      res,
      500,
      errorPayload('server_error', error.message || 'server error'),
    );
  }
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const websocketServer = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const allowed = [
    '/ws/explore',
    '/ws/players',
    '/ws/messages',
    '/ws/notifications',
  ];
  if (!allowed.includes(url.pathname)) {
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(req, socket, head, client => {
    websocketServer.emit('connection', client, req);
  });
});

websocketServer.on('connection', (client, req) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/ws/explore') {
    exploreHub.add(client);
    client.send(JSON.stringify({ serverTime: nowIso(), type: 'welcome' }));
    client.on('close', () => exploreHub.remove(client));
    return;
  }

  if (url.pathname === '/ws/players') {
    const roomId = url.searchParams.get('room') || 'global';
    const playerId = url.searchParams.get('player') || 'guest';
    playersHub.join(roomId, playerId, client);
    client.on('message', raw => {
      try {
        playersHub.update(client, JSON.parse(String(raw)));
      } catch {}
    });
    client.on('close', () => playersHub.leave(client));
    return;
  }

  if (url.pathname === '/ws/messages') {
    const userId = backend.optionalUser(req)?.id || '';
    if (!userId) {
      client.close(4001, 'authorization required');
      return;
    }
    messagesHub.join(userId, client);
    client.send(JSON.stringify({ serverTime: nowIso(), type: 'welcome' }));
    client.on('message', raw => {
      try {
        const payload = JSON.parse(String(raw));
        if (payload?.type === 'heartbeat') {
          client.send(JSON.stringify({ serverTime: nowIso(), type: 'heartbeat' }));
          return;
        }
        if (payload?.type === 'typing') {
          backend.forwardTypingEvent(userId, payload);
        }
      } catch {}
    });
    client.on('close', () => messagesHub.leave(userId, client));
    return;
  }

  if (url.pathname === '/ws/notifications') {
    const userId = backend.optionalUser(req)?.id || '';
    if (!userId) {
      client.close(4001, 'authorization required');
      return;
    }
    notificationsHub.join(userId, client);
    client.send(JSON.stringify({ serverTime: nowIso(), type: 'welcome' }));
    client.on('message', raw => {
      try {
        const payload = JSON.parse(String(raw));
        if (payload?.type === 'heartbeat') {
          client.send(JSON.stringify({ serverTime: nowIso(), type: 'heartbeat' }));
        }
      } catch {}
    });
    client.on('close', () => notificationsHub.leave(userId, client));
  }
});

function handleListenError(error) {
  if (error?.code === 'EADDRINUSE') {
    console.error(
      `[node-backend] Port ${PORT} is already in use. Stop the process using this port or set PORT/NODE_PORT to another free value.`,
    );
    process.exit(1);
  }

  if (error?.code === 'EACCES') {
    console.error(
      `[node-backend] Permission denied when binding port ${PORT}. Check OS permissions and firewall/network restrictions.`,
    );
    process.exit(1);
  }

  console.error(
    `[node-backend] Failed to start server on port ${PORT}: ${
      error?.message || error
    }`,
  );
  process.exit(1);
}

server.on('error', handleListenError);

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'macradar node backend listening',
      port: PORT,
      time: nowIso(),
    }),
  );
});
