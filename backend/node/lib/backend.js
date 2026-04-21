const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const {
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
  slugifyUsername,
  verifyPassword,
} = require('./utils');
const {
  buildMailConfig,
  sendPasswordResetCodeMail,
  sendVerificationCodeMail,
} = require('./mailer');
const {
  enrichConversationMessage,
  enrichConversationSummary,
} = require('./message-content');

const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 12;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20;
const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const DELETE_ACCOUNT_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_CODE_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;
/** Slate-toned JPEG when a video has no uploaded thumbnail (avoids 404 on /thumbnail). */
const PROFILE_VIDEO_THUMB_PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCABAAEADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64',
);

const MAX_VOICE_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_DURATION_SEC = 180;
const MIN_VOICE_DURATION_SEC = 1;
const MAX_PROFILE_PHOTO_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_PROFILE_VIDEO_UPLOAD_BYTES = 80 * 1024 * 1024;
const MAX_PROFILE_VIDEO_THUMBNAIL_BYTES = 6 * 1024 * 1024;
const MAX_PROFILE_POST_CAPTION_LENGTH = 280;
const MAX_PROFILE_POST_HASHTAG_COUNT = 8;
const MAX_PROFILE_POST_LOCATION_LENGTH = 120;
const VOICE_STORAGE_DIR = path.join(
  __dirname,
  '..',
  '..',
  'storage',
  'voice',
  'messages',
);
const POST_MEDIA_STORAGE_DIR = path.join(
  __dirname,
  '..',
  '..',
  'storage',
  'profile-post-media',
);
const CHAT_REQUEST_STATUSES = new Set([
  'pending',
  'accepted',
  'rejected',
  'blocked',
]);
const LIVE_FOLLOW_NOTIFICATION_COOLDOWN_MS = 30_000;
const MAX_STORED_NOTIFICATIONS = 600;
const NOTIFICATION_BATCH_SIZE = 50;

function buildDefaultAppSettings(userId = '', updatedAt = nowIso()) {
  return {
    gender: 'prefer_not_to_say',
    language: 'tr',
    notifyFollowRequests: true,
    notifyMessages: true,
    notifyPostLikes: true,
    onlyFollowedUsersCanMessage: false,
    updatedAt,
    userId,
  };
}

function normalizeDiscoverSearchValue(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^[@#]+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractProfilePostHashtags(caption) {
  const text = normalizeText(caption, '');
  const pattern = /#([\p{L}\p{N}_]{2,32})/gu;
  const seen = new Set();
  const values = [];

  let match = pattern.exec(text);
  while (match) {
    const tag = normalizeDiscoverSearchValue(match[1]);
    if (tag.length >= 2 && !seen.has(tag)) {
      seen.add(tag);
      values.push(tag);
    }
    match = pattern.exec(text);
  }

  return values;
}

class MacRadarBackend {
  constructor(store, exploreHub, options = {}) {
    this.store = store;
    this.exploreHub = exploreHub;
    this.messagesHub = options.messagesHub || null;
    this.notificationsHub = options.notificationsHub || null;
    this.adminPostHardDeleteToken =
      typeof options.adminPostHardDeleteToken === 'string'
        ? options.adminPostHardDeleteToken.trim()
        : '';
    this.serviceName =
      typeof options.serviceName === 'string' &&
      options.serviceName.trim().length > 0
        ? options.serviceName.trim()
        : 'node';
    this.implementation =
      typeof options.implementation === 'string' &&
      options.implementation.trim().length > 0
        ? options.implementation.trim()
        : 'node';

    const state = this.store.getState();
    if (state && this.normalizeStoredNotifications(state)) {
      this.store.save();
    }
  }

  health() {
    return {
      implementation: this.implementation,
      service: this.serviceName,
      status: 'ok',
    };
  }

  bootstrap() {
    return {
      implementation: this.implementation,
      serverTime: new Date().toISOString(),
      service: this.serviceName,
      status: 'ok',
      version: 'launch-bootstrap-v1',
    };
  }

  overview() {
    const state = this.store.getState();
    return {
      activePostsCount: state.posts.filter(p => p.isLive).length,
      membersCount: state.users.length,
      routesCount: state.posts.length,
    };
  }

  // â”€â”€â”€ Session helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getSession(token) {
    const state = this.store.getState();
    return state.sessions.find(
      s => s.token === token && new Date(s.expiresAt) > new Date(),
    );
  }

  optionalUser(req) {
    const token = getBearerToken(req);
    if (!token) return null;
    const session = this.getSession(token);
    if (!session) return null;
    return (
      this.store.getState().users.find(u => u.id === session.userId) || null
    );
  }

  requireUser(req) {
    const user = this.optionalUser(req);
    if (!user) throw new Error('authorization required');
    return user;
  }

  createSession(userId, provider) {
    const session = {
      createdAt: nowIso(),
      expiresAt: expiresIn(30),
      provider,
      token: createToken(),
      userId,
    };
    this.store.getState().sessions.push(session);
    this.store.save();
    return { expiresAt: session.expiresAt, token: session.token };
  }

  uniqueUsername(candidate) {
    return this.uniqueUsernameFor(candidate);
  }

  uniqueUsernameFor(candidate, excludedUserId = '') {
    const state = this.store.getState();
    const normalizedCandidate = this.sanitizeUsernameInput(candidate);
    const base =
      normalizedCandidate.length > 0
        ? normalizedCandidate
        : slugifyUsername(candidate);
    let username = base;
    let counter = 2;
    while (
      state.users.some(
        u =>
          u.id !== excludedUserId &&
          u.username.toLowerCase() === username.toLowerCase(),
      )
    ) {
      username = `${base}${counter}`;
      counter += 1;
    }
    return username;
  }

  isUsernameTaken(username, excludedUserId = '') {
    const normalizedUsername = this.sanitizeUsernameInput(username);
    if (!normalizedUsername) {
      return false;
    }
    const normalizedExcludedId = normalizeText(excludedUserId, '');
    return this.store.getState().users.some(
      user =>
        normalizeText(user.id, '') !== normalizedExcludedId &&
        normalizeText(user.username, '').toLowerCase() === normalizedUsername.toLowerCase(),
    );
  }

  normalizePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    return payload;
  }

  isAuthDebugPreviewEnabled() {
    const raw = String(process.env.AUTH_DEBUG_PREVIEW ?? 'false')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  isSmtpConfigured() {
    return buildMailConfig().enabled;
  }

  async sendVerificationCodeOrFallback({ code, email, expiresAt, fullName }) {
    try {
      await sendVerificationCodeMail({ code, email, expiresAt, fullName });
      return {
        mode: 'email',
      };
    } catch (error) {
      if (!this.isAuthDebugPreviewEnabled()) {
        return {
          error,
          mode: 'failed',
        };
      }
      return {
        error,
        mode: 'debug',
      };
    }
  }

  async sendPasswordResetCodeOrFallback({ code, email, expiresAt, fullName }) {
    try {
      await sendPasswordResetCodeMail({ code, email, expiresAt, fullName });
      return {
        mode: 'email',
      };
    } catch (error) {
      if (!this.isAuthDebugPreviewEnabled()) {
        return {
          error,
          mode: 'failed',
        };
      }
      return {
        error,
        mode: 'debug',
      };
    }
  }

  verificationDeliveryMessage(email, mode) {
    if (mode === 'email') {
      return `Dogrulama kodu ${email} adresine gonderildi.`;
    }
    if (mode === 'debug') {
      return 'SMTP uzerinden mail gonderilemedi. Test kodu ile devam edebilirsiniz.';
    }
    return 'Dogrulama kodu gonderilemedi.';
  }

  passwordResetDeliveryMessage(email, mode, hasLocalPassword) {
    if (mode === 'email') {
      return hasLocalPassword
        ? `Şifre sıfırlama kodu ${email} adresine gönderildi.`
        : `Bu hesapta sifre yok. Kod dogrulaninca ${email} icin yeni sifre olusturulacak.`;
    }
    if (mode === 'debug') {
      return hasLocalPassword
        ? 'SMTP üzerinden şifre sıfırlama maili gönderilemedi. Test kodu ile devam edebilirsiniz.'
        : 'SMTP uzerinden mail gonderilemedi. Test kodu ile yeni sifre olusturabilirsiniz.';
    }
    return 'Şifre sıfırlama kodu gönderilemedi.';
  }

  isPasswordLengthValid(password) {
    const length = normalizeText(password).length;
    return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH;
  }

  sanitizeUsernameInput(value) {
    const normalized = this.normalizeUsernameCandidate(value)
      .replace(/[^a-z0-9_]/g, '');

    return normalized.slice(0, USERNAME_MAX_LENGTH);
  }

  normalizeUsernameCandidate(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0131/g, 'i')
      .replace(/\u0130/g, 'i')
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  validateRegisterUsername(value) {
    const candidate = this.normalizeUsernameCandidate(value);
    if (candidate.length === 0) {
      return {
        error: errorPayload('invalid_username', 'Kullanici adi zorunlu.', {
          reason: 'required',
        }),
      };
    }
    if (candidate.length < USERNAME_MIN_LENGTH) {
      return {
        error: errorPayload(
          'invalid_username',
          `Kullanici adi en az ${USERNAME_MIN_LENGTH} karakter olmali.`,
          { reason: 'too_short' },
        ),
      };
    }
    if (candidate.length > USERNAME_MAX_LENGTH) {
      return {
        error: errorPayload(
          'invalid_username',
          `Kullanici adi en fazla ${USERNAME_MAX_LENGTH} karakter olabilir.`,
          { reason: 'too_long' },
        ),
      };
    }
    const username = this.sanitizeUsernameInput(value);
    if (username !== candidate) {
      return {
        error: errorPayload(
          'invalid_username',
          'Kullanici adinda sadece kucuk harf, rakam ve underscore kullanin.',
          { reason: 'invalid_format' },
        ),
      };
    }
    if (!/^[a-z0-9_]+$/.test(username)) {
      return {
        error: errorPayload(
          'invalid_username',
          'Kullanici adinda sadece kucuk harf, rakam ve underscore kullanin.',
          { reason: 'invalid_format' },
        ),
      };
    }

    return { username };
  }

  checkUsernameAvailability(value) {
    const validation = this.validateRegisterUsername(value);
    if (validation.error) {
      return { error: validation.error };
    }
    return {
      available: !this.isUsernameTaken(validation.username),
    };
  }

  getUserStatus(user) {
    if (
      user &&
      typeof user.status === 'string' &&
      user.status.trim().length > 0
    ) {
      return user.status;
    }
    return user?.isVerified === false ? 'pending_verification' : 'active';
  }

  isUserDisabled(user) {
    return this.getUserStatus(user) === 'disabled';
  }

  isUserVerified(user) {
    if (!user) {
      return false;
    }
    if (this.isUserDisabled(user)) {
      return false;
    }
    if (typeof user.isVerified === 'boolean') {
      return user.isVerified;
    }
    return this.getUserStatus(user) !== 'pending_verification';
  }

  sanitizeVerificationStore(state) {
    const now = Date.now();
    state.verificationCodes = state.verificationCodes.filter(entry => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      if (entry.used === true) {
        return false;
      }
      const expiresAtMs = new Date(entry.expiresAt || '').getTime();
      return Number.isFinite(expiresAtMs) && expiresAtMs > now;
    });
  }

  findLatestVerificationCode(state, email, reasons = null) {
    const normalizedEmail = normalizeEmail(email);
    const allowedReasons = Array.isArray(reasons)
      ? new Set(reasons.map(reason => normalizeText(reason, '')))
      : null;
    let latest = null;
    for (const entry of state.verificationCodes) {
      if (normalizeEmail(entry.email) !== normalizedEmail) {
        continue;
      }
      if (
        allowedReasons &&
        !allowedReasons.has(normalizeText(entry.reason, ''))
      ) {
        continue;
      }
      if (!latest) {
        latest = entry;
        continue;
      }
      const currentCreatedAt = new Date(entry.createdAt || 0).getTime();
      const latestCreatedAt = new Date(latest.createdAt || 0).getTime();
      if (currentCreatedAt > latestCreatedAt) {
        latest = entry;
      }
    }
    return latest;
  }

  issueVerificationCode(state, email, reason = 'register') {
    this.sanitizeVerificationStore(state);
    const normalizedEmail = normalizeEmail(email);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const createdAt = nowIso();
    const expiresAt = new Date(
      Date.now() + VERIFICATION_CODE_TTL_MS,
    ).toISOString();
    const resendAvailableAt = new Date(
      Date.now() + VERIFICATION_RESEND_COOLDOWN_MS,
    ).toISOString();
    const entry = {
      attempts: 0,
      code,
      createdAt,
      email: normalizedEmail,
      expiresAt,
      id: createId('vcode'),
      reason,
      resendAvailableAt,
      used: false,
    };
    state.verificationCodes = state.verificationCodes.filter(
      item => normalizeEmail(item.email) !== normalizedEmail,
    );
    state.verificationCodes.push(entry);
    return entry;
  }

  toVerificationChallenge(user, codeEntry, message, deliveryMode = 'email') {
    const includeDebugCode =
      this.isAuthDebugPreviewEnabled() &&
      normalizeText(deliveryMode) === 'debug';
    return {
      debugCode: includeDebugCode ? codeEntry.code : undefined,
      email: normalizeEmail(user.email),
      expiresAt: codeEntry.expiresAt,
      message,
      resendAvailableAt: codeEntry.resendAvailableAt,
      status: this.getUserStatus(user),
    };
  }

  // â”€â”€â”€ Profile shape helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getPrivacyFor(userId) {
    const state = this.store.getState();
    return (
      state.privacySettings.find(p => p.userId === userId) || {
        isMapVisible: true,
        isPrivateAccount: false,
        updatedAt: nowIso(),
        userId,
      }
    );
  }

  getStreetFriendCountFor(userId) {
    const state = this.store.getState();
    return state.streetFriends.filter(
      sf =>
        sf.status === 'accepted' &&
        (sf.userId1 === userId || sf.userId2 === userId),
    ).length;
  }

  profileFor(user, viewerId = user.id) {
    const state = this.store.getState();
    const privacy = this.getPrivacyFor(user.id);
    return {
      authProvider: user.authProvider,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      birthYear: user.birthYear || 0,
      city: user.city,
      createdAt: user.createdAt,
      email: user.email,
      phone: typeof user.phone === 'string' ? user.phone : '',
      phoneDialCode:
        typeof user.phoneDialCode === 'string' ? user.phoneDialCode : '90',
      favoriteCar: '',
      fullName: user.fullName,
      hasPassword: Boolean(
        user.passwordHash && user.passwordHash.includes(':'),
      ),
      heroTagline: '',
      id: user.id,
      isEmailVerified: this.isUserVerified(user),
      isVerified: this.isUserVerified(user),
      lastLoginAt: user.lastLoginAt,
      privacy: {
        isMapVisible: privacy.isMapVisible,
        isPrivateAccount: privacy.isPrivateAccount,
      },
      stats: {
        followersCount: state.follows.filter(f => f.followedUserId === user.id)
          .length,
        followingCount: state.follows.filter(f => f.followerId === user.id)
          .length,
        routesCount: state.profilePosts.filter(p => p.userId === user.id)
          .length,
        streetFriendsCount: this.getStreetFriendCountFor(user.id),
      },
      status: this.getUserStatus(user),
      username: user.username,
    };
  }

  publicProfileFor(user, viewerId) {
    const state = this.store.getState();
    const privacy = this.getPrivacyFor(user.id);
    const isFollowing = state.follows.some(
      f => f.followerId === viewerId && f.followedUserId === user.id,
    );
    const followsYou = state.follows.some(
      f => f.followerId === user.id && f.followedUserId === viewerId,
    );
    const isBlockedByViewer = state.blockedUsers.some(
      b => b.blockerId === viewerId && b.blockedId === user.id,
    );
    const isBlockedByTarget = state.blockedUsers.some(
      b => b.blockerId === user.id && b.blockedId === viewerId,
    );
    const pendingOutgoing = state.followRequests.some(
      r =>
        r.requesterId === viewerId &&
        r.targetId === user.id &&
        r.status === 'pending',
    );
    const pendingIncoming = state.followRequests.some(
      r =>
        r.requesterId === user.id &&
        r.targetId === viewerId &&
        r.status === 'pending',
    );
    let followRequestStatus = 'none';
    if (pendingOutgoing) followRequestStatus = 'pending_outgoing';
    else if (pendingIncoming) followRequestStatus = 'pending_incoming';

    return {
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      birthYear: user.birthYear || 0,
      fullName: user.fullName,
      id: user.id,
      isPrivateAccount: privacy.isPrivateAccount,
      isVerified: user.isVerified,
      stats: {
        followersCount: state.follows.filter(f => f.followedUserId === user.id)
          .length,
        followingCount: state.follows.filter(f => f.followerId === user.id)
          .length,
        routesCount: state.profilePosts.filter(p => p.userId === user.id)
          .length,
        streetFriendsCount: this.getStreetFriendCountFor(user.id),
      },
      username: user.username,
      viewerState: {
        followRequestStatus,
        followsYou,
        isBlockedByTarget,
        isBlockedByViewer,
        isFollowing,
      },
    };
  }

  // â”€â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async register(payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const email = normalizeEmail(input.email);
    const fullName = normalizeText(input.fullName);
    const password = normalizeText(input.password);
    const usernameValidation = this.validateRegisterUsername(input.username);
    if (usernameValidation.error) {
      return { error: usernameValidation.error };
    }
    const requestedUsername = usernameValidation.username;

    if (fullName.length < 2) {
      return { error: errorPayload('invalid_full_name', 'fullName gerekli') };
    }
    if (!email.includes('@')) {
      return { error: errorPayload('invalid_email', 'gecerli bir email gir') };
    }
    if (!this.isPasswordLengthValid(password)) {
      return {
        error: errorPayload(
          'invalid_password',
          `sifre ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter olmali`,
        ),
      };
    }

    const existing = state.users.find(u => normalizeEmail(u.email) === email);
    if (existing) {
      if (this.isUserDisabled(existing)) {
        return {
          error: errorPayload(
            'account_disabled',
            'Bu hesap gecici olarak kullanima kapali.',
          ),
        };
      }

      if (!this.isUserVerified(existing)) {
        if (this.isUsernameTaken(requestedUsername, existing.id)) {
          return {
            error: errorPayload('username_taken', 'Bu kullanici adi alinmis.', {
              field: 'username',
            }),
          };
        }

        existing.fullName = fullName;
        existing.city = normalizeText(input.city, existing.city || 'Istanbul');
        existing.favoriteCar = '';
        existing.passwordHash = hashPassword(password);
        existing.username = requestedUsername;
        existing.status = 'pending_verification';
        existing.isVerified = false;

        const codeEntry = this.issueVerificationCode(
          state,
          email,
          'register_retry',
        );
        const delivery = await this.sendVerificationCodeOrFallback({
          code: codeEntry.code,
          email,
          expiresAt: codeEntry.expiresAt,
          fullName: existing.fullName,
        });
        if (delivery.mode === 'failed') {
          return {
            error: errorPayload(
              'verification_email_failed',
              'Dogrulama maili gonderilemedi. SMTP ayarlarini kontrol edin.',
              {
                email,
                reason: normalizeText(
                  delivery.error?.code || delivery.error?.message,
                  'smtp_error',
                ),
              },
            ),
          };
        }

        const challenge = this.toVerificationChallenge(
          existing,
          codeEntry,
          `Bu email icin bekleyen kayit bulundu. ${this.verificationDeliveryMessage(
            email,
            delivery.mode,
          )}`,
          delivery.mode,
        );
        this.store.save();
        return challenge;
      }

      return { error: errorPayload('email_in_use', 'bu email zaten kayitli') };
    }

    if (this.isUsernameTaken(requestedUsername)) {
      return {
        error: errorPayload('username_taken', 'Bu kullanici adi alinmis.', {
          field: 'username',
        }),
      };
    }

    const user = {
      authProvider: 'local',
      avatarUrl: '',
      bio: '',
      birthYear: 0,
      city: normalizeText(input.city, 'Istanbul'),
      createdAt: nowIso(),
      email,
      favoriteCar: '',
      fullName,
      heroTagline: '',
      phone: '',
      phoneDialCode: '90',
      id: createId('user'),
      isVerified: false,
      lastLoginAt: nowIso(),
      passwordHash: hashPassword(password),
      status: 'pending_verification',
      username: requestedUsername,
    };

    state.users.push(user);
    // Create default privacy + settings
    state.privacySettings.push({
      isMapVisible: true,
      isPrivateAccount: false,
      updatedAt: nowIso(),
      userId: user.id,
    });
    state.appSettings.push(buildDefaultAppSettings(user.id));
    state.mapPreferences.push({
      mapFilterMode: 'street_friends',
      mapThemeMode: 'dark',
      showLocalLayer: true,
      showRemoteLayer: true,
      trackingEnabled: true,
      updatedAt: nowIso(),
      userId: user.id,
    });
    const codeEntry = this.issueVerificationCode(state, email, 'register');
    const delivery = await this.sendVerificationCodeOrFallback({
      code: codeEntry.code,
      email,
      expiresAt: codeEntry.expiresAt,
      fullName: user.fullName,
    });
    if (delivery.mode === 'failed') {
      return {
        error: errorPayload(
          'verification_email_failed',
          'Dogrulama maili gonderilemedi. SMTP ayarlarini kontrol edin.',
          {
            email,
            reason: normalizeText(
              delivery.error?.code || delivery.error?.message,
              'smtp_error',
            ),
          },
        ),
      };
    }

    const challenge = this.toVerificationChallenge(
      user,
      codeEntry,
      this.verificationDeliveryMessage(email, delivery.mode),
      delivery.mode,
    );
    this.store.save();
    return challenge;
  }

  async login(payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const identifier = normalizeText(input.identifier || input.email).toLowerCase();
    const password = normalizeText(input.password);
    if (identifier.length === 0 || password.length === 0) {
      return {
        error: errorPayload('invalid_request', 'Email/kullanici adi ve sifre zorunlu.'),
      };
    }
    const user = identifier.includes('@')
      ? state.users.find(u => normalizeEmail(u.email) === identifier)
      : state.users.find(
          u => normalizeText(u.username, '').toLowerCase() === this.sanitizeUsernameInput(identifier),
        );

    if (!user) {
      return {
        error: errorPayload('invalid_credentials', 'email, kullanici adi veya sifre yanlis'),
      };
    }
    if (this.isUserDisabled(user)) {
      return {
        error: errorPayload(
          'account_disabled',
          'Bu hesap gecici olarak kullanima kapali.',
        ),
      };
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return {
        error: errorPayload('invalid_credentials', 'email, kullanici adi veya sifre yanlis'),
      };
    }
    user.lastLoginAt = nowIso();
    if (this.isUserVerified(user)) {
      user.status = 'active';
      user.isVerified = true;
    } else {
      // Giriste email dogrulama istemiyoruz; bu adim sadece register akisinda zorunlu.
      user.status = 'pending_verification';
      user.isVerified = false;
    }
    this.store.save();

    return {
      profile: this.profileFor(user),
      session: this.createSession(user.id, user.authProvider || 'local'),
    };
  }

  socialLogin(payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const providerRaw = normalizeText(input.provider).toLowerCase();
    if (providerRaw !== 'google' && providerRaw !== 'facebook') {
      return {
        error: errorPayload(
          'invalid_provider',
          'Provider google veya facebook olmali.',
        ),
      };
    }
    const provider = providerRaw;
    const fullName = normalizeText(
      input.fullName,
      provider === 'google' ? 'Google Driver' : 'Facebook Driver',
    );
    const email = normalizeEmail(
      input.email || `${provider}.${slugifyUsername(fullName)}@macradar.app`,
    );

    let user = state.users.find(u => normalizeEmail(u.email) === email);
    if (!user) {
      user = {
        authProvider: provider,
        avatarUrl: normalizeText(input.avatarUrl, avatarForName(fullName)),
        bio: '',
        birthYear: 0,
        city: normalizeText(input.city, 'Istanbul'),
        createdAt: nowIso(),
        email,
        favoriteCar: '',
        fullName,
        heroTagline: '',
        phone: '',
        phoneDialCode: '90',
        id: createId('user'),
        isVerified: true,
        lastLoginAt: nowIso(),
        passwordHash: '',
        status: 'active',
        username: this.uniqueUsername(input.username || fullName),
      };
      state.users.push(user);
      state.privacySettings.push({
        isMapVisible: true,
        isPrivateAccount: false,
        updatedAt: nowIso(),
        userId: user.id,
      });
      state.appSettings.push(buildDefaultAppSettings(user.id));
      state.mapPreferences.push({
        mapFilterMode: 'street_friends',
        mapThemeMode: 'dark',
        showLocalLayer: true,
        showRemoteLayer: true,
        trackingEnabled: true,
        updatedAt: nowIso(),
        userId: user.id,
      });
    } else {
      user.authProvider = provider;
      user.avatarUrl = normalizeText(input.avatarUrl, user.avatarUrl);
      user.fullName = fullName;
      user.isVerified = true;
      user.lastLoginAt = nowIso();
      user.status = 'active';
    }

    this.store.save();
    return {
      profile: this.profileFor(user),
      session: this.createSession(user.id, provider),
    };
  }

  logout(req) {
    const token = getBearerToken(req);
    const state = this.store.getState();
    state.sessions = state.sessions.filter(s => s.token !== token);
    this.store.save();
    return { ok: true };
  }

  deleteMyAccount(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const userId = user.id;
    const userEmail = normalizeEmail(user.email);

    state.sessions = state.sessions.filter(
      session => session.userId !== userId,
    );
    state.users = state.users.filter(candidate => candidate.id !== userId);
    state.follows = state.follows.filter(
      relation =>
        relation.followerId !== userId && relation.followedUserId !== userId,
    );
    state.followRequests = state.followRequests.filter(
      request => request.requesterId !== userId && request.targetId !== userId,
    );
    state.blockedUsers = state.blockedUsers.filter(
      relation =>
        relation.blockerId !== userId && relation.blockedId !== userId,
    );
    if (Array.isArray(state.chatRequests)) {
      state.chatRequests = state.chatRequests.filter(
        request =>
          request.requesterId !== userId && request.recipientId !== userId,
      );
    }
    state.streetFriends = state.streetFriends.filter(
      relation => relation.userId1 !== userId && relation.userId2 !== userId,
    );
    state.mapPreferences = state.mapPreferences.filter(
      item => item.userId !== userId,
    );
    state.privacySettings = state.privacySettings.filter(
      item => item.userId !== userId,
    );
    state.appSettings = state.appSettings.filter(
      item => item.userId !== userId,
    );
    if (Array.isArray(state.notifications)) {
      state.notifications = state.notifications.filter(
        item =>
          normalizeText(item.recipientId, '') !== userId &&
          normalizeText(item.actorId, '') !== userId,
      );
    }
    state.profilePosts = state.profilePosts.filter(
      post => post.userId !== userId,
    );
    state.posts = state.posts.filter(
      post => post.userId !== userId && post.authorId !== userId,
    );
    state.comments = state.comments.filter(
      comment => comment.userId !== userId && comment.authorId !== userId,
    );
    const remainingCommentIds = new Set(
      (state.comments || []).map(comment => normalizeText(comment.id, '')),
    );
    state.commentEngagements = (state.commentEngagements || []).filter(
      engagement =>
        engagement.viewerId !== userId &&
        remainingCommentIds.has(normalizeText(engagement.commentId, '')),
    );
    state.postEngagements = state.postEngagements.filter(
      engagement =>
        engagement.userId !== userId &&
        engagement.authorId !== userId &&
        engagement.postAuthorId !== userId,
    );
    state.passwordResetCodes = state.passwordResetCodes.filter(
      item => normalizeEmail(item.email || '') !== userEmail,
    );
    state.verificationCodes = state.verificationCodes.filter(
      item => normalizeEmail(item.email || '') !== userEmail,
    );
    if (Array.isArray(state.conversations)) {
      state.conversations = state.conversations.filter(conversation => {
        if (!Array.isArray(conversation.participantIds)) {
          return true;
        }
        return !conversation.participantIds.includes(userId);
      });
    }
    if (Array.isArray(state.conversationUserStates)) {
      state.conversationUserStates = state.conversationUserStates.filter(
        item => item.userId !== userId,
      );
    }
    if (Array.isArray(state.messages)) {
      state.messages = state.messages.filter(
        message => message.senderId !== userId && message.authorId !== userId,
      );
    }
    if (Array.isArray(state.voiceMessages)) {
      state.voiceMessages = state.voiceMessages.filter(voiceMessage => {
        const belongsToUser = voiceMessage.uploaderId === userId;
        if (belongsToUser) {
          try {
            const voicePath = path.join(
              VOICE_STORAGE_DIR,
              normalizeText(voiceMessage.fileName),
            );
            if (
              voicePath.startsWith(VOICE_STORAGE_DIR) &&
              fs.existsSync(voicePath)
            ) {
              fs.unlinkSync(voicePath);
            }
          } catch {}
        }
        return !belongsToUser;
      });
    }

    this.store.save();
    return {
      deleted: true,
      message: 'Hesabiniz kalici olarak silindi.',
      userId,
    };
  }

  async requestDeleteAccountVerification(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const email = normalizeEmail(user.email);
    if (!email.includes('@')) {
      return {
        error: errorPayload(
          'invalid_email',
          'Hesabinizda gecerli bir email adresi bulunamadi.',
        ),
      };
    }

    this.sanitizeVerificationStore(state);
    const latest = this.findLatestVerificationCode(state, email, [
      'account_delete',
    ]);
    if (
      latest &&
      new Date(latest.resendAvailableAt || 0).getTime() > Date.now()
    ) {
      return {
        error: errorPayload(
          'verification_resend_rate_limited',
          'Yeni kod istemek icin kisa bir sure bekleyin.',
          {
            email,
            resendAvailableAt: latest.resendAvailableAt,
          },
        ),
      };
    }

    const codeEntry = this.issueVerificationCode(state, email, 'account_delete');
    const delivery = await this.sendVerificationCodeOrFallback({
      code: codeEntry.code,
      email,
      expiresAt: codeEntry.expiresAt,
      fullName: user.fullName,
    });
    if (delivery.mode === 'failed') {
      return {
        error: errorPayload(
          'verification_email_failed',
          'Dogrulama kodu gonderilemedi. Lutfen tekrar deneyin.',
          {
            email,
            reason: normalizeText(
              delivery.error?.code || delivery.error?.message,
              'smtp_error',
            ),
          },
        ),
      };
    }

    const challenge = this.toVerificationChallenge(
      user,
      codeEntry,
      this.verificationDeliveryMessage(email, delivery.mode),
      delivery.mode,
    );
    this.store.save();
    return challenge;
  }

  confirmDeleteMyAccount(req, payload) {
    const user = this.requireUser(req);
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const email = normalizeEmail(user.email);
    const code = normalizeText(input.code);
    if (code.length !== 6) {
      return {
        error: errorPayload(
          'invalid_verification_code',
          'Dogrulama kodu 6 haneli olmali.',
        ),
      };
    }

    this.sanitizeVerificationStore(state);
    const verification = this.findLatestVerificationCode(state, email, [
      'account_delete',
    ]);
    if (!verification) {
      return {
        error: errorPayload(
          'verification_required',
          'Hesap silme icin once e-posta dogrulama kodu isteyin.',
        ),
      };
    }

    const expiresAtMs = new Date(verification.expiresAt || '').getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return {
        error: errorPayload(
          'verification_expired',
          'Kodun suresi dolmus. Yeni bir kod isteyin.',
        ),
      };
    }

    if (normalizeText(verification.code) !== code) {
      verification.attempts = Number(verification.attempts || 0) + 1;
      if (verification.attempts >= DELETE_ACCOUNT_MAX_ATTEMPTS) {
        verification.used = true;
      }
      this.store.save();
      return {
        error: errorPayload(
          'invalid_verification_code',
          'Girdiginiz kod hatali.',
          {
            remainingAttempts: Math.max(
              0,
              DELETE_ACCOUNT_MAX_ATTEMPTS - Number(verification.attempts || 0),
            ),
          },
        ),
      };
    }

    verification.used = true;
    return this.deleteMyAccount(req);
  }

  async resendVerification(payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const email = normalizeEmail(input.email);
    if (!email.includes('@')) {
      return {
        error: errorPayload('invalid_email', 'Gecerli bir email adresi gir.'),
      };
    }

    const user = state.users.find(u => normalizeEmail(u.email) === email);
    if (!user) {
      return {
        error: errorPayload(
          'user_not_found',
          'Bu email ile kullanici bulunamadi.',
          { email },
        ),
      };
    }

    if (this.isUserVerified(user)) {
      return {
        error: errorPayload(
          'already_verified',
          'Bu hesabin email adresi zaten dogrulanmis.',
          { email, status: 'active' },
        ),
      };
    }

    this.sanitizeVerificationStore(state);
    const latest = this.findLatestVerificationCode(state, email, [
      'register',
      'resend',
    ]);
    if (
      latest &&
      new Date(latest.resendAvailableAt || 0).getTime() > Date.now()
    ) {
      return {
        error: errorPayload(
          'verification_resend_rate_limited',
          'Yeni kod istemek icin beklemelisin.',
          {
            email,
            resendAvailableAt: latest.resendAvailableAt,
            status: 'pending_verification',
          },
        ),
      };
    }

    const codeEntry = this.issueVerificationCode(state, email, 'resend');
    const delivery = await this.sendVerificationCodeOrFallback({
      code: codeEntry.code,
      email,
      expiresAt: codeEntry.expiresAt,
      fullName: user.fullName,
    });
    if (delivery.mode === 'failed') {
      return {
        error: errorPayload(
          'verification_email_failed',
          'Dogrulama maili gonderilemedi. SMTP ayarlarini kontrol edin.',
          {
            email,
            reason: normalizeText(
              delivery.error?.code || delivery.error?.message,
              'smtp_error',
            ),
          },
        ),
      };
    }

    const challenge = this.toVerificationChallenge(
      user,
      codeEntry,
      this.verificationDeliveryMessage(email, delivery.mode),
      delivery.mode,
    );
    this.store.save();
    return challenge;
  }

  confirmVerification(payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const email = normalizeEmail(input.email);
    const code = normalizeText(input.code);
    const user = state.users.find(u => normalizeEmail(u.email) === email);

    if (!email.includes('@')) {
      return {
        error: errorPayload('invalid_email', 'Gecerli bir email adresi gir.'),
      };
    }
    if (code.length !== 6) {
      return {
        error: errorPayload(
          'invalid_verification_code',
          'Dogrulama kodu 6 haneli olmali.',
        ),
      };
    }
    if (!user) {
      return {
        error: errorPayload('user_not_found', 'Kullanici bulunamadi.', {
          email,
        }),
      };
    }
    if (this.isUserVerified(user)) {
      return {
        auth: {
          profile: this.profileFor(user),
          session: this.createSession(user.id, user.authProvider || 'local'),
        },
        email,
        message: 'Email zaten dogrulanmis.',
        status: 'already_verified',
        verifiedAt: nowIso(),
      };
    }

    this.sanitizeVerificationStore(state);
    const verification = this.findLatestVerificationCode(state, email, [
      'register',
      'resend',
    ]);
    if (!verification) {
      return {
        error: errorPayload(
          'invalid_verification_code',
          'Gecersiz veya suresi dolmus kod.',
        ),
      };
    }

    if (verification.code !== code) {
      verification.attempts = Number.isFinite(verification.attempts)
        ? verification.attempts + 1
        : 1;
      const remainingAttempts = Math.max(0, 5 - verification.attempts);
      this.store.save();
      return {
        error: errorPayload('invalid_verification_code', 'Kod dogrulanamadi.', {
          remainingAttempts,
        }),
      };
    }

    verification.used = true;
    user.isVerified = true;
    user.status = 'active';
    user.lastLoginAt = nowIso();
    this.store.save();

    return {
      auth: {
        profile: this.profileFor(user),
        session: this.createSession(user.id, user.authProvider || 'local'),
      },
      email,
      message: 'Email dogrulandi. Hosgeldiniz!',
      status: 'verified',
      verifiedAt: nowIso(),
    };
  }

  async requestPasswordReset(payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const email = normalizeEmail(input.email);
    const user = state.users.find(u => normalizeEmail(u.email) === email);
    if (!email.includes('@')) {
      return {
        error: errorPayload('invalid_email', 'Gecerli bir email adresi gir.'),
      };
    }
    if (!user) {
      return {
        error: errorPayload(
          'password_reset_not_allowed',
          'Bu email ile kayitli hesap bulunamadi.',
          { reason: 'not_found' },
        ),
      };
    }
    if (this.isUserDisabled(user)) {
      return {
        error: errorPayload(
          'password_reset_not_allowed',
          'Bu hesap şu an şifre sıfırlama için uygun değil.',
          { reason: 'disabled' },
        ),
      };
    }
    const hasLocalPassword =
      typeof user.passwordHash === 'string' && user.passwordHash.includes(':');
    if (!hasLocalPassword || user.authProvider !== 'local') {
      return {
        error: errorPayload(
          'password_reset_not_allowed',
          'Şifre sıfırlama yalnızca e-posta ile giriş yapan hesaplarda kullanılabilir.',
          { reason: 'social_login' },
        ),
      };
    }

    const existing = state.passwordResetCodes
      .filter(
        item => normalizeEmail(item.email) === email && item.used !== true,
      )
      .sort((left, right) => {
        const leftMs = new Date(left.createdAt || 0).getTime();
        const rightMs = new Date(right.createdAt || 0).getTime();
        return rightMs - leftMs;
      })[0];
    if (
      existing &&
      new Date(existing.expiresAt || 0).getTime() > Date.now() &&
      new Date(existing.resendAvailableAt || 0).getTime() > Date.now()
    ) {
      return {
        error: errorPayload(
          'password_reset_rate_limited',
          'Yeni kod istemek için beklemelisin.',
          {
            resendAvailableAt: existing.resendAvailableAt,
          },
        ),
      };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const entry = {
      attempts: 0,
      code,
      createdAt: nowIso(),
      email,
      expiresAt: new Date(
        Date.now() + PASSWORD_RESET_CODE_TTL_MS,
      ).toISOString(),
      id: createId('prc'),
      resendAvailableAt: new Date(
        Date.now() + PASSWORD_RESET_RESEND_COOLDOWN_MS,
      ).toISOString(),
      used: false,
    };
    state.passwordResetCodes = state.passwordResetCodes.filter(
      c => c.email !== email,
    );
    state.passwordResetCodes.push(entry);
    const delivery = await this.sendPasswordResetCodeOrFallback({
      code,
      email,
      expiresAt: entry.expiresAt,
      fullName: user.fullName,
    });
    if (delivery.mode === 'failed') {
      return {
        error: errorPayload(
          'password_reset_email_failed',
          'Şifre sıfırlama maili gönderilemedi. SMTP ayarlarını kontrol edin.',
          {
            email,
            reason: normalizeText(
              delivery.error?.code || delivery.error?.message,
              'smtp_error',
            ),
          },
        ),
      };
    }

    this.store.save();
    const message = this.passwordResetDeliveryMessage(
      email,
      delivery.mode,
      hasLocalPassword,
    );
    return {
      debugCode:
        this.isAuthDebugPreviewEnabled() && delivery.mode === 'debug'
          ? code
          : undefined,
      delivery: delivery.mode,
      email,
      expiresAt: entry.expiresAt,
      message,
      resendAvailableAt: entry.resendAvailableAt,
    };
  }

  confirmPasswordReset(payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const email = normalizeEmail(input.email);
    const code = normalizeText(input.code);
    if (!email.includes('@')) {
      return {
        error: errorPayload('invalid_email', 'Gecerli bir email adresi gir.'),
      };
    }
    const entry = state.passwordResetCodes
      .filter(c => normalizeEmail(c.email) === email && c.used !== true)
      .sort((left, right) => {
        const leftMs = new Date(left.createdAt || 0).getTime();
        const rightMs = new Date(right.createdAt || 0).getTime();
        return rightMs - leftMs;
      })[0];
    if (!entry || new Date(entry.expiresAt) < new Date()) {
      return {
        error: errorPayload(
          'invalid_password_reset_code',
          'Gecersiz veya suresi dolmus kod.',
        ),
      };
    }
    if (code.length !== 6 || entry.code !== code) {
      entry.attempts = Number.isFinite(entry.attempts) ? entry.attempts + 1 : 1;
      const remainingAttempts = Math.max(
        0,
        PASSWORD_RESET_MAX_ATTEMPTS - entry.attempts,
      );
      if (remainingAttempts === 0) {
        entry.used = true;
      }
      this.store.save();
      return {
        error: errorPayload(
          'invalid_password_reset_code',
          'Gecersiz veya suresi dolmus kod.',
          { remainingAttempts },
        ),
      };
    }
    const user = state.users.find(u => normalizeEmail(u.email) === email);
    if (!user)
      return { error: errorPayload('user_not_found', 'Kullanici bulunamadi.') };
    const newPw = normalizeText(input.newPassword);
    if (!this.isPasswordLengthValid(newPw)) {
      return {
        error: errorPayload(
          'invalid_password',
          `Yeni sifre ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter olmali.`,
        ),
      };
    }
    user.passwordHash = hashPassword(newPw);
    user.isVerified = true;
    user.status = 'active';
    entry.used = true;
    this.store.save();
    return { message: 'Şifre başarıyla değiştirildi.' };
  }

  changePassword(req, payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const user = this.requireUser(req);
    const currentPw = normalizeText(input.currentPassword);
    const newPw = normalizeText(input.newPassword);
    const hasLocalPassword =
      typeof user.passwordHash === 'string' && user.passwordHash.includes(':');
    if (!hasLocalPassword || user.authProvider !== 'local') {
      return {
        error: errorPayload(
          'password_change_not_allowed',
          'Bu hesap için şifre değiştirme kullanılamıyor.',
        ),
      };
    }
    if (currentPw.length === 0 || newPw.length === 0) {
      return {
        error: errorPayload(
          'invalid_request',
          'Mevcut sifre ve yeni sifre zorunlu.',
        ),
      };
    }
    if (!verifyPassword(currentPw, user.passwordHash)) {
      return {
        error: errorPayload('invalid_current_password', 'Mevcut sifre yanlis.'),
      };
    }
    if (!this.isPasswordLengthValid(newPw)) {
      return {
        error: errorPayload(
          'invalid_password',
          `Yeni sifre ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter olmali.`,
        ),
      };
    }
    user.passwordHash = hashPassword(newPw);
    this.store.save();
    return { message: 'Şifre başarıyla güncellendi.' };
  }

  // â”€â”€â”€ Profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getProfile(req) {
    return this.profileFor(this.requireUser(req));
  }

  updateProfile(req, payload) {
    const user = this.requireUser(req);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const updates = {};
    const currentYear = new Date().getFullYear();
    const allowedKeys = new Set([
      'avatarUrl',
      'bio',
      'city',
      'favoriteCar',
      'fullName',
      'heroTagline',
      'birthYear',
      'phone',
      'phoneDialCode',
    ]);
    const maxLength = {
      avatarUrl: 500,
      bio: 500,
      city: 70,
      favoriteCar: 64,
      fullName: 60,
      heroTagline: 120,
      phone: 16,
      phoneDialCode: 4,
    };
    const input = payload;

    if (
      Object.prototype.hasOwnProperty.call(input, 'phoneDialCode') &&
      !Object.prototype.hasOwnProperty.call(input, 'phone')
    ) {
      return {
        error: errorPayload(
          'invalid_phone',
          'phoneDialCode yalnizca phone ile birlikte kullanilabilir.',
        ),
      };
    }

    if (Object.keys(input).some(key => !allowedKeys.has(key))) {
      return {
        error: errorPayload(
          'invalid_profile_payload',
          'Kabul edilmeyen alan mevcut.',
        ),
      };
    }

    if (Object.prototype.hasOwnProperty.call(input, 'avatarUrl')) {
      if (typeof input.avatarUrl !== 'string') {
        return {
          error: errorPayload(
            'invalid_avatar_url',
            'avatarUrl metin olmalidir.',
          ),
        };
      }
      const avatarUrl = normalizeText(input.avatarUrl);
      if (avatarUrl.length > maxLength.avatarUrl) {
        return {
          error: errorPayload(
            'invalid_avatar_url',
            'avatarUrl en fazla 500 karakter olabilir.',
          ),
        };
      }
      if (avatarUrl.length === 0 && user.authProvider !== 'local') {
        return {
          error: errorPayload(
            'avatar_delete_not_allowed',
            'Profil fotoğrafı kaldırma yalnızca e-posta ile giriş yapan hesaplarda kullanılabilir.',
          ),
        };
      }
      updates.avatarUrl = avatarUrl;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'bio')) {
      if (typeof input.bio !== 'string') {
        return { error: errorPayload('invalid_bio', 'bio metin olmalidir.') };
      }
      const bio = normalizeText(input.bio);
      if (bio.length > maxLength.bio) {
        return {
          error: errorPayload(
            'invalid_bio',
            'bio en fazla 500 karakter olabilir.',
          ),
        };
      }
      updates.bio = bio;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'city')) {
      if (typeof input.city !== 'string') {
        return { error: errorPayload('invalid_city', 'city metin olmalidir.') };
      }
      const city = normalizeText(input.city);
      if (city.length > maxLength.city) {
        return {
          error: errorPayload(
            'invalid_city',
            'city en fazla 70 karakter olabilir.',
          ),
        };
      }
      updates.city = city;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'favoriteCar')) {
      if (typeof input.favoriteCar !== 'string') {
        return {
          error: errorPayload(
            'invalid_favorite_car',
            'favoriteCar metin olmalidir.',
          ),
        };
      }
      const favoriteCar = normalizeText(input.favoriteCar);
      if (favoriteCar.length > maxLength.favoriteCar) {
        return {
          error: errorPayload(
            'invalid_favorite_car',
            'favoriteCar en fazla 64 karakter olabilir.',
          ),
        };
      }
      updates.favoriteCar = '';
    }

    if (Object.prototype.hasOwnProperty.call(input, 'fullName')) {
      if (typeof input.fullName !== 'string') {
        return {
          error: errorPayload('invalid_full_name', 'fullName metin olmalidir.'),
        };
      }
      const fullName = normalizeText(input.fullName);
      if (fullName.length < 2) {
        return {
          error: errorPayload(
            'invalid_full_name',
            'Ad soyad en az 2 karakter olmali.',
          ),
        };
      }
      if (fullName.length > maxLength.fullName) {
        return {
          error: errorPayload(
            'invalid_full_name',
            'fullName en fazla 60 karakter olabilir.',
          ),
        };
      }
      updates.fullName = fullName;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'heroTagline')) {
      if (typeof input.heroTagline !== 'string') {
        return {
          error: errorPayload(
            'invalid_hero_tagline',
            'heroTagline metin olmalidir.',
          ),
        };
      }
      const heroTagline = normalizeText(input.heroTagline);
      if (heroTagline.length > maxLength.heroTagline) {
        return {
          error: errorPayload(
            'invalid_hero_tagline',
            'heroTagline en fazla 120 karakter olabilir.',
          ),
        };
      }
      updates.heroTagline = '';
    }

    if (Object.prototype.hasOwnProperty.call(input, 'birthYear')) {
      const birthYear = Number(input.birthYear);
      if (
        !Number.isInteger(birthYear) ||
        birthYear < 1930 ||
        birthYear > currentYear + 1
      ) {
        return {
          error: errorPayload(
            'invalid_birth_year',
            `dogum yili 1930 ile ${currentYear + 1} arasinda olmali.`,
          ),
        };
      }
      updates.birthYear = birthYear;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'phone')) {
      if (typeof input.phone !== 'string') {
        return {
          error: errorPayload('invalid_phone', 'phone metin olmalidir.'),
        };
      }
      let dial = '';
      if (Object.prototype.hasOwnProperty.call(input, 'phoneDialCode')) {
        if (typeof input.phoneDialCode !== 'string') {
          return {
            error: errorPayload(
              'invalid_phone',
              'phoneDialCode metin olmalidir.',
            ),
          };
        }
        dial = normalizeText(input.phoneDialCode).replace(/\D/g, '');
        if (dial.length > maxLength.phoneDialCode) {
          return {
            error: errorPayload(
              'invalid_phone',
              'phoneDialCode en fazla 4 rakam olabilir.',
            ),
          };
        }
      }
      const national = normalizeText(input.phone).replace(/\D/g, '');
      if (national.length === 0) {
        updates.phone = '';
        updates.phoneDialCode = '';
      } else {
        if (!dial) {
          dial = '90';
        }
        if (dial.length < 1 || dial.length > 4) {
          return {
            error: errorPayload('invalid_phone', 'Ulke kodu gecersiz.'),
          };
        }
        if (national.length < 4 || national.length > 14) {
          return {
            error: errorPayload('invalid_phone', 'Telefon numarasi gecersiz.'),
          };
        }
        if (dial.length + national.length > 15) {
          return {
            error: errorPayload('invalid_phone', 'Telefon numarasi cok uzun.'),
          };
        }
        if (dial === '90' && !/^5\d{9}$/.test(national)) {
          return {
            error: errorPayload(
              'invalid_phone',
              'Turkiye cep telefonu 10 hane olmali ve 5 ile baslamali.',
            ),
          };
        }
        updates.phone = national;
        updates.phoneDialCode = dial;
      }
    }

    if (!Object.keys(updates).length) {
      return {
        error: errorPayload('no_changes', 'Guncellenecek alan bulunamadi.'),
      };
    }

    Object.assign(user, updates);
    this.store.save();
    return this.profileFor(user);
  }

  getProfileHelp(req) {
    this.requireUser(req);
    return {
      items: [
        {
          description:
            'Profilde ad-soyad, bio, sehir ve dogum yili alanlarini guvenli sekilde guncelleyebilirsin.',
          title: 'Profil Güncelle',
        },
        {
          description:
            'Hesabin gorunurlugunu, map ayarlarini ve istek kisitlamalarini privacy menusunden Yönet.',
          title: 'Gizlilik ayarlari',
        },
        {
          description:
            'Bildirimler, dil ve profil tercihlerini uygulama profilinde özelleştir.',
          title: 'Uygulama ayarlari',
        },
        {
          description:
            'Sifreyi degistirmek icin Profil > Ayarlar > Sifre Degistir adimini izle.',
          title: 'Sifre Değiştir',
        },
        {
          description: 'Hesabını silmek için destek@macradar.app adresine yaz.',
          title: 'Hesabı Sil',
        },
      ],
      supportEmail: 'destek@macradar.app',
      supportHours: 'Hafta içi 09:00-18:00',
      updatedAt: nowIso(),
    };
  }

  ensureNotificationsCollection(state) {
    if (!Array.isArray(state.notifications)) {
      state.notifications = [];
    }
    return state.notifications;
  }

  normalizeStoredNotifications(state) {
    const notifications = this.ensureNotificationsCollection(state);
    let changed = false;
    const normalized = [];

    notifications.forEach(item => {
      if (!item || typeof item !== 'object') {
        changed = true;
        return;
      }

      const type = normalizeText(item.type, '').toLowerCase();
      const metadata =
        item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      const metadataKind = normalizeText(metadata.kind, '').toLowerCase();
      if (
        type === 'demo' ||
        metadataKind === 'demo' ||
        normalizeText(item.title, '').toLowerCase() === 'test bildirimi'
      ) {
        changed = true;
        return;
      }

      const recipientId = normalizeText(item.userId || item.recipientId, '');
      const actorId = normalizeText(item.fromUserId || item.actorId, '');
      const postId = normalizeText(item.postId || metadata.postId, '');
      const commentId = normalizeText(item.commentId || metadata.commentId, '');
      const conversationId = normalizeText(
        item.conversationId || metadata.conversationId,
        '',
      );
      const messageId = normalizeText(item.messageId || metadata.messageId, '');

      const nextNotification = {
        ...item,
        actorId,
        commentId: commentId || undefined,
        conversationId: conversationId || undefined,
        fromUserId: actorId,
        messageId: messageId || undefined,
        metadata,
        postId: postId || undefined,
        recipientId,
        userId: recipientId,
      };

      if (
        nextNotification.actorId !== item.actorId ||
        nextNotification.fromUserId !== item.fromUserId ||
        nextNotification.recipientId !== item.recipientId ||
        nextNotification.userId !== item.userId ||
        nextNotification.postId !== item.postId ||
        nextNotification.commentId !== item.commentId ||
        nextNotification.conversationId !== item.conversationId ||
        nextNotification.messageId !== item.messageId
      ) {
        changed = true;
      }

      normalized.push(nextNotification);
    });

    if (normalized.length > MAX_STORED_NOTIFICATIONS) {
      normalized.length = MAX_STORED_NOTIFICATIONS;
      changed = true;
    }

    if (
      changed ||
      normalized.length !== notifications.length ||
      normalized !== notifications
    ) {
      state.notifications = normalized;
    }

    return changed || normalized.length !== notifications.length;
  }

  isNotificationChannelEnabled(state, userId, channel) {
    const settings = this.getAppSettingsRecord(state, userId, true);
    if (!settings) {
      return true;
    }
    if (channel === 'follow_requests') {
      return settings.notifyFollowRequests !== false;
    }
    if (channel === 'post_likes' || channel === 'posts') {
      return settings.notifyPostLikes !== false;
    }
    if (channel === 'messages') {
      return settings.notifyMessages !== false;
    }
    return true;
  }

  resolveNotificationDedupeKey(payload, recipientId, actorId, metadata = {}) {
    const explicitKey = normalizeText(payload?.dedupeKey, '');
    if (explicitKey) {
      return explicitKey;
    }

    const type = normalizeText(payload?.type, '').toLowerCase();
    const postId = normalizeText(payload?.postId || metadata.postId, '');
    const commentId = normalizeText(payload?.commentId || metadata.commentId, '');
    const messageId = normalizeText(payload?.messageId || metadata.messageId, '');

    if (type === 'new_post' && postId) {
      return `new_post:${recipientId}:${actorId}:${postId}`;
    }
    if (type === 'comment' && commentId) {
      return `comment:${recipientId}:${commentId}`;
    }
    if (type === 'like' && postId) {
      return `like:${recipientId}:${actorId}:${postId}`;
    }
    if (type === 'message' && messageId) {
      return `message:${recipientId}:${messageId}`;
    }

    return '';
  }

  emitNotificationCreated(notification) {
    if (!notification || !this.notificationsHub) {
      return;
    }

    const recipientId = normalizeText(notification.userId || notification.recipientId, '');
    if (!recipientId) {
      return;
    }

    this.notificationsHub.sendToUser(recipientId, {
      notification,
      serverTime: nowIso(),
      type: 'notification.created',
    });
  }

  emitRequestRealtimeEvent(recipientId, payload) {
    if (!this.notificationsHub) {
      return;
    }
    const normalizedRecipientId = normalizeText(recipientId, '');
    if (!normalizedRecipientId) {
      return;
    }
    const kind = normalizeText(payload?.kind, '');
    const requesterId = normalizeText(payload?.requesterId, '');
    const targetId = normalizeText(payload?.targetId, '');
    const eventType = normalizeText(payload?.type, '');
    const reason = normalizeText(payload?.reason, 'unknown');
    const deltaValue = Number.parseInt(String(payload?.delta ?? 0), 10);
    if (
      !kind ||
      !requesterId ||
      !targetId ||
      !eventType ||
      !Number.isFinite(deltaValue) ||
      deltaValue === 0
    ) {
      return;
    }

    this.notificationsHub.sendToUser(normalizedRecipientId, {
      request: {
        delta: deltaValue,
        kind,
        reason,
        requesterId,
        targetId,
      },
      serverTime: nowIso(),
      type: eventType,
    });
  }

  createNotificationsBatch(state, payloads) {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return [];
    }

    const createdNotifications = [];
    for (let index = 0; index < payloads.length; index += NOTIFICATION_BATCH_SIZE) {
      const chunk = payloads.slice(index, index + NOTIFICATION_BATCH_SIZE);
      chunk.forEach(item => {
        const createdNotification = this.createNotification(state, item);
        if (createdNotification) {
          createdNotifications.push(createdNotification);
        }
      });
    }

    return createdNotifications;
  }

  getFollowerIdsForUser(state, userId) {
    if (!Array.isArray(state.follows) || !userId) {
      return [];
    }

    const seen = new Set();
    const followerIds = [];
    state.follows.forEach(item => {
      const followedUserId = normalizeText(item.followedUserId, '');
      const followerId = normalizeText(item.followerId, '');
      if (
        followedUserId !== userId ||
        !followerId ||
        followerId === userId ||
        seen.has(followerId)
      ) {
        return;
      }
      seen.add(followerId);
      followerIds.push(followerId);
    });

    return followerIds;
  }

  triggerLiveFollowNotification(req, payload) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const targetUserId = normalizeText(payload?.targetUserId, '');
    if (!targetUserId || targetUserId === user.id) {
      return {
        error: errorPayload(
          'invalid_tracking_target',
          'Gecerli bir hedef kullanici secilmelidir.',
        ),
      };
    }

    const users = Array.isArray(state.users) ? state.users : [];
    const targetUser = users.find(item => normalizeText(item.id, '') === targetUserId);
    if (!targetUser) {
      return {
        error: errorPayload('target_user_not_found', 'Hedef kullanici bulunamadi.'),
      };
    }

    if (
      this.isUserBlocked(state, user.id, targetUserId) ||
      this.isUserBlocked(state, targetUserId, user.id)
    ) {
      return {
        error: errorPayload(
          'blocked_relationship',
          'Bu kullaniciya canli takip bildirimi gonderilemez.',
        ),
      };
    }

    const dedupeKey = `live_follow:${user.id}:${targetUserId}`;
    const notifications = this.ensureNotificationsCollection(state);
    const recentNotification = notifications.find(item => {
      const itemDedupeKey = normalizeText(
        item?.dedupeKey || item?.metadata?.dedupeKey,
        '',
      );
      if (itemDedupeKey !== dedupeKey) {
        return false;
      }
      const createdAtMs = new Date(item.createdAt || 0).getTime();
      return (
        Number.isFinite(createdAtMs) &&
        Date.now() - createdAtMs < LIVE_FOLLOW_NOTIFICATION_COOLDOWN_MS
      );
    });

    if (recentNotification) {
      const createdAtMs = new Date(recentNotification.createdAt || 0).getTime();
      const retryAfterMs = Number.isFinite(createdAtMs)
        ? Math.max(
            0,
            LIVE_FOLLOW_NOTIFICATION_COOLDOWN_MS - (Date.now() - createdAtMs),
          )
        : LIVE_FOLLOW_NOTIFICATION_COOLDOWN_MS;
      return {
        delivered: false,
        retryAfterMs,
        suppressed: true,
        targetUserId,
      };
    }

    const actorUsername = normalizeText(user.username, '');
    const actorLabel =
      actorUsername || normalizeText(user.fullName, 'Bir kullanici');
    const notification = this.createNotification(state, {
      actorId: user.id,
      body: `${actorLabel} seni canlı takip etmeye başladı`,
      channel: 'live_follow',
      cooldownMs: LIVE_FOLLOW_NOTIFICATION_COOLDOWN_MS,
      dedupeKey,
      metadata: {
        targetUserId,
      },
      recipientId: targetUserId,
      title: 'Canlı Takip',
      type: 'live_follow',
    });

    if (!notification) {
      return {
        delivered: false,
        suppressed: true,
        targetUserId,
      };
    }

    this.store.save();
    return {
      delivered: true,
      notificationId: notification.id,
      targetUserId,
    };
  }

  createNotification(state, payload) {
    const recipientId = normalizeText(payload?.recipientId, '');
    const actorId = normalizeText(payload?.actorId, '');
    if (!recipientId || !actorId || recipientId === actorId) {
      return null;
    }
    const users = Array.isArray(state.users) ? state.users : [];
    const recipient = users.find(item => normalizeText(item.id, '') === recipientId);
    const actor = users.find(item => normalizeText(item.id, '') === actorId);
    if (!recipient || !actor) {
      return null;
    }
    const channel = normalizeText(payload?.channel, 'follow_requests');
    if (!this.isNotificationChannelEnabled(state, recipientId, channel)) {
      return null;
    }
    const notifications = this.ensureNotificationsCollection(state);
    const baseMetadata =
      payload?.metadata && typeof payload.metadata === 'object'
        ? { ...payload.metadata }
        : {};
    const postId = normalizeText(payload?.postId || baseMetadata.postId, '');
    const commentId = normalizeText(payload?.commentId || baseMetadata.commentId, '');
    const conversationId = normalizeText(
      payload?.conversationId || baseMetadata.conversationId,
      '',
    );
    const messageId = normalizeText(payload?.messageId || baseMetadata.messageId, '');
    const cooldownMs = Number(payload?.cooldownMs);
    const dedupeKey = this.resolveNotificationDedupeKey(
      payload,
      recipientId,
      actorId,
      baseMetadata,
    );
    if (dedupeKey) {
      const existingNotification = notifications.find(item => {
        const itemMetadata =
          item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
        return (
          normalizeText(item?.dedupeKey || itemMetadata.dedupeKey, '') === dedupeKey
        );
      });
      if (existingNotification) {
        if (!(Number.isFinite(cooldownMs) && cooldownMs > 0)) {
          return existingNotification;
        }

        const createdAtMs = new Date(existingNotification.createdAt || 0).getTime();
        if (
          Number.isFinite(createdAtMs) &&
          Date.now() - createdAtMs < cooldownMs
        ) {
          return existingNotification;
        }
      }
      baseMetadata.dedupeKey = dedupeKey;
    }
    const now = nowIso();
    const nextNotification = {
      actorAvatarUrl: normalizeText(actor.avatarUrl, ''),
      actorFullName: normalizeText(actor.fullName, 'Kullanici'),
      actorId,
      commentId: commentId || undefined,
      conversationId: conversationId || undefined,
      actorUsername: normalizeText(actor.username, ''),
      body: normalizeText(payload?.body, ''),
      channel,
      createdAt: now,
      dedupeKey: dedupeKey || undefined,
      fromUserId: actorId,
      id: createId('notif'),
      isRead: false,
      messageId: messageId || undefined,
      metadata: baseMetadata,
      postId: postId || undefined,
      recipientId,
      userId: recipientId,
      title: normalizeText(payload?.title, 'MacRadar'),
      type: normalizeText(payload?.type, 'generic'),
      updatedAt: now,
    };
    notifications.unshift(nextNotification);
    if (notifications.length > MAX_STORED_NOTIFICATIONS) {
      notifications.length = MAX_STORED_NOTIFICATIONS;
    }
    this.emitNotificationCreated(nextNotification);
    return nextNotification;
  }

  getNotifications(req, options = {}) {
    const viewer = this.requireUser(req);
    const state = this.store.getState();
    const notifications = this.ensureNotificationsCollection(state);
    const normalizedCategory = normalizeText(options.category, 'all').toLowerCase();
    const resolveCategory = notification => {
      const channel = normalizeText(notification?.channel, '').toLowerCase();
      if (channel === 'messages') {
        return 'messages';
      }
      if (channel === 'follow_requests') {
        return 'requests';
      }
      return 'social';
    };
    const shouldIncludeCategory = notification => {
      if (normalizedCategory === 'all') {
        return true;
      }
      return resolveCategory(notification) === normalizedCategory;
    };
    const normalizedLimit = Math.max(
      1,
      Math.min(Number.parseInt(String(options.limit || 30), 10) || 30, 60),
    );
    const normalizedCursor = normalizeText(options.cursor, '');
    const viewerNotifications = notifications
      .filter(
        item =>
          normalizeText(item.recipientId, '') === viewer.id &&
          shouldIncludeCategory(item),
      )
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt || 0).getTime();
        const rightTime = new Date(right.createdAt || 0).getTime();
        return rightTime - leftTime;
      });
    const startIndex = normalizedCursor
      ? Math.max(
          0,
          viewerNotifications.findIndex(item => item.id === normalizedCursor) + 1,
        )
      : 0;
    const slice = viewerNotifications.slice(startIndex, startIndex + normalizedLimit);
    const unreadCount = viewerNotifications.reduce(
      (total, item) => total + (item.isRead ? 0 : 1),
      0,
    );
    return {
      cursor: startIndex > 0 ? normalizedCursor : '',
      hasMore: startIndex + normalizedLimit < viewerNotifications.length,
      nextCursor:
        startIndex + normalizedLimit < viewerNotifications.length
          ? normalizeText(slice[slice.length - 1]?.id, '')
          : '',
      category:
        normalizedCategory === 'messages' ||
        normalizedCategory === 'social' ||
        normalizedCategory === 'requests'
          ? normalizedCategory
          : 'all',
      notifications: slice,
      total: viewerNotifications.length,
      unreadCount,
      updatedAt: nowIso(),
    };
  }

  markNotificationsRead(req, payload = {}) {
    const viewer = this.requireUser(req);
    const state = this.store.getState();
    const notifications = this.ensureNotificationsCollection(state);
    const normalizedCategory = normalizeText(payload?.category, 'all').toLowerCase();
    const normalizedIds = Array.isArray(payload?.ids)
      ? payload.ids
          .map(value => normalizeText(value, ''))
          .filter(Boolean)
      : [];
    const idsSet = new Set(normalizedIds);
    const markAll = payload?.all === true || normalizedIds.length === 0;
    const resolveCategory = notification => {
      const channel = normalizeText(notification?.channel, '').toLowerCase();
      if (channel === 'messages') {
        return 'messages';
      }
      if (channel === 'follow_requests') {
        return 'requests';
      }
      return 'social';
    };
    const shouldMatchCategory = notification => {
      if (normalizedCategory === 'all') {
        return true;
      }
      return resolveCategory(notification) === normalizedCategory;
    };

    let updatedCount = 0;
    const now = nowIso();
    notifications.forEach(item => {
      if (normalizeText(item.recipientId, '') !== viewer.id) {
        return;
      }
      if (!shouldMatchCategory(item)) {
        return;
      }
      if (!markAll && !idsSet.has(normalizeText(item.id, ''))) {
        return;
      }
      if (item.isRead === true) {
        return;
      }
      item.isRead = true;
      item.updatedAt = now;
      updatedCount += 1;
    });

    if (updatedCount > 0) {
      this.store.save();
    }
    const unreadCount = notifications.reduce((total, item) => {
      if (normalizeText(item.recipientId, '') !== viewer.id) {
        return total;
      }
      return total + (item.isRead === true ? 0 : 1);
    }, 0);
    return {
      readAt: now,
      unreadCount,
      updatedCount,
      userId: viewer.id,
    };
  }

  getPrivacy(req) {
    const user = this.requireUser(req);
    return this.getPrivacyFor(user.id);
  }

  updatePrivacy(req, payload) {
    const user = this.requireUser(req);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const allowedKeys = new Set(['isMapVisible', 'isPrivateAccount']);
    let hasChange = false;

    let privacy = state.privacySettings.find(p => p.userId === user.id);
    if (!privacy) {
      privacy = {
        isMapVisible: true,
        isPrivateAccount: false,
        updatedAt: nowIso(),
        userId: user.id,
      };
      state.privacySettings.push(privacy);
    }

    if (Object.keys(payload).some(key => !allowedKeys.has(key))) {
      return {
        error: errorPayload(
          'invalid_privacy_payload',
          'Kabul edilmeyen alan mevcut.',
        ),
      };
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'isMapVisible')) {
      if (typeof payload.isMapVisible !== 'boolean') {
        return {
          error: errorPayload(
            'invalid_privacy_payload',
            'isMapVisible boolean olmali.',
          ),
        };
      }
      privacy.isMapVisible = payload.isMapVisible;
      hasChange = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'isPrivateAccount')) {
      if (typeof payload.isPrivateAccount !== 'boolean') {
        return {
          error: errorPayload(
            'invalid_privacy_payload',
            'isPrivateAccount boolean olmali.',
          ),
        };
      }
      privacy.isPrivateAccount = payload.isPrivateAccount;
      hasChange = true;
    }

    if (!hasChange) {
      return {
        error: errorPayload('no_changes', 'Guncellenecek alan bulunamadi.'),
      };
    }

    privacy.updatedAt = nowIso();
    this.store.save();
    return privacy;
  }

  getAppSettingsRecord(state, userId, createIfMissing = false) {
    const normalizedUserId = normalizeText(userId);
    if (!normalizedUserId) {
      return null;
    }
    if (!Array.isArray(state.appSettings)) {
      state.appSettings = [];
    }
    let settings = state.appSettings.find(item => item.userId === normalizedUserId);
    if (!settings && createIfMissing) {
      settings = buildDefaultAppSettings(normalizedUserId);
      state.appSettings.push(settings);
      return settings;
    }
    if (!settings) {
      return null;
    }
    if (typeof settings.gender !== 'string') {
      settings.gender = 'prefer_not_to_say';
    }
    settings.language = settings.language === 'en' ? 'en' : 'tr';
    if (typeof settings.notifyFollowRequests !== 'boolean') {
      settings.notifyFollowRequests = true;
    }
    if (typeof settings.notifyMessages !== 'boolean') {
      settings.notifyMessages = true;
    }
    if (typeof settings.notifyPostLikes !== 'boolean') {
      settings.notifyPostLikes = true;
    }
    if (typeof settings.onlyFollowedUsersCanMessage !== 'boolean') {
      settings.onlyFollowedUsersCanMessage = false;
    }
    if (typeof settings.updatedAt !== 'string' || settings.updatedAt.length === 0) {
      settings.updatedAt = nowIso();
    }
    return settings;
  }

  getMessagingSettingsForUser(state, userId) {
    const settings = this.getAppSettingsRecord(state, userId, false);
    if (settings) {
      return settings;
    }
    return buildDefaultAppSettings(normalizeText(userId) || '');
  }

  getAppSettings(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    return this.getAppSettingsRecord(state, user.id, true);
  }

  updateAppSettings(req, payload) {
    const user = this.requireUser(req);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz istek verisi.'),
      };
    }

    const state = this.store.getState();
    const allowedKeys = new Set([
      'gender',
      'language',
      'notifyFollowRequests',
      'notifyMessages',
      'notifyPostLikes',
      'onlyFollowedUsersCanMessage',
    ]);
    const supportedGenders = new Set([
      'male',
      'female',
      'non_binary',
      'prefer_not_to_say',
    ]);
    const supportedLanguages = new Set(['en', 'tr']);
    let hasChange = false;

    const settings = this.getAppSettingsRecord(state, user.id, true);

    if (Object.keys(payload).some(key => !allowedKeys.has(key))) {
      return {
        error: errorPayload(
          'invalid_app_settings_payload',
          'Kabul edilmeyen alan mevcut.',
        ),
      };
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'language')) {
      if (!supportedLanguages.has(payload.language)) {
        return {
          error: errorPayload(
            'invalid_language',
            'Dil sadece en veya tr olmalidir.',
          ),
        };
      }
      settings.language = payload.language;
      hasChange = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'gender')) {
      if (typeof payload.gender !== 'string') {
        return {
          error: errorPayload('invalid_gender', 'gender metin olmalidir.'),
        };
      }
      const gender = normalizeText(payload.gender).toLowerCase();
      if (!supportedGenders.has(gender)) {
        return {
          error: errorPayload('invalid_gender', 'gender desteklenmiyor.'),
        };
      }
      settings.gender = gender;
      hasChange = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'notifyFollowRequests')) {
      if (typeof payload.notifyFollowRequests !== 'boolean') {
        return {
          error: errorPayload(
            'invalid_notify_follow_requests',
            'notifyFollowRequests boolean olmali.',
          ),
        };
      }
      settings.notifyFollowRequests = payload.notifyFollowRequests;
      hasChange = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'notifyMessages')) {
      if (typeof payload.notifyMessages !== 'boolean') {
        return {
          error: errorPayload(
            'invalid_notify_messages',
            'notifyMessages boolean olmali.',
          ),
        };
      }
      settings.notifyMessages = payload.notifyMessages;
      hasChange = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'notifyPostLikes')) {
      if (typeof payload.notifyPostLikes !== 'boolean') {
        return {
          error: errorPayload(
            'invalid_notify_post_likes',
            'notifyPostLikes boolean olmali.',
          ),
        };
      }
      settings.notifyPostLikes = payload.notifyPostLikes;
      hasChange = true;
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, 'onlyFollowedUsersCanMessage')
    ) {
      if (typeof payload.onlyFollowedUsersCanMessage !== 'boolean') {
        return {
          error: errorPayload(
            'invalid_only_followed_users_can_message',
            'onlyFollowedUsersCanMessage boolean olmali.',
          ),
        };
      }
      settings.onlyFollowedUsersCanMessage = payload.onlyFollowedUsersCanMessage;
      hasChange = true;
    }

    if (!hasChange) {
      return {
        error: errorPayload('no_changes', 'Guncellenecek alan bulunamadi.'),
      };
    }

    settings.updatedAt = nowIso();
    this.store.save();
    return settings;
  }

  getMapPreferences(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    return (
      state.mapPreferences.find(m => m.userId === user.id) || {
        mapFilterMode: 'street_friends',
        mapThemeMode: 'dark',
        showLocalLayer: true,
        showRemoteLayer: true,
        trackingEnabled: true,
        updatedAt: nowIso(),
        userId: user.id,
      }
    );
  }

  updateMapPreferences(req, payload) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    let prefs = state.mapPreferences.find(m => m.userId === user.id);
    if (!prefs) {
      prefs = {
        mapFilterMode: 'street_friends',
        mapThemeMode: 'dark',
        showLocalLayer: true,
        showRemoteLayer: true,
        trackingEnabled: true,
        updatedAt: nowIso(),
        userId: user.id,
      };
      state.mapPreferences.push(prefs);
    }
    if (
      payload.mapFilterMode === 'street_friends' ||
      payload.mapFilterMode === 'all'
    )
      prefs.mapFilterMode = payload.mapFilterMode;
    if (['dark', 'light', 'street'].includes(payload.mapThemeMode))
      prefs.mapThemeMode = payload.mapThemeMode;
    if (typeof payload.showLocalLayer === 'boolean')
      prefs.showLocalLayer = payload.showLocalLayer;
    if (typeof payload.showRemoteLayer === 'boolean')
      prefs.showRemoteLayer = payload.showRemoteLayer;
    if (typeof payload.trackingEnabled === 'boolean')
      prefs.trackingEnabled = payload.trackingEnabled;
    prefs.updatedAt = nowIso();
    this.store.save();
    return prefs;
  }

  getRequestSummary(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const followRequestsCount = state.followRequests.filter(
      r =>
        r.targetId === user.id &&
        r.status === 'pending' &&
        !this.isBlockedEitherDirection(state, user.id, r.requesterId),
    ).length;
    const streetRequestsCount = state.streetFriends.filter(
      sf =>
        sf.status === 'pending' &&
        sf.userId2 === user.id &&
        !this.isBlockedEitherDirection(state, user.id, sf.userId1),
    ).length;
    const messagesUnreadCount = state.conversations
      .filter(conv => conv.userId1 === user.id || conv.userId2 === user.id)
      .reduce((total, conv) => {
        const unreadCount =
          conv.userId1 === user.id ? conv.unreadCount1 : conv.unreadCount2;
        const normalizedUnread = Number.isFinite(unreadCount)
          ? Math.max(0, Math.floor(unreadCount))
          : 0;
        return total + normalizedUnread;
      }, 0);
    const notificationsUnreadCount = this.ensureNotificationsCollection(state).filter(
      item => item.recipientId === user.id && item.isRead !== true,
    ).length;
    return {
      followRequestsCount,
      messagesUnreadCount,
      notificationsUnreadCount,
      streetRequestsCount,
      totalCount: followRequestsCount + streetRequestsCount,
      updatedAt: nowIso(),
    };
  }

  // â”€â”€â”€ Follow requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getFollowRequests(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const pending = state.followRequests.filter(
      r =>
        r.targetId === user.id &&
        r.status === 'pending' &&
        !this.isBlockedEitherDirection(state, user.id, r.requesterId),
    );
    const requests = pending
      .map(r => {
        const requester = state.users.find(u => u.id === r.requesterId);
        if (!requester) return null;
        return {
          avatarUrl: requester.avatarUrl,
          fullName: requester.fullName,
          id: r.requesterId,
          isVerified: requester.isVerified,
          requestedAt: r.createdAt,
          username: requester.username,
        };
      })
      .filter(Boolean);
    return { requests };
  }

  acceptFollowRequest(req, requesterId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const request = state.followRequests.find(
      r =>
        r.requesterId === requesterId &&
        r.targetId === user.id &&
        r.status === 'pending',
    );
    if (request) {
      request.status = 'accepted';
      const alreadyFollows = state.follows.some(
        f => f.followerId === requesterId && f.followedUserId === user.id,
      );
      if (!alreadyFollows)
        state.follows.push({
          followedUserId: user.id,
          followerId: requesterId,
        });
      this.createNotification(state, {
        actorId: user.id,
        body: `${normalizeText(user.fullName, 'Bir kullanici')} takip isteğini kabul etti.`,
        channel: 'follow_requests',
        metadata: {
          accepted: true,
          followedUserId: user.id,
          followerId: requesterId,
        },
        recipientId: requesterId,
        title: 'Takip isteğin kabul edildi',
        type: 'follow.request.accepted',
      });
      this.emitRequestRealtimeEvent(user.id, {
        delta: -1,
        kind: 'follow',
        reason: 'accepted',
        requesterId,
        targetId: user.id,
        type: 'request.resolved',
      });
      this.store.save();
    }
    return { accepted: true, requesterId };
  }

  rejectFollowRequest(req, requesterId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const hadPending = state.followRequests.some(
      r =>
        r.requesterId === requesterId &&
        r.targetId === user.id &&
        r.status === 'pending',
    );
    state.followRequests = state.followRequests.filter(
      r =>
        !(
          r.requesterId === requesterId &&
          r.targetId === user.id &&
          r.status === 'pending'
        ),
    );
    if (hadPending) {
      this.emitRequestRealtimeEvent(user.id, {
        delta: -1,
        kind: 'follow',
        reason: 'rejected',
        requesterId,
        targetId: user.id,
        type: 'request.cancelled',
      });
    }
    this.store.save();
    return { accepted: false, requesterId };
  }

  // â”€â”€â”€ Followers / Following â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  userSearchShape(user, viewerId) {
    const state = this.store.getState();
    const isFollowing = state.follows.some(
      f => f.followerId === viewerId && f.followedUserId === user.id,
    );
    const followsYou = state.follows.some(
      f => f.followerId === user.id && f.followedUserId === viewerId,
    );
    const sf = state.streetFriends.find(
      s =>
        s.status === 'accepted' &&
        ((s.userId1 === viewerId && s.userId2 === user.id) ||
          (s.userId1 === user.id && s.userId2 === viewerId)),
    );
    const pendingOutgoing = state.streetFriends.find(
      s =>
        s.status === 'pending' &&
        s.userId1 === viewerId &&
        s.userId2 === user.id,
    );
    const pendingIncoming = state.streetFriends.find(
      s =>
        s.status === 'pending' &&
        s.userId1 === user.id &&
        s.userId2 === viewerId,
    );
    let streetFriendStatus = 'none';
    if (sf) streetFriendStatus = 'accepted';
    else if (pendingOutgoing) streetFriendStatus = 'pending_outgoing';
    else if (pendingIncoming) streetFriendStatus = 'pending_incoming';
    const frReq = state.followRequests.find(
      r =>
        r.requesterId === viewerId &&
        r.targetId === user.id &&
        r.status === 'pending',
    );
    return {
      avatarUrl: user.avatarUrl,
      city: user.city,
      fullName: user.fullName,
      id: user.id,
      isVerified: user.isVerified,
      username: user.username,
      viewerState: {
        followRequestStatus: frReq ? 'pending_outgoing' : 'none',
        followsYou,
        isFollowing,
        isStreetFriend: Boolean(sf),
        streetFriendStatus,
      },
    };
  }

  getFollowers(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const followerIds = state.follows
      .filter(f => f.followedUserId === user.id)
      .map(f => f.followerId);
    const users = followerIds
      .map(id => state.users.find(u => u.id === id))
      .filter(Boolean)
      .map(u => this.userSearchShape(u, user.id));
    return { users };
  }

  removeFollower(req, followerId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    state.follows = state.follows.filter(
      f => !(f.followerId === followerId && f.followedUserId === user.id),
    );
    this.store.save();
    return { followerId, removed: true };
  }

  getFollowing(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const followingIds = state.follows
      .filter(f => f.followerId === user.id)
      .map(f => f.followedUserId);
    const users = followingIds
      .map(id => state.users.find(u => u.id === id))
      .filter(Boolean)
      .map(u => this.userSearchShape(u, user.id));
    return { users };
  }

  // â”€â”€â”€ Blocked users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getBlockedUsers(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const blocked = state.blockedUsers
      .filter(b => b.blockerId === user.id)
      .map(b => {
        const target = state.users.find(u => u.id === b.blockedId);
        if (!target) return null;
        return {
          avatarUrl: target.avatarUrl,
          blockedAt: b.createdAt,
          fullName: target.fullName,
          id: target.id,
          isVerified: target.isVerified,
          username: target.username,
        };
      })
      .filter(Boolean);
    return { users: blocked };
  }

  clearConversationMessageNotifications(state, recipientId, conversationId) {
    const normalizedRecipientId = normalizeText(recipientId);
    const normalizedConversationId = normalizeText(conversationId);
    if (!normalizedRecipientId || !normalizedConversationId) {
      return;
    }
    const notifications = this.ensureNotificationsCollection(state);
    state.notifications = notifications.filter(item => {
      if (normalizeText(item.recipientId) !== normalizedRecipientId) {
        return true;
      }
      if (normalizeText(item.channel) !== 'messages') {
        return true;
      }
      const metadataConversationId = normalizeText(item?.metadata?.conversationId);
      const itemConversationId = normalizeText(item.conversationId);
      return (
        metadataConversationId !== normalizedConversationId &&
        itemConversationId !== normalizedConversationId
      );
    });
  }

  resetPairConversationState(state, leftUserId, rightUserId) {
    const leftId = normalizeText(leftUserId);
    const rightId = normalizeText(rightUserId);
    if (!leftId || !rightId) {
      return;
    }

    const pairConversationIds = new Set(
      (state.conversations || [])
        .filter(
          item =>
            (item.userId1 === leftId && item.userId2 === rightId) ||
            (item.userId1 === rightId && item.userId2 === leftId),
        )
        .map(item => item.id),
    );
    if (pairConversationIds.size === 0) {
      return;
    }

    state.conversations = (state.conversations || []).filter(
      item => !pairConversationIds.has(item.id),
    );
    state.messages = (state.messages || []).filter(
      item => !pairConversationIds.has(item.conversationId),
    );
    state.conversationUserStates = (state.conversationUserStates || []).filter(
      item => !pairConversationIds.has(item.conversationId),
    );
    state.chatRequests = this.ensureChatRequestsCollection(state).filter(
      item => !pairConversationIds.has(item.conversationId),
    );
    if (Array.isArray(state.voiceMessages)) {
      state.voiceMessages = state.voiceMessages.filter(voiceMessage => {
        const belongsToConversation = pairConversationIds.has(
          normalizeText(voiceMessage.conversationId),
        );
        if (belongsToConversation) {
          try {
            const voicePath = path.join(
              VOICE_STORAGE_DIR,
              normalizeText(voiceMessage.fileName),
            );
            if (
              voicePath.startsWith(VOICE_STORAGE_DIR) &&
              fs.existsSync(voicePath)
            ) {
              fs.unlinkSync(voicePath);
            }
          } catch {}
        }
        return !belongsToConversation;
      });
    }
    const notifications = this.ensureNotificationsCollection(state);
    state.notifications = notifications.filter(item => {
      const actorId = normalizeText(item.actorId);
      const recipientId = normalizeText(item.recipientId);
      const metadataConversationId = normalizeText(item?.metadata?.conversationId);
      const itemConversationId = normalizeText(item.conversationId);
      const isPairDirection =
        (actorId === leftId && recipientId === rightId) ||
        (actorId === rightId && recipientId === leftId);
      if (
        pairConversationIds.has(metadataConversationId) ||
        pairConversationIds.has(itemConversationId)
      ) {
        return false;
      }
      return !isPairDirection;
    });
  }

  blockUser(req, targetId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const already = state.blockedUsers.some(
      b => b.blockerId === user.id && b.blockedId === targetId,
    );
    if (!already) {
      state.blockedUsers.push({
        blockerId: user.id,
        blockedId: targetId,
        createdAt: nowIso(),
        id: createId('block'),
      });
      state.follows = state.follows.filter(
        f =>
          !(
            (f.followerId === user.id && f.followedUserId === targetId) ||
            (f.followerId === targetId && f.followedUserId === user.id)
          ),
      );
      state.followRequests = state.followRequests.filter(
        request =>
          !(
            (request.requesterId === user.id && request.targetId === targetId) ||
            (request.requesterId === targetId && request.targetId === user.id)
          ),
      );
      state.streetFriends = state.streetFriends.filter(
        relation =>
          !(
            (relation.userId1 === user.id && relation.userId2 === targetId) ||
            (relation.userId1 === targetId && relation.userId2 === user.id)
          ),
      );
      this.resetPairConversationState(state, user.id, targetId);
      this.store.save();
    }
    return { blocked: true, blockedUserId: targetId };
  }

  unblockUser(req, targetId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    state.blockedUsers = state.blockedUsers.filter(
      b => !(b.blockerId === user.id && b.blockedId === targetId),
    );
    // Keep unblock as a clean slate too.
    this.resetPairConversationState(state, user.id, targetId);
    this.store.save();
    return { blocked: false, blockedUserId: targetId };
  }

  // â”€â”€â”€ Public profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getPublicProfile(req, userId) {
    const state = this.store.getState();
    const viewer = this.requireUser(req);
    const target = state.users.find(u => u.id === userId);
    if (!target)
      return { error: errorPayload('user_not_found', 'Kullanici bulunamadi.') };
    if (this.isViewerBlockedByTargetUser(state, viewer.id, userId)) {
      return { error: errorPayload('user_not_found', 'Kullanici bulunamadi.') };
    }
    const profile = this.publicProfileFor(target, viewer.id);
    if (this.isViewerBlockingTargetUser(state, viewer.id, userId)) {
      return this.sanitizePublicProfileBlockedByViewer(profile);
    }
    return profile;
  }

  // â”€â”€â”€ Profile posts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  normalizeProfilePostLimit(value) {
    const n = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(n) || n <= 0) return 12;
    return Math.min(n, 50);
  }

  normalizePostVisibility(value) {
    const normalized = normalizeText(value, 'public');
    if (normalized === 'private') {
      return 'private';
    }
    if (normalized === 'friends') {
      return 'friends';
    }
    return 'public';
  }

  resolveProfilePostSegment(visibility) {
    return visibility === 'public' ? 'sizin-icin' : 'takipte';
  }

  resolvePostLocationLabel(post) {
    const payload = this.normalizeProfilePostLocationPayload(post?.locationPayload);
    const selectedName = normalizeText(payload?.selectedLocation?.name, '');
    if (selectedName) {
      return selectedName;
    }
    const selectedFullAddress = normalizeText(
      payload?.selectedLocation?.fullAddress,
      '',
    );
    if (selectedFullAddress) {
      return selectedFullAddress;
    }
    const normalizedQuery = normalizeText(payload?.normalizedQuery, '');
    if (normalizedQuery) {
      return normalizedQuery;
    }
    const locationText = this.normalizeProfilePostLocation(post?.location);
    if (!locationText || locationText === 'Konum belirtilmedi') {
      return '';
    }
    return locationText;
  }

  normalizeProfilePostCaption(value) {
    return normalizeText(value, '');
  }

  normalizeProfilePostLocation(value) {
    return normalizeText(value, '');
  }

  normalizeProfilePostLocationPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const source =
      normalizeText(payload.source, '').toLowerCase() === 'mapbox'
        ? 'mapbox'
        : 'manual';
    let query = normalizeText(payload.query, '');
    let normalizedQuery = normalizeText(payload.normalizedQuery, '');
    let selectedLocation = null;

    if (payload.selectedLocation && typeof payload.selectedLocation === 'object') {
      const fullAddress = normalizeText(payload.selectedLocation.fullAddress, '');
      const name = normalizeText(payload.selectedLocation.name, '');
      const mapboxId = normalizeText(payload.selectedLocation.mapboxId, '');
      const latitude = Number(payload.selectedLocation.latitude);
      const longitude = Number(payload.selectedLocation.longitude);
      if (
        fullAddress &&
        name &&
        mapboxId &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude)
      ) {
        selectedLocation = {
          fullAddress,
          latitude,
          longitude,
          mapboxId,
          name,
        };
      }
    }

    if (source === 'mapbox' && selectedLocation) {
      if (!query) {
        query = selectedLocation.fullAddress;
      }
      if (!normalizedQuery) {
        normalizedQuery = selectedLocation.fullAddress;
      }
    }

    if (!normalizedQuery) {
      normalizedQuery = query;
    }

    if (!query && !normalizedQuery && !selectedLocation) {
      return null;
    }

    return {
      normalizedQuery,
      query,
      selectedLocation,
      source: source === 'mapbox' && selectedLocation ? 'mapbox' : 'manual',
    };
  }

  resolveProfilePostLocationInput(locationValue, locationPayload) {
    const normalizedPayload = this.normalizeProfilePostLocationPayload(locationPayload);
    let location = this.normalizeProfilePostLocation(locationValue);

    if (
      normalizedPayload &&
      normalizedPayload.source === 'mapbox' &&
      normalizedPayload.selectedLocation?.fullAddress
    ) {
      location = normalizedPayload.selectedLocation.fullAddress;
    }

    if (!location && normalizedPayload) {
      location =
        normalizedPayload.selectedLocation?.fullAddress ||
        normalizedPayload.normalizedQuery ||
        normalizedPayload.query ||
        '';
    }

    return {
      location: location || 'Konum belirtilmedi',
      locationPayload: normalizedPayload,
    };
  }

  cloneProfilePostRecord(post) {
    return {
      ...post,
      stats: {
        bookmarksCount: Number.parseInt(
          String(post?.stats?.bookmarksCount ?? 0),
          10,
        ) || 0,
        commentsCount: Number.parseInt(
          String(post?.stats?.commentsCount ?? 0),
          10,
        ) || 0,
        likesCount: Number.parseInt(String(post?.stats?.likesCount ?? 0), 10) || 0,
        sharesCount:
          Number.parseInt(String(post?.stats?.sharesCount ?? 0), 10) || 0,
      },
    };
  }

  mutateStoredPostCopies(state, postId, updater) {
    const normalizedPostId = normalizeText(postId, '');
    if (!normalizedPostId) {
      return [];
    }

    const touched = [];
    [state.posts, state.profilePosts].forEach(collection => {
      collection.forEach(item => {
        if (item.id !== normalizedPostId) {
          return;
        }
        updater(item);
        touched.push(item);
      });
    });
    return touched;
  }

  validateCreateProfilePostPayload(payload) {
    const mediaUrl = normalizeText(payload?.mediaUrl);
    if (!mediaUrl || !this.isSupportedProfilePostMediaUrl(mediaUrl)) {
      return {
        error: errorPayload('media_required', 'Gecerli medya URL gerekli.'),
      };
    }

    const rawMediaType = normalizeText(payload?.mediaType, '').toLowerCase();
    if (rawMediaType !== 'photo' && rawMediaType !== 'video') {
      return {
        error: errorPayload(
          'invalid_profile_post_media_type',
          'Medya tipi photo veya video olmalidir.',
        ),
      };
    }
    const mediaType = rawMediaType;
    const caption = this.normalizeProfilePostCaption(payload?.caption);
    if (caption.length > MAX_PROFILE_POST_CAPTION_LENGTH) {
      return {
        error: errorPayload(
          'post_caption_too_long',
          `Aciklama en fazla ${MAX_PROFILE_POST_CAPTION_LENGTH} karakter olabilir.`,
        ),
      };
    }
    if (extractProfilePostHashtags(caption).length > MAX_PROFILE_POST_HASHTAG_COUNT) {
      return {
        error: errorPayload(
          'post_hashtags_too_many',
          `Bir gonderide en fazla ${MAX_PROFILE_POST_HASHTAG_COUNT} etiket kullanabilirsin.`,
        ),
      };
    }

    const {
      location: normalizedLocation,
      locationPayload,
    } = this.resolveProfilePostLocationInput(
      payload?.location,
      payload?.locationPayload,
    );
    if (normalizedLocation.length > MAX_PROFILE_POST_LOCATION_LENGTH) {
      return {
        error: errorPayload(
          'post_location_too_long',
          `Konum en fazla ${MAX_PROFILE_POST_LOCATION_LENGTH} karakter olabilir.`,
        ),
      };
    }

    const visibility = this.normalizePostVisibility(payload?.visibility);
    return {
      caption,
      location: normalizedLocation || 'Konum belirtilmedi',
      locationPayload,
      mediaType,
      mediaUrl,
      thumbnailUrl: normalizeText(payload?.thumbnailUrl, ''),
      visibility,
    };
  }

  validateUpdateProfilePostPayload(payload) {
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload(
          'invalid_update_profile_post_payload',
          'Gecersiz gonderi guncelleme verisi.',
        ),
      };
    }

    const hasCaption = Object.prototype.hasOwnProperty.call(input, 'caption');
    const hasLocation = Object.prototype.hasOwnProperty.call(input, 'location');
    const hasLocationPayload = Object.prototype.hasOwnProperty.call(
      input,
      'locationPayload',
    );
    const hasVisibility = Object.prototype.hasOwnProperty.call(
      input,
      'visibility',
    );
    if (!hasCaption && !hasLocation && !hasLocationPayload && !hasVisibility) {
      return {
        error: errorPayload(
          'post_update_required',
          'Guncellenecek en az bir alan gonderilmelidir.',
        ),
      };
    }

    const next = {};
    if (hasCaption) {
      const caption = this.normalizeProfilePostCaption(input.caption);
      if (caption.length > MAX_PROFILE_POST_CAPTION_LENGTH) {
        return {
          error: errorPayload(
            'post_caption_too_long',
            `Aciklama en fazla ${MAX_PROFILE_POST_CAPTION_LENGTH} karakter olabilir.`,
          ),
        };
      }
      if (extractProfilePostHashtags(caption).length > MAX_PROFILE_POST_HASHTAG_COUNT) {
        return {
          error: errorPayload(
            'post_hashtags_too_many',
            `Bir gonderide en fazla ${MAX_PROFILE_POST_HASHTAG_COUNT} etiket kullanabilirsin.`,
          ),
        };
      }
      next.caption = caption;
    }

    if (hasLocation || hasLocationPayload) {
      const { location, locationPayload } = this.resolveProfilePostLocationInput(
        hasLocation ? input.location : '',
        hasLocationPayload ? input.locationPayload : null,
      );
      if (location.length > MAX_PROFILE_POST_LOCATION_LENGTH) {
        return {
          error: errorPayload(
            'post_location_too_long',
            `Konum en fazla ${MAX_PROFILE_POST_LOCATION_LENGTH} karakter olabilir.`,
          ),
        };
      }
      next.location = location || 'Konum belirtilmedi';
      next.locationPayload = locationPayload;
    }

    if (hasVisibility) {
      const rawVisibility = normalizeText(input.visibility, '');
      if (
        rawVisibility !== 'public' &&
        rawVisibility !== 'friends' &&
        rawVisibility !== 'private'
      ) {
        return {
          error: errorPayload(
            'invalid_post_visibility',
            'Gorunurluk public, friends veya private olmalidir.',
          ),
        };
      }
      next.visibility = rawVisibility;
    }

    return next;
  }

  hasBlockedUserPair(state, viewerId, otherUserId) {
    if (!viewerId || !otherUserId || viewerId === otherUserId) {
      return false;
    }
    return state.blockedUsers.some(
      b =>
        (b.blockerId === viewerId && b.blockedId === otherUserId) ||
        (b.blockerId === otherUserId && b.blockedId === viewerId),
    );
  }

  isViewerBlockedByTargetUser(state, viewerId, targetUserId) {
    if (!viewerId || !targetUserId) {
      return false;
    }
    return state.blockedUsers.some(
      b => b.blockerId === targetUserId && b.blockedId === viewerId,
    );
  }

  isViewerBlockingTargetUser(state, viewerId, targetUserId) {
    if (!viewerId || !targetUserId) {
      return false;
    }
    return state.blockedUsers.some(
      b => b.blockerId === viewerId && b.blockedId === targetUserId,
    );
  }

  sanitizePublicProfileBlockedByViewer(profile) {
    return {
      ...profile,
      bio: '',
      fullName: '',
      isPrivateAccount: true,
      stats: {
        followersCount: 0,
        followingCount: 0,
        routesCount: 0,
        streetFriendsCount: 0,
      },
      viewerState: {
        ...profile.viewerState,
        followRequestStatus: 'none',
        followsYou: false,
        isBlockedByTarget: false,
        isBlockedByViewer: true,
        isFollowing: false,
      },
    };
  }

  canViewerSeePost(state, post, viewerId) {
    if (!post || post.isLive === false) {
      return false;
    }

    const authorId = normalizeText(post.authorId || post.userId);
    if (!authorId) {
      return false;
    }

    if (viewerId && viewerId === authorId) {
      return true;
    }

    if (viewerId && this.hasBlockedUserPair(state, viewerId, authorId)) {
      return false;
    }

    const author = (state.users || []).find(user => user.id === authorId);
    const isPrivateAuthor = Boolean(author?.isPrivateAccount);
    if (isPrivateAuthor) {
      if (!viewerId) {
        return false;
      }
      return state.follows.some(
        relation =>
          relation.followerId === viewerId &&
          relation.followedUserId === authorId,
      );
    }

    const visibility = this.normalizePostVisibility(post.visibility);
    if (visibility === 'public') {
      return true;
    }

    if (!viewerId || visibility === 'private') {
      return false;
    }

    const followsAuthor = state.follows.some(
      relation =>
        relation.followerId === viewerId &&
        relation.followedUserId === authorId,
    );
    if (followsAuthor) {
      return true;
    }

    return state.streetFriends.some(
      relation =>
        relation.status === 'accepted' &&
        ((relation.userId1 === viewerId && relation.userId2 === authorId) ||
          (relation.userId1 === authorId && relation.userId2 === viewerId)),
    );
  }

  resolveAuthorPostVisibility(state, authorId, visibilityValue) {
    const normalizedAuthorId = normalizeText(authorId, '');
    const normalizedVisibility = this.normalizePostVisibility(visibilityValue);
    const author = (state.users || []).find(
      user => normalizeText(user.id, '') === normalizedAuthorId,
    );
    if (author?.isPrivateAccount) {
      return 'friends';
    }
    return normalizedVisibility;
  }

  buildProfilePostsResponse(posts, userId, limit, cursor, viewerId = userId) {
    let sorted = [...posts].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
    if (cursor) {
      const idx = sorted.findIndex(p => p.id === cursor);
      if (idx !== -1) sorted = sorted.slice(idx + 1);
    }
    const page = sorted.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const visible = hasMore ? page.slice(0, limit) : page;
    return {
      hasMore,
      nextCursor: hasMore ? visible[visible.length - 1].id : undefined,
      posts: visible.map(post => {
        const normalizedPost = {
          ...post,
          authorId: post.authorId || post.userId,
          visibility: this.normalizePostVisibility(post.visibility),
        };
        return {
          ...normalizedPost,
          viewerState: this.viewerState(normalizedPost, viewerId),
        };
      }),
      userId,
    };
  }

  isAdminHardDeleteAuthorized(req) {
    if (!this.adminPostHardDeleteToken) {
      return false;
    }
    const rawHeader = req?.headers?.['x-macradar-admin-token'];
    const provided = Array.isArray(rawHeader)
      ? String(rawHeader[0] || '').trim()
      : String(rawHeader || '').trim();
    return Boolean(provided) && provided === this.adminPostHardDeleteToken;
  }

  markEngagementTombstones(postId, reason) {
    const state = this.store.getState();
    const normalizedReason = normalizeText(reason, 'deleted');
    state.postEngagements.forEach(engagement => {
      if (engagement.postId !== postId) {
        return;
      }
      engagement.postDeletedAt = engagement.postDeletedAt || nowIso();
      if (!normalizeText(engagement.postDeletedReason, '')) {
        engagement.postDeletedReason = normalizedReason;
      }
      engagement.updatedAt = nowIso();
    });
  }

  getMyPosts(req, options = {}) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const posts = state.profilePosts.filter(
      p => p.userId === user.id && p.isLive !== false,
    );
    return this.buildProfilePostsResponse(
      posts,
      user.id,
      this.normalizeProfilePostLimit(options.limit),
      options.cursor,
      user.id,
    );
  }

  softDeleteMyPost(req, postId) {
    const user = this.requireUser(req);
    const normalizedPostId = normalizeText(postId, '');
    if (!normalizedPostId) {
      return { error: errorPayload('post_not_found', 'Gonderi bulunamadi.') };
    }

    const state = this.store.getState();
    const target = state.profilePosts.find(
      post => post.id === normalizedPostId,
    );
    if (!target) {
      return { error: errorPayload('post_not_found', 'Gonderi bulunamadi.') };
    }
    if (target.userId !== user.id) {
      return {
        error: errorPayload(
          'post_delete_forbidden',
          'Bu gonderiyi silme yetkin yok.',
        ),
      };
    }

    this.mutateStoredPostCopies(state, normalizedPostId, item => {
      item.isLive = false;
    });
    this.markEngagementTombstones(normalizedPostId, 'soft_deleted');
    this.store.save();
    return {
      deleted: true,
      mode: 'soft',
      postId: normalizedPostId,
    };
  }

  updateMyPost(req, postId, payload) {
    const user = this.requireUser(req);
    const normalizedPostId = normalizeText(postId, '');
    if (!normalizedPostId) {
      return { error: errorPayload('post_not_found', 'Gonderi bulunamadi.') };
    }

    const validated = this.validateUpdateProfilePostPayload(payload);
    if (validated.error) {
      return { error: validated.error };
    }

    const state = this.store.getState();
    const target = state.profilePosts.find(
      post => post.id === normalizedPostId && post.isLive !== false,
    );
    if (!target) {
      return { error: errorPayload('post_not_found', 'Gonderi bulunamadi.') };
    }
    if (target.userId !== user.id) {
      return {
        error: errorPayload(
          'post_edit_forbidden',
            'Bu Gönderiyi Düzenleme Yetkin Yok.',
        ),
      };
    }

    const nextVisibility =
      typeof validated.visibility === 'string'
        ? this.resolveAuthorPostVisibility(state, user.id, validated.visibility)
        : null;
    const nextSegment =
      typeof nextVisibility === 'string'
        ? this.resolveProfilePostSegment(nextVisibility)
        : target.segment || 'sizin-icin';

    this.mutateStoredPostCopies(state, normalizedPostId, item => {
      if (typeof validated.caption === 'string') {
        item.caption = validated.caption;
      }
      if (typeof validated.location === 'string') {
        item.location = validated.location;
        item.locationPayload = validated.locationPayload || undefined;
      }
      if (typeof nextVisibility === 'string') {
        item.visibility = nextVisibility;
        item.segment = nextSegment;
      }
      item.updatedAt = nowIso();
    });

    this.store.save();
    return {
      ...target,
      segment: nextSegment,
      updatedAt: target.updatedAt || nowIso(),
      visibility: this.normalizePostVisibility(target.visibility),
    };
  }

  hardDeletePostAsAdmin(req, postId) {
    this.requireUser(req);
    if (!this.isAdminHardDeleteAuthorized(req)) {
      return {
        error: errorPayload(
          'admin_hard_delete_forbidden',
          'Admin hard delete yetkisi gereklidir.',
        ),
      };
    }

    const normalizedPostId = normalizeText(postId, '');
    if (!normalizedPostId) {
      return { error: errorPayload('post_not_found', 'Gonderi bulunamadi.') };
    }

    const state = this.store.getState();
    const profileCountBefore = state.profilePosts.length;
    const feedCountBefore = state.posts.length;
    state.profilePosts = state.profilePosts.filter(
      post => post.id !== normalizedPostId,
    );
    state.posts = state.posts.filter(post => post.id !== normalizedPostId);
    const currentComments = Array.isArray(state.comments) ? state.comments : [];
    state.comments = currentComments.filter(
      comment => comment.postId !== normalizedPostId,
    );
    const removedCommentIds = new Set(
      currentComments
        .filter(comment => comment.postId === normalizedPostId)
        .map(comment => comment.id),
    );
    state.commentEngagements = (state.commentEngagements || []).filter(
      engagement => !removedCommentIds.has(engagement.commentId),
    );
    const removed =
      profileCountBefore !== state.profilePosts.length ||
      feedCountBefore !== state.posts.length;
    if (!removed) {
      return { error: errorPayload('post_not_found', 'Gonderi bulunamadi.') };
    }

    this.markEngagementTombstones(normalizedPostId, 'deleted');
    this.store.save();
    return {
      deleted: true,
      mode: 'hard',
      postId: normalizedPostId,
    };
  }

  buildEngagementCollectionPosts(state, userId, kind) {
    const flag = kind === 'liked' ? 'liked' : 'bookmarked';
    const postsById = new Map();
    (Array.isArray(state.posts) ? state.posts : []).forEach(post => {
      if (post && typeof post.id === 'string' && post.id.length > 0) {
        postsById.set(post.id, post);
      }
    });
    (Array.isArray(state.profilePosts) ? state.profilePosts : []).forEach(post => {
      if (post && typeof post.id === 'string' && post.id.length > 0) {
        postsById.set(post.id, post);
      }
    });
    const sortedEngagements = state.postEngagements
      .filter(
        engagement =>
          engagement.playerId === userId && engagement[flag] === true,
      )
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || 0).getTime();
        return rightTime - leftTime;
      });

    return sortedEngagements.map(engagement => {
      const matched = postsById.get(engagement.postId);
      if (matched) {
        const canView = this.canViewerSeePost(state, matched, userId);
        const isUnavailable = matched.isLive === false || !canView;
        return {
          ...matched,
          visibility: this.normalizePostVisibility(matched.visibility),
          ...(isUnavailable
            ? {
                caption: '',
                isUnavailable: true,
                location: '',
                mediaType: 'unavailable',
                mediaUrl: '',
                stats: {
                  bookmarksCount: 0,
                  commentsCount: 0,
                  likesCount: 0,
                  sharesCount: 0,
                },
                unavailableReason: canView ? 'soft_deleted' : 'private',
              }
            : {}),
        };
      }

      return {
        caption: '',
        createdAt: engagement.postDeletedAt || engagement.updatedAt || nowIso(),
        id: engagement.postId,
        isLive: false,
        isUnavailable: true,
        location: '',
        mediaType: 'unavailable',
        mediaUrl: '',
        visibility: 'public',
        stats: {
          bookmarksCount: 0,
          commentsCount: 0,
          likesCount: 0,
          sharesCount: 0,
        },
        unavailableReason: normalizeText(
          engagement.postDeletedReason,
          'deleted',
        ),
        userId,
        username: '',
      };
    });
  }

  createMyPost(req, payload) {
    const user = this.requireUser(req);
    const validated = this.validateCreateProfilePostPayload(payload);
    if (validated.error) {
      return { error: validated.error };
    }

    const state = this.store.getState();
    const createdAt = nowIso();
    const effectiveVisibility = this.resolveAuthorPostVisibility(
      state,
      user.id,
      validated.visibility,
    );
    const basePost = {
      authorId: user.id,
      caption: validated.caption,
      createdAt,
      id: createId('ppost'),
      isLive: true,
      location: validated.location,
      locationPayload: validated.locationPayload || undefined,
      mediaType: validated.mediaType,
      mediaUrl: validated.mediaUrl,
      segment: this.resolveProfilePostSegment(effectiveVisibility),
      stats: {
        bookmarksCount: 0,
        commentsCount: 0,
        likesCount: 0,
        sharesCount: 0,
      },
      updatedAt: createdAt,
      userId: user.id,
      username: user.username,
      visibility: effectiveVisibility,
      thumbnailUrl: validated.thumbnailUrl || undefined,
    };
    const profilePost = this.cloneProfilePostRecord(basePost);
    const feedPost = this.cloneProfilePostRecord(basePost);
    state.profilePosts.unshift(profilePost);
    state.posts.unshift(feedPost);
    const actorLabel = normalizeText(user.fullName, 'Bir kullanici');
    const followerIds = this.getFollowerIdsForUser(state, user.id);
    this.createNotificationsBatch(
      state,
      followerIds.map(followerId => ({
        actorId: user.id,
        body: `${actorLabel} yeni bir gonderi paylasti.`,
        channel: 'posts',
        metadata: {
          postId: profilePost.id,
          visibility: effectiveVisibility,
        },
        postId: profilePost.id,
        recipientId: followerId,
        title: actorLabel,
        type: 'new_post',
      })),
    );
    this.store.save();
    return profilePost;
  }

  ensureProfilePostMediaStorageDir() {
    fs.mkdirSync(POST_MEDIA_STORAGE_DIR, { recursive: true });
  }

  ensureProfilePostMediaIndex(state) {
    if (!Array.isArray(state.profilePostMediaFiles)) {
      state.profilePostMediaFiles = [];
    }
    return state.profilePostMediaFiles;
  }

  profilePostMediaPath(mediaId) {
    return `/api/v1/profile/post-media/files/${normalizeText(mediaId)}`;
  }

  profilePostMediaThumbnailPath(mediaId) {
    return `${this.profilePostMediaPath(mediaId)}/thumbnail`;
  }

  isSupportedProfilePostMediaUrl(value) {
    const normalized = normalizeText(value).toLowerCase();
    return (
      normalized.startsWith('https://') ||
      normalized.startsWith('http://') ||
      normalized.startsWith('/api/v1/profile/post-media/files/')
    );
  }

  normalizeProfilePostMediaType(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'photo') {
      return 'photo';
    }
    if (normalized === 'video') {
      return 'video';
    }
    return '';
  }

  normalizeFeedMediaType(value) {
    const normalized = normalizeText(value, '').toLowerCase();
    if (normalized === 'photo') {
      return 'photo';
    }
    // Some mobile encoders tag audio-attached videos with custom values.
    // Treat any video-like media type as video so it remains visible in Explore.
    if (normalized === 'video' || normalized.includes('video')) {
      return 'video';
    }
    return 'photo';
  }

  normalizeProfilePostMediaMimeType(value) {
    switch (normalizeText(value).toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return 'image/jpeg';
      case 'image/png':
        return 'image/png';
      case 'image/heic':
      case 'image/heif':
        return 'image/heic';
      case 'video/mp4':
        return 'video/mp4';
      case 'video/quicktime':
        return 'video/quicktime';
      default:
        return '';
    }
  }

  isProfilePostMediaTypeCompatible(mediaType, mimeType) {
    if (mediaType === 'photo') {
      return mimeType.startsWith('image/');
    }
    if (mediaType === 'video') {
      return mimeType.startsWith('video/');
    }
    return false;
  }

  profilePostMediaExtensionForMimeType(mimeType) {
    switch (mimeType) {
      case 'image/png':
        return 'png';
      case 'image/heic':
        return 'heic';
      case 'video/mp4':
        return 'mp4';
      case 'video/quicktime':
        return 'mov';
      default:
        return 'jpg';
    }
  }

  uploadProfilePostMedia(req, form) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const fields = form && typeof form === 'object' ? form.fields || {} : {};
    const files = Array.isArray(form?.files) ? form.files : [];
    const upload =
      files.find(
        item => normalizeText(item?.fieldName).toLowerCase() === 'file',
      ) || files[0];
    const thumbnailUpload = files.find(
      item => normalizeText(item?.fieldName).toLowerCase() === 'thumbnailfile',
    );
    if (!upload || !Buffer.isBuffer(upload.data) || upload.data.length === 0) {
      return {
        error: errorPayload(
          'profile_post_media_required',
          'Yuklenecek medya dosyasi gerekli.',
        ),
      };
    }

    const mediaType = this.normalizeProfilePostMediaType(fields.mediaType);
    if (!mediaType) {
      return {
        error: errorPayload(
          'invalid_profile_post_media_type',
          'Medya tipi photo veya video olmalidir.',
        ),
      };
    }

    const maxBytes =
      mediaType === 'video'
        ? MAX_PROFILE_VIDEO_UPLOAD_BYTES
        : MAX_PROFILE_PHOTO_UPLOAD_BYTES;
    if (upload.data.length > maxBytes) {
      return {
        error: errorPayload(
          'profile_post_media_too_large',
          'Gonderi medyasi izin verilen boyutu asiyor.',
        ),
      };
    }

    const mimeType = this.normalizeProfilePostMediaMimeType(upload.contentType);
    if (
      !mimeType ||
      !this.isProfilePostMediaTypeCompatible(mediaType, mimeType)
    ) {
      return {
        error: errorPayload(
          'invalid_profile_post_media_type',
          'Bu medya dosya tipi desteklenmiyor.',
        ),
      };
    }

    let thumbnailFileName = '';
    let thumbnailMimeType = '';
    let thumbnailSizeBytes = 0;
    if (mediaType === 'video' && thumbnailUpload?.data?.length > 0) {
      if (thumbnailUpload.data.length > MAX_PROFILE_VIDEO_THUMBNAIL_BYTES) {
        return {
          error: errorPayload(
            'profile_post_thumbnail_too_large',
            'Video thumbnail dosyasi izin verilen boyutu asiyor.',
          ),
        };
      }

      const normalizedThumbnailMimeType =
        this.normalizeProfilePostMediaMimeType(thumbnailUpload.contentType);
      if (
        !normalizedThumbnailMimeType ||
        !normalizedThumbnailMimeType.startsWith('image/')
      ) {
        return {
          error: errorPayload(
            'invalid_profile_post_thumbnail_type',
            'Video thumbnail dosyasi image tipinde olmalidir.',
          ),
        };
      }

      thumbnailMimeType = normalizedThumbnailMimeType;
      thumbnailSizeBytes = thumbnailUpload.data.length;
    }

    this.ensureProfilePostMediaStorageDir();
    const mediaId = createId('post_media');
    const fileName = `${mediaId}.${this.profilePostMediaExtensionForMimeType(
      mimeType,
    )}`;
    const absolutePath = path.join(POST_MEDIA_STORAGE_DIR, fileName);
    fs.writeFileSync(absolutePath, upload.data);
    if (thumbnailSizeBytes > 0 && thumbnailMimeType) {
      thumbnailFileName = `${mediaId}_thumb.${this.profilePostMediaExtensionForMimeType(
        thumbnailMimeType,
      )}`;
      const thumbnailAbsolutePath = path.join(
        POST_MEDIA_STORAGE_DIR,
        thumbnailFileName,
      );
      fs.writeFileSync(thumbnailAbsolutePath, thumbnailUpload.data);
    }

    const uploadedAt = nowIso();
    const mediaRecords = this.ensureProfilePostMediaIndex(state);
    mediaRecords.unshift({
      createdAt: uploadedAt,
      fileName,
      id: mediaId,
      mediaType,
      mimeType,
      sizeBytes: upload.data.length,
      thumbnailFileName,
      thumbnailMimeType,
      thumbnailSizeBytes,
      uploaderId: user.id,
    });
    this.store.save();

    return {
      asset: {
        id: mediaId,
        mediaType,
        mediaUrl: this.profilePostMediaPath(mediaId),
        mimeType,
        sizeBytes: upload.data.length,
        thumbnailUrl: thumbnailFileName
          ? this.profilePostMediaThumbnailPath(mediaId)
          : undefined,
        uploadedAt,
      },
    };
  }

  getProfilePostMediaFileForUser(req, mediaId, variant = 'media') {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const normalizedMediaId = normalizeText(mediaId);
    if (!normalizedMediaId) {
      return {
        error: errorPayload(
          'profile_post_media_not_found',
          'Gonderi medyasi bulunamadi.',
        ),
      };
    }

    const records = this.ensureProfilePostMediaIndex(state);
    const record = records.find(item => item.id === normalizedMediaId);
    if (!record) {
      return {
        error: errorPayload(
          'profile_post_media_not_found',
          'Gonderi medyasi bulunamadi.',
        ),
      };
    }

    const mediaUrl = this.profilePostMediaPath(normalizedMediaId);
    const post = state.profilePosts.find(
      item => item.mediaUrl === mediaUrl && item.isLive !== false,
    );
    const isUploader = normalizeText(record.uploaderId) === user.id;
    if (!isUploader && (!post || !this.canViewerSeePost(state, post, user.id))) {
      return {
        error: errorPayload(
          'profile_post_media_forbidden',
          'Bu gonderi medyasini gorme yetkin yok.',
        ),
      };
    }

    const wantsThumbnail = normalizeText(variant) === 'thumbnail';
    if (wantsThumbnail && !record.thumbnailFileName) {
      const isVideo =
        normalizeText(record.mediaType) === 'video' ||
        normalizeText(record.mimeType).toLowerCase().startsWith('video/');
      if (isVideo) {
        return {
          inlineBuffer: PROFILE_VIDEO_THUMB_PLACEHOLDER_JPEG,
          mimeType: 'image/jpeg',
        };
      }
      return {
        error: errorPayload(
          'profile_post_media_not_found',
          'Gonderi thumbnail dosyasi bulunamadi.',
        ),
      };
    }

    return {
      file: {
        absolutePath: path.join(
          POST_MEDIA_STORAGE_DIR,
          wantsThumbnail ? record.thumbnailFileName : record.fileName,
        ),
        fileName: wantsThumbnail ? record.thumbnailFileName : record.fileName,
        mimeType:
          (wantsThumbnail ? record.thumbnailMimeType : record.mimeType) ||
          'application/octet-stream',
      },
    };
  }

  getMyLikedPosts(req, options = {}) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const posts = this.buildEngagementCollectionPosts(state, user.id, 'liked');
    return this.buildProfilePostsResponse(
      posts,
      user.id,
      this.normalizeProfilePostLimit(options.limit),
      options.cursor,
      user.id,
    );
  }

  getMySavedPosts(req, options = {}) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const posts = this.buildEngagementCollectionPosts(state, user.id, 'saved');
    return this.buildProfilePostsResponse(
      posts,
      user.id,
      this.normalizeProfilePostLimit(options.limit),
      options.cursor,
      user.id,
    );
  }

  getPublicProfilePosts(req, userId, options = {}) {
    const state = this.store.getState();
    const viewerId = this.optionalUser(req)?.id || '';
    const posts = state.profilePosts.filter(
      p =>
        p.userId === userId &&
        p.isLive !== false &&
        this.canViewerSeePost(state, p, viewerId),
    );
    return this.buildProfilePostsResponse(
      posts,
      userId,
      this.normalizeProfilePostLimit(options.limit),
      options.cursor,
      viewerId,
    );
  }

  // â”€â”€â”€ Explore / Feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  feed(req, segment, options = {}) {
    const state = this.store.getState();
    const viewer = this.requireUser(req);
    const limit = this.normalizeFeedLimit(options.limit);
    const cursorState = this.decodeFeedCursor(options.cursor, segment);
    const referenceTime = cursorState?.referenceTime || new Date();

    const mergedLivePosts = new Map();
    const mergeFeedPost = rawPost => {
      if (!rawPost || rawPost.isLive === false) {
        return;
      }

      const normalizedId = normalizeText(rawPost.id);
      const normalizedAuthorId = normalizeText(
        rawPost.authorId || rawPost.userId,
      );
      if (!normalizedId || !normalizedAuthorId) {
        return;
      }

      const candidate = {
        ...rawPost,
        authorId: normalizedAuthorId,
        id: normalizedId,
        mediaType: this.normalizeFeedMediaType(rawPost.mediaType),
        segment: normalizeText(rawPost.segment, 'kesfet') || 'kesfet',
        userId: normalizeText(rawPost.userId || normalizedAuthorId),
        visibility: this.normalizePostVisibility(rawPost.visibility),
      };
      const existing = mergedLivePosts.get(normalizedId);
      if (!existing) {
        mergedLivePosts.set(normalizedId, candidate);
        return;
      }

      const existingTs = new Date(existing.createdAt || '').getTime();
      const candidateTs = new Date(candidate.createdAt || '').getTime();
      if (!Number.isFinite(existingTs) || candidateTs > existingTs) {
        mergedLivePosts.set(normalizedId, candidate);
      }
    };
    state.posts.forEach(mergeFeedPost);
    state.profilePosts.forEach(mergeFeedPost);

    const livePosts = Array.from(mergedLivePosts.values()).filter(post =>
      this.canViewerSeePost(state, post, viewer.id),
    );
    const followingIds = new Set(
      state.follows
        .filter(f => f.followerId === viewer.id)
        .map(f => f.followedUserId),
    );
    const scoredPosts = livePosts
      .filter(p => {
        const authorId = p.authorId || p.userId;
        const isFollowingAuthor = followingIds.has(authorId);
        const visibility = this.normalizePostVisibility(p.visibility);

        if (segment === 'takipte') {
          // "Takipte" only contains accounts the viewer follows.
          return isFollowingAuthor;
        }

        if (segment === 'sizin-icin') {
          // "Sizin İçin" keeps non-following discovery, public only.
          return authorId !== viewer.id && !isFollowingAuthor && visibility === 'public';
        }

        // "Keşfet" stays globally discoverable with public content.
        return visibility === 'public';
      })
      .map(p => ({
        post: p,
        rankingScore: this.calculateFeedRankingScore(p, referenceTime),
      }))
      .sort((a, b) => {
        if (b.rankingScore !== a.rankingScore)
          return b.rankingScore - a.rankingScore;
        return new Date(b.post.createdAt) - new Date(a.post.createdAt);
      });

    const filteredPosts = cursorState
      ? scoredPosts.filter(e => {
          if (e.rankingScore < cursorState.rankingScore) return true;
          if (e.rankingScore > cursorState.rankingScore) return false;
          const ca = new Date(e.post.createdAt).getTime();
          const cca = cursorState.createdAt.getTime();
          if (ca < cca) return true;
          if (ca > cca) return false;
          return e.post.id < cursorState.postId;
        })
      : scoredPosts;

    const page = filteredPosts.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const visible = hasMore ? page.slice(0, limit) : page;
    const posts = visible.map(e =>
      this.postForViewer(e.post, viewer.id, e.rankingScore),
    );

    let nextCursor = '';
    if (hasMore && visible.length > 0) {
      const last = visible[visible.length - 1];
      nextCursor = this.encodeFeedCursor({
        createdAt: new Date(last.post.createdAt),
        postId: last.post.id,
        rankVersion: 'v1-log-engagement-decay',
        rankingScore: last.rankingScore,
        referenceTime,
        segment,
      });
    }

    return {
      generatedAt: referenceTime.toISOString(),
      hasMore,
      nextCursor: nextCursor || undefined,
      posts,
      rankVersion: 'v1-log-engagement-decay',
      segment,
    };
  }

  normalizeFeedLimit(value) {
    const n = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(n) || n <= 0) return 8;
    return Math.min(n, 24);
  }

  decodeFeedCursor(rawCursor, segment) {
    const cursor = normalizeText(String(rawCursor || ''));
    if (!cursor) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      );
      if (
        !payload ||
        payload.segment !== segment ||
        payload.rankVersion !== 'v1-log-engagement-decay'
      )
        return null;
      const createdAt = new Date(payload.createdAt);
      const referenceTime = new Date(payload.referenceTime);
      if (
        Number.isNaN(createdAt.getTime()) ||
        Number.isNaN(referenceTime.getTime())
      )
        return null;
      return {
        createdAt,
        postId: payload.postId,
        rankVersion: payload.rankVersion,
        rankingScore: payload.rankingScore,
        referenceTime,
        segment: payload.segment,
      };
    } catch {
      return null;
    }
  }

  encodeFeedCursor(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  calculateFeedRankingScore(post, referenceTime) {
    const likes = Math.max(post.stats?.likesCount || 0, 0);
    const comments = Math.max(post.stats?.commentsCount || 0, 0);
    const bookmarks = Math.max(post.stats?.bookmarksCount || 0, 0);
    const shares = Math.max(post.stats?.sharesCount || 0, 0);
    const ageHours = Math.max(
      0,
      (referenceTime.getTime() - new Date(post.createdAt).getTime()) /
        3_600_000,
    );
    const score =
      Math.log1p(likes) * 1.9 +
      Math.log1p(comments) * 2.4 +
      Math.log1p(bookmarks) * 2.0 +
      Math.log1p(shares) * 2.7 +
      Math.exp(-ageHours / 18) * 3.2;
    return Number(score.toFixed(6));
  }

  // â”€â”€â”€ Comments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  comments(req, postId) {
    const state = this.store.getState();
    const viewer = this.requireUser(req);
    const viewerId = viewer.id;
    const post =
      state.posts.find(p => p.id === postId) ||
      state.profilePosts.find(p => p.id === postId);
    if (!post || !this.canViewerSeePost(state, post, viewerId)) {
      return {
        error: {
          ...errorPayload('post_access_forbidden', 'Bu gonderiyi gorme yetkin yok.'),
          status: 403,
        },
      };
    }
    const comments = state.comments
      .filter(c => c.postId === postId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(c => this.commentView(c, viewerId));
    return { comments, postId, total: comments.length };
  }

  addComment(req, postId, payload) {
    const state = this.store.getState();
    const user = this.requireUser(req);
    const post =
      state.posts.find(p => p.id === postId) ||
      state.profilePosts.find(p => p.id === postId);
    if (!post)
      return { error: errorPayload('post_not_found', 'Post bulunamadi.') };
    if (!this.canViewerSeePost(state, post, user.id)) {
      return {
        error: errorPayload('post_access_forbidden', 'Bu gonderiye yorum yapamazsin.'),
      };
    }
    const body = normalizeText(payload.text);
    if (!body)
      return { error: errorPayload('comment_required', 'Yorum bos olamaz.') };
    const comment = {
      authorId: user.id,
      body,
      createdAt: nowIso(),
      id: createId('comment'),
      likeCount: 0,
      postId,
    };
    state.comments.unshift(comment);
    this.mutateStoredPostCopies(state, postId, item => {
      item.stats.commentsCount += 1;
      item.updatedAt = nowIso();
    });
    const postAuthorId = normalizeText(post.userId || post.authorId, '');
    if (postAuthorId && postAuthorId !== user.id) {
      const actorLabel = normalizeText(user.fullName, 'Bir kullanici');
      this.createNotification(state, {
        actorId: user.id,
        body: 'gonderine yorum yapti.',
        channel: 'posts',
        commentId: comment.id,
        metadata: {
          commentId: comment.id,
          postId,
        },
        postId,
        recipientId: postAuthorId,
        title: actorLabel,
        type: 'comment',
      });
    }
    this.store.save();
    const segment =
      normalizeText(post.segment, '') ||
      this.resolveProfilePostSegment(this.normalizePostVisibility(post.visibility));
    const response = {
      comment: this.commentView(comment, user.id),
      postId,
      segment,
      stats: post.stats,
    };
    this.exploreHub.broadcast({
      comment: response.comment,
      postId,
      segment,
      stats: post.stats,
      type: 'comment.created',
    });
    return response;
  }

  toggleCommentLike(req, commentId) {
    const state = this.store.getState();
    const viewer = this.requireUser(req);

    const normalizedCommentId = normalizeText(commentId, '');
    if (!normalizedCommentId) {
      return {
        error: {
          ...errorPayload('comment_not_found', 'Yorum bulunamadi.'),
          status: 404,
        },
      };
    }

    const comment = state.comments.find(item => item.id === normalizedCommentId);
    if (!comment) {
      return {
        error: {
          ...errorPayload('comment_not_found', 'Yorum bulunamadi.'),
          status: 404,
        },
      };
    }
    const post =
      state.posts.find(item => item.id === comment.postId) ||
      state.profilePosts.find(item => item.id === comment.postId);
    if (!post || !this.canViewerSeePost(state, post, viewer.id)) {
      return {
        error: {
          ...errorPayload('post_access_forbidden', 'Bu yorumu begenemezsin.'),
          status: 403,
        },
      };
    }

    const currentEngagements = Array.isArray(state.commentEngagements)
      ? state.commentEngagements
      : [];
    const existingIndex = currentEngagements.findIndex(
      item =>
        normalizeText(item.viewerId, '') === viewer.id &&
        normalizeText(item.commentId, '') === normalizedCommentId,
    );

    if (existingIndex >= 0) {
      currentEngagements.splice(existingIndex, 1);
      comment.likeCount = Math.max(0, Number(comment.likeCount || 0) - 1);
    } else {
      currentEngagements.push({
        commentId: normalizedCommentId,
        createdAt: nowIso(),
        viewerId: viewer.id,
      });
      comment.likeCount = Math.max(0, Number(comment.likeCount || 0)) + 1;
    }

    state.commentEngagements = currentEngagements;
    this.store.save();
    return {
      comment: this.commentView(comment, viewer.id),
      postId: comment.postId,
    };
  }

  // â”€â”€â”€ Reactions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  react(req, postId, payload) {
    const state = this.store.getState();
    const viewer = this.requireUser(req);
    const post =
      state.posts.find(p => p.id === postId) ||
      state.profilePosts.find(p => p.id === postId);
    if (!post)
      return { error: errorPayload('post_not_found', 'Post bulunamadi.') };
    if (!this.canViewerSeePost(state, post, viewer.id)) {
      return {
        error: errorPayload('post_access_forbidden', 'Bu gonderiye etkilesim yapamazsin.'),
      };
    }
    const kind =
      payload.kind === 'bookmark' || payload.kind === 'share'
        ? payload.kind
        : 'like';
    let eng = state.postEngagements.find(
      e => e.playerId === viewer.id && e.postId === postId,
    );
    if (!eng) {
      eng = {
        bookmarked: false,
        liked: false,
        playerId: viewer.id,
        postId,
        sharedCount: 0,
        updatedAt: nowIso(),
      };
      state.postEngagements.push(eng);
    }
    if (kind === 'like') {
      eng.liked = !eng.liked;
      this.mutateStoredPostCopies(state, postId, item => {
        item.stats.likesCount = Math.max(
          item.stats.likesCount + (eng.liked ? 1 : -1),
          0,
        );
        item.updatedAt = nowIso();
      });
    } else if (kind === 'bookmark') {
      eng.bookmarked = !eng.bookmarked;
      this.mutateStoredPostCopies(state, postId, item => {
        item.stats.bookmarksCount = Math.max(
          item.stats.bookmarksCount + (eng.bookmarked ? 1 : -1),
          0,
        );
        item.updatedAt = nowIso();
      });
    } else {
      eng.sharedCount += 1;
      this.mutateStoredPostCopies(state, postId, item => {
        item.stats.sharesCount += 1;
        item.updatedAt = nowIso();
      });
    }
    const postAuthorId = normalizeText(post.userId || post.authorId, '');
    if (postAuthorId && postAuthorId !== viewer.id) {
      if (kind === 'like' && eng.liked) {
        const actorLabel = normalizeText(viewer.fullName, 'Bir kullanici');
        this.createNotification(state, {
          actorId: viewer.id,
          body: 'gonderini begendi.',
          channel: 'posts',
          metadata: {
            postId,
          },
          postId,
          recipientId: postAuthorId,
          title: actorLabel,
          type: 'like',
        });
      }
    }
    eng.updatedAt = nowIso();
    this.store.save();
    const segment =
      normalizeText(post.segment, '') ||
      this.resolveProfilePostSegment(this.normalizePostVisibility(post.visibility));
    const response = {
      postId,
      segment,
      stats: post.stats,
      viewerState: this.viewerState(post, viewer.id),
    };
    this.exploreHub.broadcast({
      postId,
      segment,
      stats: post.stats,
      type: 'post.updated',
      viewerState: response.viewerState,
    });
    return response;
  }

  reportPost(req, postId, payload = {}) {
    const state = this.store.getState();
    if (!Array.isArray(state.postReports)) {
      state.postReports = [];
    }
    const viewer = this.requireUser(req);
    const post =
      state.posts.find(p => p.id === postId) ||
      state.profilePosts.find(p => p.id === postId);
    if (!post) {
      return { error: errorPayload('post_not_found', 'Post bulunamadi.') };
    }

    const reason = normalizeText(payload.reason, 'other').slice(0, 120) || 'other';
    const reportedAt = nowIso();
    const existingIndex = state.postReports.findIndex(
      report => report.playerId === viewer.id && report.postId === postId,
    );

    const nextReport = {
      playerId: viewer.id,
      postId,
      reason,
      reportedAt,
      updatedAt: reportedAt,
    };

    if (existingIndex >= 0) {
      state.postReports[existingIndex] = nextReport;
    } else {
      state.postReports.unshift(nextReport);
    }

    this.store.save();
    return {
      postId,
      reason,
      reportedAt,
    };
  }

  reportUser(req, reportedUserId, payload = {}) {
    const state = this.store.getState();
    if (!Array.isArray(state.userReports)) {
      state.userReports = [];
    }
    const viewer = this.requireUser(req);
    const target = state.users.find(u => u.id === reportedUserId);
    if (!target) {
      return { error: errorPayload('user_not_found', 'Kullanici bulunamadi.') };
    }
    if (viewer.id === reportedUserId) {
      return {
        error: errorPayload('invalid_report', 'Kendini sikayet edemezsin.'),
      };
    }

    const reason = normalizeText(payload.reason, 'other').slice(0, 120) || 'other';
    const reportedAt = nowIso();
    const existingIndex = state.userReports.findIndex(
      report =>
        report.viewerId === viewer.id && report.reportedUserId === reportedUserId,
    );

    const nextReport = {
      viewerId: viewer.id,
      reportedUserId: reportedUserId,
      reason,
      reportedAt,
      updatedAt: reportedAt,
    };

    if (existingIndex >= 0) {
      state.userReports[existingIndex] = nextReport;
    } else {
      state.userReports.unshift(nextReport);
    }

    this.store.save();
    return {
      reason,
      reportedAt,
      reportedUserId: reportedUserId,
    };
  }

  // â”€â”€â”€ Follow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  follow(req, creatorId) {
    const state = this.store.getState();
    const viewer = this.requireUser(req);
    const target = state.users.find(u => u.id === creatorId);
    const targetPrivacy = target ? this.getPrivacyFor(target.id) : null;
    const key = `${viewer.id}:${creatorId}`;
    const existing = state.follows.find(
      f => `${f.followerId}:${f.followedUserId}` === key,
    );
    let isFollowing = false;

    if (existing) {
      state.follows = state.follows.filter(
        f => `${f.followerId}:${f.followedUserId}` !== key,
      );
      state.followRequests = state.followRequests.filter(
        r => !(r.requesterId === viewer.id && r.targetId === creatorId),
      );
    } else if (targetPrivacy?.isPrivateAccount) {
      const existingReq = state.followRequests.find(
        r =>
          r.requesterId === viewer.id &&
          r.targetId === creatorId &&
          r.status === 'pending',
      );
      if (!existingReq) {
        state.followRequests.push({
          createdAt: nowIso(),
          id: createId('freq'),
          requesterId: viewer.id,
          status: 'pending',
          targetId: creatorId,
        });
        this.createNotification(state, {
          actorId: viewer.id,
          body: `${normalizeText(viewer.fullName, 'Bir kullanici')} sana takip isteği gönderdi.`,
          channel: 'follow_requests',
          metadata: {
            isPrivateAccount: true,
            requesterId: viewer.id,
            targetId: creatorId,
          },
          recipientId: creatorId,
          title: 'Yeni takip isteği',
          type: 'follow.request.created',
        });
        this.emitRequestRealtimeEvent(creatorId, {
          delta: 1,
          kind: 'follow',
          reason: 'created',
          requesterId: viewer.id,
          targetId: creatorId,
          type: 'request.created',
        });
      } else {
        state.followRequests = state.followRequests.filter(
          r =>
            !(
              r.requesterId === viewer.id &&
              r.targetId === creatorId &&
              r.status === 'pending'
            ),
        );
        this.emitRequestRealtimeEvent(creatorId, {
          delta: -1,
          kind: 'follow',
          reason: 'removed',
          requesterId: viewer.id,
          targetId: creatorId,
          type: 'request.cancelled',
        });
      }
    } else {
      state.follows.push({ followedUserId: creatorId, followerId: viewer.id });
      isFollowing = true;
      this.createNotification(state, {
        actorId: viewer.id,
        body: `${normalizeText(viewer.fullName, 'Bir kullanici')} seni takip etmeye başladı.`,
        channel: 'follow_requests',
        metadata: {
          isPrivateAccount: false,
          followerId: viewer.id,
          followedUserId: creatorId,
        },
        recipientId: creatorId,
        title: 'Yeni takipçi',
        type: 'follow.started',
      });
    }

    this.store.save();
    this.exploreHub.broadcast({
      creatorId,
      type: 'creator.follow.updated',
      viewerState: { isFollowing },
    });
    return { creatorId, isFollowing };
  }

  // â”€â”€â”€ Street friends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getStreetFriends(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const accepted = state.streetFriends.filter(
      sf =>
        sf.status === 'accepted' &&
        (sf.userId1 === user.id || sf.userId2 === user.id),
    );
    const friends = accepted
      .map(sf => {
        const friendId = sf.userId1 === user.id ? sf.userId2 : sf.userId1;
        const friend = state.users.find(u => u.id === friendId);
        if (!friend) return null;
        return {
          avatarUrl: friend.avatarUrl,
          createdAt: sf.createdAt,
          fullName: friend.fullName,
          id: friend.id,
          isVerified: friend.isVerified,
          streetFriendStatus: 'accepted',
          userId: friend.id,
          username: friend.username,
        };
      })
      .filter(Boolean);
    return { friends };
  }

  removeStreetFriend(req, friendId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const normalizedFriendId =
      typeof friendId === 'string' ? friendId.trim() : '';
    const relationToRemove = state.streetFriends.find(
      streetFriend =>
        (streetFriend.userId1 === user.id &&
          streetFriend.userId2 === normalizedFriendId) ||
        (streetFriend.userId1 === normalizedFriendId &&
          streetFriend.userId2 === user.id),
    );
    const nextStreetFriends = state.streetFriends.filter(
      streetFriend =>
        !(
          (streetFriend.userId1 === user.id &&
            streetFriend.userId2 === normalizedFriendId) ||
          (streetFriend.userId1 === normalizedFriendId &&
            streetFriend.userId2 === user.id)
        ),
    );
    if (nextStreetFriends.length !== state.streetFriends.length) {
      state.streetFriends = nextStreetFriends;
      if (relationToRemove && relationToRemove.status === 'pending') {
        const isIncoming = relationToRemove.userId2 === user.id;
        this.emitRequestRealtimeEvent(isIncoming ? user.id : normalizedFriendId, {
          delta: -1,
          kind: 'street',
          reason: isIncoming ? 'rejected' : 'removed',
          requesterId: relationToRemove.userId1,
          targetId: relationToRemove.userId2,
          type: 'request.cancelled',
        });
      }
      this.store.save();
    }
    return {
      creatorId: normalizedFriendId,
      isStreetFriend: false,
      streetFriendStatus: 'none',
      userId: normalizedFriendId,
    };
  }

  getStreetFriendRequests(req) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const pending = state.streetFriends.filter(
      sf => {
        if (sf.status !== 'pending') return false;
        if (sf.userId1 !== user.id && sf.userId2 !== user.id) return false;
        const otherId = sf.userId1 === user.id ? sf.userId2 : sf.userId1;
        return !this.isBlockedEitherDirection(state, user.id, otherId);
      },
    );
    let incomingCount = 0;
    let outgoingCount = 0;
    const requests = pending
      .map(sf => {
        const otherId = sf.userId1 === user.id ? sf.userId2 : sf.userId1;
        const other = state.users.find(u => u.id === otherId);
        if (!other) return null;
        const isIncoming = sf.userId2 === user.id;
        if (isIncoming) incomingCount += 1;
        else outgoingCount += 1;
        return {
          avatarUrl: other.avatarUrl,
          fullName: other.fullName,
          id: other.id,
          isVerified: other.isVerified,
          requestedAt: sf.createdAt,
          streetFriendStatus: isIncoming
            ? 'pending_incoming'
            : 'pending_outgoing',
          userId: other.id,
          username: other.username,
        };
      })
      .filter(Boolean);
    return { incomingCount, outgoingCount, requests };
  }

  upsertStreetFriend(req, creatorId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const normalizedCreatorId =
      typeof creatorId === 'string' ? creatorId.trim() : '';
    if (!normalizedCreatorId || normalizedCreatorId === user.id) {
      return {
        creatorId: normalizedCreatorId,
        isStreetFriend: false,
        streetFriendStatus: 'none',
        userId: normalizedCreatorId,
      };
    }
    const existing = state.streetFriends.find(
      sf =>
        (sf.userId1 === user.id && sf.userId2 === normalizedCreatorId) ||
        (sf.userId1 === normalizedCreatorId && sf.userId2 === user.id),
    );
    if (existing) {
      if (existing.status === 'pending' && existing.userId2 === user.id) {
        existing.status = 'accepted';
        this.createNotification(state, {
          actorId: user.id,
          body: `${normalizeText(user.fullName, 'Bir kullanici')} Yakındakiler isteğini kabul etti.`,
          channel: 'follow_requests',
          metadata: {
            requesterId: existing.userId1,
            status: 'accepted',
            streetFriendId: existing.id,
          },
          recipientId: existing.userId1,
          title: 'Yakındakiler isteğin kabul edildi',
          type: 'street_friend.request.accepted',
        });
        this.emitRequestRealtimeEvent(user.id, {
          delta: -1,
          kind: 'street',
          reason: 'accepted',
          requesterId: existing.userId1,
          targetId: existing.userId2,
          type: 'request.resolved',
        });
        this.store.save();
        return {
          creatorId: normalizedCreatorId,
          isStreetFriend: true,
          streetFriendStatus: 'accepted',
          userId: normalizedCreatorId,
        };
      }
      if (existing.status === 'accepted') {
        return {
          creatorId: normalizedCreatorId,
          isStreetFriend: true,
          streetFriendStatus: 'accepted',
          userId: normalizedCreatorId,
        };
      }
      return {
        creatorId: normalizedCreatorId,
        isStreetFriend: false,
        streetFriendStatus:
          existing.userId1 === user.id
            ? 'pending_outgoing'
            : 'pending_incoming',
        userId: normalizedCreatorId,
      };
    }
    state.streetFriends.push({
      createdAt: nowIso(),
      id: createId('sf'),
      status: 'pending',
      userId1: user.id,
      userId2: normalizedCreatorId,
    });
    const targetPrivacy = this.getPrivacyFor(normalizedCreatorId);
    this.createNotification(state, {
      actorId: user.id,
      body: `${normalizeText(user.fullName, 'Bir kullanici')} sana Yakındakiler isteği gönderdi.`,
      channel: 'follow_requests',
      metadata: {
        isPrivateAccount: Boolean(targetPrivacy?.isPrivateAccount),
        requesterId: user.id,
        status: 'pending',
        targetId: normalizedCreatorId,
      },
      recipientId: normalizedCreatorId,
      title: 'Yeni Yakındakiler isteği',
      type: 'street_friend.request.created',
    });
    this.emitRequestRealtimeEvent(normalizedCreatorId, {
      delta: 1,
      kind: 'street',
      reason: 'created',
      requesterId: user.id,
      targetId: normalizedCreatorId,
      type: 'request.created',
    });
    this.store.save();
    return {
      creatorId: normalizedCreatorId,
      isStreetFriend: false,
      streetFriendStatus: 'pending_outgoing',
      userId: normalizedCreatorId,
    };
  }

  // â”€â”€â”€ Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  searchUsers(req, query, options = {}) {
    const state = this.store.getState();
    const requestOptions =
      typeof options === 'number' ? { limit: options } : options || {};
    const viewer = this.requireUser(req);
    const viewerId = viewer.id;
    const normalizeSearchValue = value =>
      normalizeText(value)
        .toLowerCase()
        .replace(/^@+/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0131/g, 'i')
        .replace(/\u0130/g, 'i')
        .replace(/\s+/g, ' ')
        .trim();
    const normalizedQuery = normalizeSearchValue(query);
    const queryTokens =
      normalizedQuery.length > 0 ? normalizedQuery.split(' ') : [];
    const normalizedLimit = Math.max(
      1,
      Math.min(
        Number.parseInt(String(requestOptions.limit || 20), 10) || 20,
        60,
      ),
    );
    const parsedCursor = Number.parseInt(
      normalizeText(requestOptions.cursor || '0'),
      10,
    );
    const cursorOffset =
      Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;

    const users = state.users.filter(user => {
      if (viewerId.length > 0 && user.id === viewerId) {
        return false;
      }
      if (this.isBlockedEitherDirection(state, viewerId, user.id)) {
        return false;
      }
      if (queryTokens.length === 0) {
        return true;
      }
      const normalizedUsername = normalizeSearchValue(user.username);
      const normalizedFullName = normalizeSearchValue(user.fullName);
      return queryTokens.every(
        token =>
          normalizedUsername.includes(token) ||
          normalizedFullName.includes(token),
      );
    });

    users.sort((left, right) => {
      const leftUsername = normalizeSearchValue(left.username);
      const rightUsername = normalizeSearchValue(right.username);
      const leftFullName = normalizeSearchValue(left.fullName);
      const rightFullName = normalizeSearchValue(right.fullName);
      const score = (username, fullName) => {
        if (!normalizedQuery) return 10;
        if (username === normalizedQuery) return 0;
        if (username.startsWith(normalizedQuery)) return 1;
        if (fullName === normalizedQuery) return 2;
        if (fullName.startsWith(normalizedQuery)) return 3;
        if (username.includes(normalizedQuery)) return 4;
        if (fullName.includes(normalizedQuery)) return 5;
        return 6;
      };
      const leftScore = score(leftUsername, leftFullName);
      const rightScore = score(rightUsername, rightFullName);
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.username.localeCompare(right.username, 'tr');
    });

    const shaped = users.map(user => this.userSearchShape(user, viewerId));
    if (!normalizedQuery) {
      shaped.sort((left, right) => {
        if (
          left.viewerState.isStreetFriend !== right.viewerState.isStreetFriend
        ) {
          return left.viewerState.isStreetFriend ? -1 : 1;
        }
        if (left.viewerState.isFollowing !== right.viewerState.isFollowing) {
          return left.viewerState.isFollowing ? -1 : 1;
        }
        if (left.viewerState.followsYou !== right.viewerState.followsYou) {
          return left.viewerState.followsYou ? -1 : 1;
        }
        if (left.isVerified !== right.isVerified) {
          return left.isVerified ? -1 : 1;
        }
        return left.username.localeCompare(right.username, 'tr');
      });
    }

    const page = shaped.slice(cursorOffset, cursorOffset + normalizedLimit);
    const consumed = cursorOffset + page.length;
    const hasMore = consumed < shaped.length;

    return {
      hasMore,
      nextCursor: hasMore ? String(consumed) : undefined,
      query: normalizeText(query),
      users: page,
    };
  }

  searchPosts(req, query, options = {}) {
    const state = this.store.getState();
    const requestOptions =
      typeof options === 'number' ? { limit: options } : options || {};
    const viewer = this.requireUser(req);
    const viewerId = viewer.id;
    const normalizeSearchValue = value =>
      normalizeText(value)
        .toLowerCase()
        .replace(/^[@#]+/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0131/g, 'i')
        .replace(/\u0130/g, 'i')
        .replace(/\s+/g, ' ')
        .trim();
    const normalizeTimestamp = value => {
      const timestamp = new Date(value || '').getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    };
    const toSafeStats = stats => ({
      bookmarksCount: Math.max(
        0,
        Number.parseInt(String(stats?.bookmarksCount ?? 0), 10) || 0,
      ),
      commentsCount: Math.max(
        0,
        Number.parseInt(String(stats?.commentsCount ?? 0), 10) || 0,
      ),
      likesCount: Math.max(
        0,
        Number.parseInt(String(stats?.likesCount ?? 0), 10) || 0,
      ),
      sharesCount: Math.max(
        0,
        Number.parseInt(String(stats?.sharesCount ?? 0), 10) || 0,
      ),
    });
    const extractHashtags = caption => {
      const text = normalizeText(caption, '');
      const tagPattern = /#([\p{L}\p{N}_]{2,32})/gu;
      const values = [];
      let match = tagPattern.exec(text);
      while (match) {
        const tag = normalizeSearchValue(match[1]);
        if (tag.length >= 2) {
          values.push(tag);
        }
        match = tagPattern.exec(text);
      }
      return values;
    };

    const rawQuery = normalizeText(query);
    const normalizedQuery = normalizeSearchValue(rawQuery);
    const queryTokens =
      normalizedQuery.length > 0 ? normalizedQuery.split(' ') : [];
    const isHashtagQuery =
      rawQuery.trim().startsWith('#') && normalizedQuery.length > 0;
    const isUserQuery =
      rawQuery.trim().startsWith('@') && normalizedQuery.length > 0;
    const normalizedLimit = Math.max(
      1,
      Math.min(
        Number.parseInt(String(requestOptions.limit || 20), 10) || 20,
        60,
      ),
    );
    const parsedCursor = Number.parseInt(
      normalizeText(requestOptions.cursor || '0'),
      10,
    );
    const cursorOffset =
      Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;
    const normalizedFilter =
      requestOptions.filter === 'photo' || requestOptions.filter === 'video'
        ? requestOptions.filter
        : 'all';
    const normalizedSort =
      requestOptions.sort === 'recent' || requestOptions.sort === 'popular'
        ? requestOptions.sort
        : 'relevant';

    const usersById = new Map(state.users.map(user => [user.id, user]));
    const followingIds = new Set(
      state.follows
        .filter(entry => entry.followerId === viewerId)
        .map(entry => entry.followedUserId),
    );
    const blockedByViewer = new Set(
      state.blockedUsers
        .filter(entry => entry.blockerId === viewerId)
        .map(entry => entry.blockedId),
    );
    const blockedViewer = new Set(
      state.blockedUsers
        .filter(entry => entry.blockedId === viewerId)
        .map(entry => entry.blockerId),
    );
    const streetFriendIds = new Set(
      state.streetFriends
        .filter(
          friendship =>
            friendship.status === 'accepted' &&
            (friendship.userId1 === viewerId ||
              friendship.userId2 === viewerId),
        )
        .map(friendship =>
          friendship.userId1 === viewerId
            ? friendship.userId2
            : friendship.userId1,
        ),
    );

    const mergedById = new Map();
    const mergeSourcePost = rawPost => {
      if (!rawPost || rawPost.isLive === false) {
        return;
      }
      const postId = normalizeText(rawPost.id);
      if (!postId) {
        return;
      }
      const authorId = normalizeText(rawPost.authorId || rawPost.userId);
      if (!authorId) {
        return;
      }
      const mediaType = this.normalizeFeedMediaType(rawPost.mediaType);
      const segment = normalizeText(rawPost.segment, 'kesfet') || 'kesfet';
      const candidate = {
        ...rawPost,
        authorId,
        id: postId,
        mediaType,
        segment,
        stats: toSafeStats(rawPost.stats),
        visibility: this.normalizePostVisibility(rawPost.visibility),
      };
      const existing = mergedById.get(postId);
      if (!existing) {
        mergedById.set(postId, candidate);
        return;
      }
      const existingTs = normalizeTimestamp(existing.createdAt);
      const candidateTs = normalizeTimestamp(candidate.createdAt);
      if (candidateTs > existingTs) {
        mergedById.set(postId, candidate);
      }
    };
    state.posts.forEach(mergeSourcePost);
    state.profilePosts.forEach(mergeSourcePost);

    const searchable = [];
    mergedById.forEach(post => {
      const author = usersById.get(post.authorId);
      if (!author) {
        return;
      }
      if (
        blockedByViewer.has(post.authorId) ||
        blockedViewer.has(post.authorId)
      ) {
        return;
      }
      if (!this.canViewerSeePost(state, post, viewerId)) {
        return;
      }
      const canView =
        post.authorId === viewerId ||
        !author.isPrivateAccount ||
        followingIds.has(post.authorId);
      if (!canView) {
        return;
      }

      if (normalizedFilter !== 'all' && post.mediaType !== normalizedFilter) {
        return;
      }

      const normalizedCaption = normalizeSearchValue(post.caption);
      const normalizedLocation = normalizeSearchValue(post.location);
      const normalizedAuthorUsername = normalizeSearchValue(author.username);
      const normalizedAuthorFullName = normalizeSearchValue(author.fullName);
      const normalizedTags = extractHashtags(post.caption);

        if (queryTokens.length > 0) {
          if (isHashtagQuery) {
          const hasTag = normalizedTags.some(tag => tag === normalizedQuery);
          if (!hasTag) {
            return;
          }
        } else if (isUserQuery) {
          const hasUserMatch =
            normalizedAuthorUsername.includes(normalizedQuery) ||
            normalizedAuthorFullName.includes(normalizedQuery);
          if (!hasUserMatch) {
            return;
          }
        } else {
          const matchesAllTokens = queryTokens.every(token => {
            return (
              normalizedCaption.includes(token) ||
              normalizedLocation.includes(token) ||
              normalizedAuthorUsername.includes(token) ||
              normalizedAuthorFullName.includes(token) ||
              normalizedTags.some(tag => tag.includes(token))
            );
          });
          if (!matchesAllTokens) {
            return;
          }
        }
      }

      const timestamp = normalizeTimestamp(post.createdAt);
      const postStats = toSafeStats(post.stats);
      const popularityScore =
        postStats.likesCount * 1 +
        postStats.commentsCount * 2 +
        postStats.bookmarksCount * 1.5 +
        postStats.sharesCount * 2.5;
      const freshnessScore = Math.max(0, 1_500_000_000_000 - timestamp);

      let relevanceScore = popularityScore * 1.8 - freshnessScore * 0.00000035;
        if (queryTokens.length > 0) {
          relevanceScore = 0;
          if (isHashtagQuery) {
          if (normalizedTags.some(tag => tag === normalizedQuery)) {
            relevanceScore += 180;
          }
          }
        if (isUserQuery) {
          if (normalizedAuthorUsername === normalizedQuery) {
            relevanceScore += 180;
          } else if (normalizedAuthorUsername.startsWith(normalizedQuery)) {
            relevanceScore += 140;
          } else {
            relevanceScore += 110;
          }
        }
        queryTokens.forEach(token => {
          if (normalizedCaption.includes(token)) relevanceScore += 62;
          if (normalizedLocation.includes(token)) relevanceScore += 32;
          if (normalizedAuthorUsername.includes(token)) relevanceScore += 86;
          if (normalizedAuthorFullName.includes(token)) relevanceScore += 54;
          if (normalizedTags.some(tag => tag.includes(token)))
            relevanceScore += 48;
        });
        relevanceScore += popularityScore * 0.55;
      }
      if (followingIds.has(post.authorId)) {
        relevanceScore += 24;
      }
      if (streetFriendIds.has(post.authorId)) {
        relevanceScore += 36;
      }

      searchable.push({
        popularityScore,
        post,
        rankingScore: relevanceScore,
        timestamp,
      });
    });

    searchable.sort((left, right) => {
      if (normalizedSort === 'recent') {
        if (right.timestamp !== left.timestamp) {
          return right.timestamp - left.timestamp;
        }
        return right.popularityScore - left.popularityScore;
      }
      if (normalizedSort === 'popular') {
        if (right.popularityScore !== left.popularityScore) {
          return right.popularityScore - left.popularityScore;
        }
        return right.timestamp - left.timestamp;
      }
      if (right.rankingScore !== left.rankingScore) {
        return right.rankingScore - left.rankingScore;
      }
      if (right.timestamp !== left.timestamp) {
        return right.timestamp - left.timestamp;
      }
      return right.popularityScore - left.popularityScore;
    });

    const page = searchable.slice(cursorOffset, cursorOffset + normalizedLimit);
    const consumed = cursorOffset + page.length;
    const hasMore = consumed < searchable.length;

    return {
      filter: normalizedFilter,
      hasMore,
      nextCursor: hasMore ? String(consumed) : undefined,
      posts: page.map(item =>
        this.postForViewer(item.post, viewerId, item.rankingScore),
      ),
      query: rawQuery,
      sort: normalizedSort,
    };
  }

  // â”€â”€â”€ Viewer state helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  searchTrendingTags(req, options = 12) {
    const state = this.store.getState();
    const viewer = this.requireUser(req);
    const normalizedQuery = normalizeDiscoverSearchValue(
      typeof options === 'object' ? options?.query : '',
    ).replace(/^#+/, '');
    const normalizedLimit = Math.max(
      1,
      Math.min(
        Number.parseInt(
          String(
            typeof options === 'number'
              ? options
              : options?.limit != null
              ? options.limit
              : 12,
          ),
          10,
        ) || 12,
        40,
      ),
    );
    const blockedByViewer = new Set(
      state.blockedUsers
        .filter(entry => entry.blockerId === viewer.id)
        .map(entry => entry.blockedId),
    );
    const blockedViewer = new Set(
      state.blockedUsers
        .filter(entry => entry.blockedId === viewer.id)
        .map(entry => entry.blockerId),
    );
    const mergedPostsById = new Map();
    const mergeTrendingSourcePost = sourcePost => {
      if (!sourcePost || sourcePost.isLive === false) {
        return;
      }
      const postId = normalizeText(sourcePost.id);
      if (!postId) {
        return;
      }
      const existing = mergedPostsById.get(postId);
      if (!existing) {
        mergedPostsById.set(postId, sourcePost);
        return;
      }
      const existingTs = Date.parse(existing.createdAt || '');
      const candidateTs = Date.parse(sourcePost.createdAt || '');
      if (Number.isFinite(candidateTs) && candidateTs >= existingTs) {
        mergedPostsById.set(postId, sourcePost);
      }
    };
    state.posts.forEach(mergeTrendingSourcePost);
    state.profilePosts.forEach(mergeTrendingSourcePost);
    const posts = Array.from(mergedPostsById.values());
    const usersById = new Map(state.users.map(user => [user.id, user]));
    const counts = new Map();
    const recentWindowMs = 48 * 60 * 60 * 1000;
    const nowTs = Date.now();

    posts.forEach(post => {
      if (!post?.isLive) return;

      const authorId = post.userId || post.authorId;
      const author = usersById.get(authorId);
      if (!author) return;
      if (blockedByViewer.has(authorId) || blockedViewer.has(authorId)) return;
      if (!this.canViewerSeePost(state, post, viewer.id)) return;

      const createdAtTs = Date.parse(post.createdAt || '');
      const isRecent =
        Number.isFinite(createdAtTs) && createdAtTs >= nowTs - recentWindowMs;

      extractProfilePostHashtags(post.caption).forEach(tag => {
        const current = counts.get(tag) || {
          count: 0,
          lastUsedAt: '',
          recentCount: 0,
          score: 0,
          videoCount: 0,
        };
        current.count += 1;
        if (isRecent) {
          current.recentCount += 1;
        }
        if (post.mediaType === 'video') {
          current.videoCount += 1;
        }
        if (!current.lastUsedAt || createdAtTs > Date.parse(current.lastUsedAt)) {
          current.lastUsedAt = post.createdAt || nowIso();
        }
        current.score = current.recentCount * 3 + current.count + current.videoCount * 2;
        counts.set(tag, current);
      });
    });

    const rankedTags = Array.from(counts.entries())
      .sort((left, right) => {
        if (right[1].recentCount !== left[1].recentCount) {
          return right[1].recentCount - left[1].recentCount;
        }
        if (right[1].score !== left[1].score) {
          return right[1].score - left[1].score;
        }
        const rightLastUsedAt = Date.parse(right[1].lastUsedAt || '');
        const leftLastUsedAt = Date.parse(left[1].lastUsedAt || '');
        if (rightLastUsedAt !== leftLastUsedAt) {
          return rightLastUsedAt - leftLastUsedAt;
        }
        return left[0].localeCompare(right[0], 'tr');
      })
      .map(([tag, value]) => ({
        count: value.count,
        lastUsedAt: value.lastUsedAt,
        recentCount: value.recentCount,
        score: value.score,
        tag,
        videoCount: value.videoCount,
      }));

    const matchScore = tag => {
      if (!normalizedQuery) {
        return 0;
      }
      if (tag === normalizedQuery) {
        return 3;
      }
      if (tag.startsWith(normalizedQuery)) {
        return 2;
      }
      if (tag.includes(normalizedQuery)) {
        return 1;
      }
      return 0;
    };

    const tags = (normalizedQuery
      ? rankedTags.filter(item => item.tag.includes(normalizedQuery))
      : rankedTags
    )
      .sort((left, right) => {
        if (normalizedQuery) {
          const scoreDiff = matchScore(right.tag) - matchScore(left.tag);
          if (scoreDiff !== 0) {
            return scoreDiff;
          }
        }
        if (right.recentCount !== left.recentCount) {
          return right.recentCount - left.recentCount;
        }
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (right.videoCount !== left.videoCount) {
          return right.videoCount - left.videoCount;
        }
        const rightLastUsedAt = Date.parse(right.lastUsedAt || '');
        const leftLastUsedAt = Date.parse(left.lastUsedAt || '');
        if (rightLastUsedAt !== leftLastUsedAt) {
          return rightLastUsedAt - leftLastUsedAt;
        }
        return left.tag.localeCompare(right.tag, 'tr');
      })
      .slice(0, normalizedLimit);

    return {
      generatedAt: nowIso(),
      tags,
    };
  }

  getTagDetail(req, rawTag, options = {}) {
    const state = this.store.getState();
    const viewer = this.requireUser(req);
    const viewerId = viewer.id;
    const normalizedTag = normalizeDiscoverSearchValue(
      normalizeText(rawTag).replace(/^#+/, ''),
    );
    if (!/^[a-z0-9_]{2,32}$/.test(normalizedTag)) {
      return {
        error: errorPayload('invalid_tag', 'Etiket gecersiz.'),
      };
    }

    const requestOptions = options || {};
    const normalizedLimit = Math.max(
      1,
      Math.min(Number.parseInt(String(requestOptions.limit || 18), 10) || 18, 40),
    );
    const parsedCursor = Number.parseInt(
      normalizeText(requestOptions.cursor || '0'),
      10,
    );
    const cursorOffset =
      Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;
    const usersById = new Map(state.users.map(user => [user.id, user]));
    const followingIds = new Set(
      state.follows
        .filter(entry => entry.followerId === viewerId)
        .map(entry => entry.followedUserId),
    );
    const blockedByViewer = new Set(
      state.blockedUsers
        .filter(entry => entry.blockerId === viewerId)
        .map(entry => entry.blockedId),
    );
    const blockedViewer = new Set(
      state.blockedUsers
        .filter(entry => entry.blockedId === viewerId)
        .map(entry => entry.blockerId),
    );
    const mergedById = new Map();
    const mergeSourcePost = rawPost => {
      if (!rawPost || rawPost.isLive === false) {
        return;
      }
      const postId = normalizeText(rawPost.id);
      if (!postId) {
        return;
      }
      const authorId = normalizeText(rawPost.authorId || rawPost.userId);
      if (!authorId) {
        return;
      }
      const mediaType = this.normalizeFeedMediaType(rawPost.mediaType);
      const segment = normalizeText(rawPost.segment, 'kesfet') || 'kesfet';
      const candidate = {
        ...rawPost,
        authorId,
        id: postId,
        mediaType,
        segment,
        stats: {
          bookmarksCount: Math.max(
            0,
            Number.parseInt(String(rawPost?.stats?.bookmarksCount ?? 0), 10) || 0,
          ),
          commentsCount: Math.max(
            0,
            Number.parseInt(String(rawPost?.stats?.commentsCount ?? 0), 10) || 0,
          ),
          likesCount: Math.max(
            0,
            Number.parseInt(String(rawPost?.stats?.likesCount ?? 0), 10) || 0,
          ),
          sharesCount: Math.max(
            0,
            Number.parseInt(String(rawPost?.stats?.sharesCount ?? 0), 10) || 0,
          ),
        },
        visibility: this.normalizePostVisibility(rawPost.visibility),
      };
      const existing = mergedById.get(postId);
      if (!existing) {
        mergedById.set(postId, candidate);
        return;
      }
      const existingTs = new Date(existing.createdAt || '').getTime();
      const candidateTs = new Date(candidate.createdAt || '').getTime();
      if (candidateTs > existingTs) {
        mergedById.set(postId, candidate);
      }
    };
    state.posts.forEach(mergeSourcePost);
    state.profilePosts.forEach(mergeSourcePost);

    const matches = [];
    const relatedTagCounts = new Map();
    const recentWindowMs = 48 * 60 * 60 * 1000;
    const nowTs = Date.now();
    let totalCount = 0;
    let recentCount = 0;
    let lastUsedAt = '';

    mergedById.forEach(post => {
      const author = usersById.get(post.authorId);
      if (!author) {
        return;
      }
      if (
        blockedByViewer.has(post.authorId) ||
        blockedViewer.has(post.authorId) ||
        !this.canViewerSeePost(state, post, viewerId)
      ) {
        return;
      }

      const canView =
        post.authorId === viewerId ||
        !author.isPrivateAccount ||
        followingIds.has(post.authorId);
      if (!canView) {
        return;
      }

      const normalizedTags = extractProfilePostHashtags(post.caption);
      if (!normalizedTags.includes(normalizedTag)) {
        return;
      }

      const timestamp = new Date(post.createdAt || '').getTime();
      const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
      const postStats = {
        bookmarksCount: Math.max(
          0,
          Number.parseInt(String(post?.stats?.bookmarksCount ?? 0), 10) || 0,
        ),
        commentsCount: Math.max(
          0,
          Number.parseInt(String(post?.stats?.commentsCount ?? 0), 10) || 0,
        ),
        likesCount: Math.max(
          0,
          Number.parseInt(String(post?.stats?.likesCount ?? 0), 10) || 0,
        ),
        sharesCount: Math.max(
          0,
          Number.parseInt(String(post?.stats?.sharesCount ?? 0), 10) || 0,
        ),
      };
      const popularityScore =
        postStats.likesCount * 1 +
        postStats.commentsCount * 2 +
        postStats.bookmarksCount * 1.5 +
        postStats.sharesCount * 2.5;

      totalCount += 1;
      if (safeTimestamp >= nowTs - recentWindowMs) {
        recentCount += 1;
      }
      if (!lastUsedAt || safeTimestamp > Date.parse(lastUsedAt || '')) {
        lastUsedAt = post.createdAt || nowIso();
      }

      normalizedTags.forEach(tag => {
        if (!tag || tag === normalizedTag) {
          return;
        }
        const current = relatedTagCounts.get(tag) || {
          count: 0,
          lastUsedAt: '',
          recentCount: 0,
          score: 0,
        };
        current.count += 1;
        if (safeTimestamp >= nowTs - recentWindowMs) {
          current.recentCount += 1;
        }
        if (!current.lastUsedAt || safeTimestamp > Date.parse(current.lastUsedAt || '')) {
          current.lastUsedAt = post.createdAt || nowIso();
        }
        current.score = current.recentCount * 3 + current.count;
        relatedTagCounts.set(tag, current);
      });

      matches.push({
        popularityScore,
        post,
        timestamp: safeTimestamp,
      });
    });

    const topPosts = [...matches]
      .sort((left, right) => {
        const leftVideoBoost = left.post.mediaType === 'video' ? 20 : 0;
        const rightVideoBoost = right.post.mediaType === 'video' ? 20 : 0;
        const leftScore = left.popularityScore + leftVideoBoost;
        const rightScore = right.popularityScore + rightVideoBoost;
        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }
        if (right.popularityScore !== left.popularityScore) {
          return right.popularityScore - left.popularityScore;
        }
        return right.timestamp - left.timestamp;
      })
      .slice(0, 9)
      .map(item => this.postForViewer(item.post, viewerId, item.popularityScore));

    const recentSorted = [...matches].sort((left, right) => {
      if (right.timestamp !== left.timestamp) {
        return right.timestamp - left.timestamp;
      }
      return right.popularityScore - left.popularityScore;
    });
    const recentPage = recentSorted.slice(cursorOffset, cursorOffset + normalizedLimit);
    const recentConsumed = cursorOffset + recentPage.length;
    const recentHasMore = recentConsumed < recentSorted.length;
    const relatedTags = Array.from(relatedTagCounts.entries())
      .sort((left, right) => {
        if (right[1].recentCount !== left[1].recentCount) {
          return right[1].recentCount - left[1].recentCount;
        }
        if (right[1].score !== left[1].score) {
          return right[1].score - left[1].score;
        }
        const rightLastUsedAt = Date.parse(right[1].lastUsedAt || '');
        const leftLastUsedAt = Date.parse(left[1].lastUsedAt || '');
        if (rightLastUsedAt !== leftLastUsedAt) {
          return rightLastUsedAt - leftLastUsedAt;
        }
        return left[0].localeCompare(right[0], 'tr');
      })
      .slice(0, 8)
      .map(([tag, value]) => ({
        count: value.count,
        lastUsedAt: value.lastUsedAt,
        recentCount: value.recentCount,
        score: value.score,
        tag,
      }));

    return {
      generatedAt: nowIso(),
      recentHasMore,
      recentNextCursor: recentHasMore ? String(recentConsumed) : undefined,
      recentPosts: recentPage.map(item =>
        this.postForViewer(item.post, viewerId, item.popularityScore),
      ),
      relatedTags,
      tag: {
        count: totalCount,
        lastUsedAt: lastUsedAt || new Date(0).toISOString(),
        recentCount,
        score: recentCount * 3 + totalCount,
        tag: normalizedTag,
      },
      topPosts,
    };
  }

  viewerState(post, viewerId) {
    const state = this.store.getState();
    const eng = state.postEngagements.find(
      e => e.playerId === viewerId && e.postId === post.id,
    );
    const isFollowing = state.follows.some(
      f => f.followerId === viewerId && f.followedUserId === post.authorId,
    );
    const sf = state.streetFriends.find(
      s =>
        s.status === 'accepted' &&
        ((s.userId1 === viewerId && s.userId2 === post.authorId) ||
          (s.userId1 === post.authorId && s.userId2 === viewerId)),
    );
    const frReq = state.followRequests.find(
      r =>
        r.requesterId === viewerId &&
        r.targetId === post.authorId &&
        r.status === 'pending',
    );
    return {
      followRequestStatus: frReq ? 'pending_outgoing' : 'none',
      isBookmarked: Boolean(eng?.bookmarked),
      isFollowing,
      isLiked: Boolean(eng?.liked),
      isStreetFriend: Boolean(sf),
      streetFriendStatus: sf
        ? 'accepted'
        : state.streetFriends.find(
            s =>
              s.status === 'pending' &&
              s.userId1 === viewerId &&
              s.userId2 === post.authorId,
          )
        ? 'pending_outgoing'
        : 'none',
    };
  }

  postForViewer(post, viewerId, rankingScore = 0) {
    const state = this.store.getState();
    const author = state.users.find(u => u.id === post.authorId);
    const resolvedLocation = this.resolvePostLocationLabel(post);
    return {
      author: {
        avatarUrl: author?.avatarUrl || '',
        id: author?.id || post.authorId,
        isVerified: author?.isVerified || false,
        username: author?.username || 'unknown',
      },
      caption: post.caption,
      createdAt: post.createdAt,
      id: post.id,
      location: resolvedLocation,
      mediaType: post.mediaType,
      mediaUrl: post.mediaUrl,
      visibility: this.normalizePostVisibility(post.visibility),
      rankingScore,
      segment: post.segment,
      stats: post.stats,
      viewerState: this.viewerState(post, viewerId),
    };
  }

  commentView(comment, viewerId = '') {
    const state = this.store.getState();
    const author = state.users.find(u => u.id === comment.authorId);
    const normalizedViewerId = normalizeText(viewerId, '');
    const isLiked =
      normalizedViewerId.length > 0 &&
      (state.commentEngagements || []).some(
        engagement =>
          normalizeText(engagement.viewerId, '') === normalizedViewerId &&
          normalizeText(engagement.commentId, '') === comment.id,
      );
    return {
      author: {
        avatarUrl: author?.avatarUrl || '',
        id: author?.id || comment.authorId,
        isVerified: author?.isVerified || false,
        username: author?.username || 'unknown',
      },
      body: comment.body,
      createdAt: comment.createdAt,
      id: comment.id,
      isLiked,
      likeCount: comment.likeCount,
      postId: comment.postId,
    };
  }
  // â”€â”€â”€ Messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ensureVoiceStorageDirectory() {
    fs.mkdirSync(VOICE_STORAGE_DIR, { recursive: true });
  }

  normalizeVoiceMimeType(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'audio/aac') {
      return 'audio/aac';
    }
    if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') {
      return 'audio/mpeg';
    }
    if (
      normalized === 'audio/mp4' ||
      normalized === 'audio/m4a' ||
      normalized === 'audio/x-m4a'
    ) {
      return 'audio/mp4';
    }
    return '';
  }

  voiceFileExtensionForMimeType(mimeType) {
    if (mimeType === 'audio/aac') {
      return 'aac';
    }
    if (mimeType === 'audio/mpeg') {
      return 'mp3';
    }
    return 'm4a';
  }

  normalizeVoiceWaveform(input) {
    if (!Array.isArray(input)) {
      return [];
    }

    const normalized = input
      .map(value => Number.parseFloat(String(value)))
      .filter(value => Number.isFinite(value))
      .map(value => Math.min(1, Math.max(0, value)))
      .slice(0, 256);

    return normalized.length > 0 ? normalized : [];
  }

  resolveConversationForMember(state, conversationId, userId) {
    const normalizedConversationId = normalizeText(conversationId);
    if (!normalizedConversationId) {
      return null;
    }
    return state.conversations.find(
      conversation =>
        conversation.id === normalizedConversationId &&
        (conversation.userId1 === userId || conversation.userId2 === userId),
    );
  }

  uploadVoiceMessage(req, payload) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const input = this.normalizePayload(payload);
    if (!input) {
      return {
        error: errorPayload('invalid_request', 'Gecersiz voice mesaj istegi.'),
      };
    }

    const conversationId = normalizeText(input.conversationId);
    const conversation = this.resolveConversationForMember(
      state,
      conversationId,
      user.id,
    );
    if (!conversation) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }

    const normalizedMimeType = this.normalizeVoiceMimeType(input.mimeType);
    if (!normalizedMimeType) {
      return {
        error: errorPayload(
          'invalid_voice_mime_type',
          'Ses dosya tipi desteklenmiyor.',
        ),
      };
    }

    const rawBase64 = normalizeText(input.base64)
      .replace(/^data:[^;]+;base64,/i, '')
      .replace(/\s+/g, '');
    if (!rawBase64) {
      return {
        error: errorPayload('invalid_voice_payload', 'Ses verisi bos olamaz.'),
      };
    }

    let fileBuffer;
    try {
      fileBuffer = Buffer.from(rawBase64, 'base64');
    } catch {
      return {
        error: errorPayload(
          'invalid_voice_payload',
          'Ses verisi cozumlenemedi.',
        ),
      };
    }
    if (!fileBuffer || fileBuffer.length === 0) {
      return {
        error: errorPayload(
          'invalid_voice_payload',
          'Ses verisi cozumlenemedi.',
        ),
      };
    }
    if (fileBuffer.length > MAX_VOICE_MESSAGE_BYTES) {
      return {
        error: errorPayload(
          'voice_payload_too_large',
          `Ses dosyasi en fazla ${Math.floor(
            MAX_VOICE_MESSAGE_BYTES / (1024 * 1024),
          )} MB olabilir.`,
        ),
      };
    }

    const parsedDurationSec = Number.parseInt(
      String(input.durationSec || MIN_VOICE_DURATION_SEC),
      10,
    );
    const durationSec = Number.isFinite(parsedDurationSec)
      ? Math.min(
          MAX_VOICE_DURATION_SEC,
          Math.max(MIN_VOICE_DURATION_SEC, parsedDurationSec),
        )
      : MIN_VOICE_DURATION_SEC;
    const waveform = this.normalizeVoiceWaveform(input.waveform);

    this.ensureVoiceStorageDirectory();
    const voiceMessageId = createId('voice');
    const extension = this.voiceFileExtensionForMimeType(normalizedMimeType);
    const fileName = `${voiceMessageId}.${extension}`;
    const absolutePath = path.join(VOICE_STORAGE_DIR, fileName);
    const relativePath = path.join('voice', 'messages', fileName);
    fs.writeFileSync(absolutePath, fileBuffer);

    const voiceMessage = {
      conversationId: conversation.id,
      createdAt: nowIso(),
      durationSec,
      fileName,
      id: voiceMessageId,
      mimeType: normalizedMimeType,
      relativePath,
      sizeBytes: fileBuffer.length,
      uploaderId: user.id,
      waveform,
    };
    state.voiceMessages.push(voiceMessage);
    this.store.save();

    return {
      voiceMessage: {
        conversationId: voiceMessage.conversationId,
        createdAt: voiceMessage.createdAt,
        durationSec: voiceMessage.durationSec,
        fileName: voiceMessage.fileName,
        id: voiceMessage.id,
        mimeType: voiceMessage.mimeType,
        sizeBytes: voiceMessage.sizeBytes,
        url: `/api/v1/messages/voice/files/${encodeURIComponent(
          voiceMessage.id,
        )}`,
        waveform: Array.isArray(voiceMessage.waveform)
          ? voiceMessage.waveform
          : [],
      },
    };
  }

  getVoiceMessageFileForUser(req, voiceMessageId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const normalizedVoiceMessageId = normalizeText(voiceMessageId);
    if (!normalizedVoiceMessageId) {
      return {
        error: errorPayload('voice_not_found', 'Ses mesaji bulunamadi.'),
      };
    }
    const voiceMessage = state.voiceMessages.find(
      item => item.id === normalizedVoiceMessageId,
    );
    if (!voiceMessage) {
      return {
        error: errorPayload('voice_not_found', 'Ses mesaji bulunamadi.'),
      };
    }
    const conversation = this.resolveConversationForMember(
      state,
      voiceMessage.conversationId,
      user.id,
    );
    if (!conversation) {
      return {
        error: errorPayload(
          'voice_access_forbidden',
          'Bu ses mesajina erisim izniniz yok.',
        ),
      };
    }

    const absolutePath = path.join(VOICE_STORAGE_DIR, voiceMessage.fileName);
    if (!fs.existsSync(absolutePath)) {
      return {
        error: errorPayload('voice_not_found', 'Ses dosyasi bulunamadi.'),
      };
    }

    return {
      file: {
        absolutePath,
        fileName: voiceMessage.fileName,
        mimeType: voiceMessage.mimeType || 'audio/mp4',
        sizeBytes: Number.isFinite(voiceMessage.sizeBytes)
          ? voiceMessage.sizeBytes
          : fs.statSync(absolutePath).size,
      },
    };
  }

  // ensure a conversation exist or return null
  getConversation(userId, peerId) {
    const state = this.store.getState();
    const existing = state.conversations.find(
      c =>
        (c.userId1 === userId && c.userId2 === peerId) ||
        (c.userId1 === peerId && c.userId2 === userId),
    );
    return existing;
  }

  ensureChatRequestsCollection(state) {
    if (!Array.isArray(state.chatRequests)) {
      state.chatRequests = [];
    }
    return state.chatRequests;
  }

  isFollowingUser(state, followerId, followedUserId) {
    const normalizedFollowerId = normalizeText(followerId);
    const normalizedFollowedUserId = normalizeText(followedUserId);
    if (!normalizedFollowerId || !normalizedFollowedUserId) {
      return false;
    }
    return state.follows.some(
      relation =>
        relation.followerId === normalizedFollowerId &&
        relation.followedUserId === normalizedFollowedUserId,
    );
  }

  isUserBlocked(state, blockerId, blockedId) {
    const normalizedBlockerId = normalizeText(blockerId);
    const normalizedBlockedId = normalizeText(blockedId);
    if (!normalizedBlockerId || !normalizedBlockedId) {
      return false;
    }
    return state.blockedUsers.some(
      relation =>
        relation.blockerId === normalizedBlockerId &&
        relation.blockedId === normalizedBlockedId,
    );
  }

  isBlockedEitherDirection(state, leftUserId, rightUserId) {
    return (
      this.isUserBlocked(state, leftUserId, rightUserId) ||
      this.isUserBlocked(state, rightUserId, leftUserId)
    );
  }

  findConversationChatRequest(state, conversationId) {
    const normalizedConversationId = normalizeText(conversationId);
    if (!normalizedConversationId) {
      return null;
    }
    return (
      this.ensureChatRequestsCollection(state).find(
        request => request.conversationId === normalizedConversationId,
      ) || null
    );
  }

  upsertConversationChatRequest(
    state,
    conversation,
    requesterId,
    recipientId,
    status = 'pending',
  ) {
    const normalizedRequesterId = normalizeText(requesterId);
    const normalizedRecipientId = normalizeText(recipientId);
    const nextStatus = CHAT_REQUEST_STATUSES.has(status) ? status : 'pending';
    if (!conversation || !normalizedRequesterId || !normalizedRecipientId) {
      return null;
    }

    const requests = this.ensureChatRequestsCollection(state);
    const now = nowIso();
    let request = requests.find(item => item.conversationId === conversation.id);
    if (!request) {
      request = {
        conversationId: conversation.id,
        createdAt: now,
        id: createId('chatreq'),
        recipientId: normalizedRecipientId,
        requesterId: normalizedRequesterId,
        respondedAt: nextStatus === 'pending' ? '' : now,
        status: nextStatus,
        updatedAt: now,
      };
      requests.push(request);
      return request;
    }

    request.requesterId = normalizedRequesterId;
    request.recipientId = normalizedRecipientId;
    request.status = nextStatus;
    request.updatedAt = now;
    request.respondedAt = nextStatus === 'pending' ? '' : now;
    return request;
  }

  resolveConversationMessagingAccess(state, conversation, viewerId) {
    const peerId = this.resolveConversationPeerId(conversation, viewerId);
    const viewerFollowsPeer = this.isFollowingUser(state, viewerId, peerId);
    const isPeerBlockedByViewer = this.isUserBlocked(state, viewerId, peerId);
    const isViewerBlockedByPeer = this.isUserBlocked(state, peerId, viewerId);
    const peerMessagingSettings = this.getMessagingSettingsForUser(state, peerId);
    const request = this.findConversationChatRequest(state, conversation?.id);
    const requestStatus = request
      ? CHAT_REQUEST_STATUSES.has(request.status)
        ? request.status
        : 'pending'
      : 'none';
    const requestSatisfiedByFollow = Boolean(
      request &&
        this.isFollowingUser(state, request.requesterId, request.recipientId),
    );
    const requestDirection = request
      ? request.requesterId === viewerId
        ? 'outgoing'
        : request.recipientId === viewerId
          ? 'incoming'
          : 'none'
      : 'none';

    let messagingMode = 'direct';
    let canSendMessage = true;
    let messagingHint = '';
    let normalizedRequestStatus = requestStatus;

    if (isPeerBlockedByViewer || isViewerBlockedByPeer || requestStatus === 'blocked') {
      messagingMode = 'blocked';
      canSendMessage = false;
      messagingHint = isPeerBlockedByViewer
        ? 'Bu kullaniciyi engelledin. Engeli kaldirmadan mesaj gonderemezsin.'
        : 'Bu kullanici seni engelledi. Mesaj gonderemezsin.';
      normalizedRequestStatus = 'blocked';
    } else if (viewerFollowsPeer || requestStatus === 'accepted' || requestSatisfiedByFollow) {
      messagingMode = 'direct';
      canSendMessage = true;
      normalizedRequestStatus =
        requestStatus === 'accepted' || requestSatisfiedByFollow
          ? 'accepted'
          : 'none';
    } else if (requestStatus === 'pending') {
      messagingMode =
        requestDirection === 'incoming'
          ? 'request_pending_incoming'
          : 'request_pending_outgoing';
      canSendMessage = false;
      messagingHint =
        requestDirection === 'incoming'
          ? 'Mesaj istegini kabul etmeden cevap veremezsin.'
          : 'Mesaj istegi gonderildi. Kabul edilene kadar yeni mesaj gonderemezsin.';
    } else if (requestStatus === 'rejected') {
      messagingMode = 'request_rejected';
      canSendMessage = false;
      messagingHint = 'Mesaj istegi reddedildi. Takip etmeden yeniden mesaj gonderemezsin.';
    } else if (peerMessagingSettings.onlyFollowedUsersCanMessage) {
      messagingMode = 'restricted';
      canSendMessage = false;
      messagingHint = 'Bu kullanici sadece takip ettiklerinden mesaj kabul ediyor.';
    } else {
      messagingMode = 'request_required';
      canSendMessage = true;
      messagingHint = 'Ilk mesajin mesaj istegi olarak gonderilir.';
    }

    return {
      canSendMessage,
      chatRequestDirection: requestDirection,
      chatRequestStatus: normalizedRequestStatus,
      isMessageRequest:
        normalizedRequestStatus === 'pending' && requestDirection === 'incoming',
      isPeerBlockedByViewer,
      isViewerBlockedByPeer,
      messagingHint,
      messagingMode,
      peerAllowsOnlyFollowedMessages: Boolean(
        peerMessagingSettings.onlyFollowedUsersCanMessage,
      ),
      peerId,
      request,
      viewerFollowsPeer,
    };
  }

  appendConversationMessage(state, conversation, senderId, text, clientNonce = '') {
    const createdAt = nowIso();
    const storedMessage = {
      clientNonce: clientNonce || undefined,
      conversationId: conversation.id,
      createdAt,
      id: createId('msg'),
      senderId,
      text,
    };
    state.messages.push(storedMessage);
    conversation.lastMessage = text;
    conversation.lastMessageAt = createdAt;

    const senderState = this.getConversationUserState(
      state,
      conversation.id,
      senderId,
      true,
    );
    senderState.deletedAt = '';
    senderState.lastReadAt = createdAt;
    senderState.lastReadMessageId = storedMessage.id;
    senderState.updatedAt = createdAt;

    const peerId = this.resolveConversationPeerId(conversation, senderId);
    const peerState = this.getConversationUserState(
      state,
      conversation.id,
      peerId,
      true,
    );
    peerState.deletedAt = '';
    peerState.updatedAt = createdAt;

    if (conversation.userId1 === senderId) {
      conversation.unreadCount2 += 1;
    } else {
      conversation.unreadCount1 += 1;
    }

    return storedMessage;
  }

  resolveConversationPeerId(conversation, userId) {
    if (!conversation) {
      return '';
    }
    if (conversation.userId1 === userId) {
      return normalizeText(conversation.userId2);
    }
    if (conversation.userId2 === userId) {
      return normalizeText(conversation.userId1);
    }
    return '';
  }

  enrichConversationMessageForViewer(message, viewerId) {
    const normalizedViewerId = normalizeText(viewerId);
    if (!message || !normalizedViewerId) {
      return null;
    }

    return enrichConversationMessage({
      body: message.text,
      clientNonce: normalizeText(message.clientNonce) || undefined,
      conversationId: message.conversationId,
      createdAt: message.createdAt,
      id: message.id,
      isMine: message.senderId === normalizedViewerId,
      senderId: message.senderId,
    });
  }

  emitConversationMessageCreated(conversation, message) {
    if (!this.messagesHub || !conversation || !message) {
      return;
    }

    [conversation.userId1, conversation.userId2].forEach(userId => {
      const enrichedMessage = this.enrichConversationMessageForViewer(
        message,
        userId,
      );
      if (!enrichedMessage) {
        return;
      }

      this.messagesHub.sendToUser(userId, {
        conversationId: conversation.id,
        message: enrichedMessage,
        serverTime: nowIso(),
        type: 'message.created',
      });
    });
  }

  emitConversationRead(
    conversation,
    readerId,
    lastReadAt,
    lastReadMessageId,
    unreadCount,
  ) {
    if (!this.messagesHub || !conversation) {
      return;
    }

    const peerId = this.resolveConversationPeerId(conversation, readerId);
    if (!peerId) {
      return;
    }

    this.messagesHub.sendToUser(peerId, {
      conversationId: conversation.id,
      fromUserId: readerId,
      lastReadAt,
      messageId: lastReadMessageId,
      serverTime: nowIso(),
      type: 'message.read',
      unreadCount,
    });
  }

  emitConversationRequestUpdated(conversation, actorId, peerId, status) {
    if (!this.messagesHub || !conversation) {
      return;
    }
    const normalizedActorId = normalizeText(actorId);
    const normalizedPeerId = normalizeText(peerId);
    const normalizedStatus = normalizeText(status);
    if (!normalizedActorId || !normalizedPeerId || !normalizedStatus) {
      return;
    }

    const payload = {
      conversationId: conversation.id,
      eventId: `mreq:update:${conversation.id}:${normalizedStatus}:${Date.now()}`,
      fromUserId: normalizedActorId,
      peerUserId: normalizedPeerId,
      serverTime: nowIso(),
      status: normalizedStatus,
      type: 'message.request.updated',
    };
    this.messagesHub.sendToUser(normalizedActorId, payload);
    this.messagesHub.sendToUser(normalizedPeerId, payload);

    const normalizedConversationStatus = normalizeText(status, 'unknown');
    const isResolved =
      normalizedConversationStatus === 'accepted' ||
      normalizedConversationStatus === 'rejected';
    if (!isResolved) {
      return;
    }
    const eventType =
      normalizedConversationStatus === 'accepted'
        ? 'message_request.resolved'
        : 'message_request.cancelled';
    const reason =
      normalizedConversationStatus === 'accepted' ? 'accepted' : 'rejected';
    const requestDeltaPayload = {
      conversationId: conversation.id,
      eventId: `mreq:${eventType}:${conversation.id}:${Date.now()}`,
      fromUserId: normalizedPeerId,
      peerUserId: normalizedActorId,
      requestDelta: -1,
      requestReason: reason,
      serverTime: nowIso(),
      status: normalizedConversationStatus,
      type: eventType,
    };
    this.messagesHub.sendToUser(normalizedActorId, requestDeltaPayload);
    this.messagesHub.sendToUser(normalizedPeerId, requestDeltaPayload);
  }

  emitConversationRequestRemoved(conversation, actorId, peerId) {
    if (!this.messagesHub || !conversation) {
      return;
    }
    const normalizedActorId = normalizeText(actorId);
    const normalizedPeerId = normalizeText(peerId);
    if (!normalizedActorId || !normalizedPeerId) {
      return;
    }
    const payload = {
      conversationId: conversation.id,
      eventId: `mreq:message_request.cancelled:${conversation.id}:${Date.now()}`,
      fromUserId: normalizedPeerId,
      peerUserId: normalizedActorId,
      requestDelta: -1,
      requestReason: 'removed',
      serverTime: nowIso(),
      status: 'removed',
      type: 'message_request.cancelled',
    };
    this.messagesHub.sendToUser(normalizedActorId, payload);
    this.messagesHub.sendToUser(normalizedPeerId, payload);
  }

  forwardTypingEvent(userId, payload) {
    if (!this.messagesHub) {
      return false;
    }

    const state = this.store.getState();
    const conversationId = normalizeText(payload?.conversationId);
    const conversation = this.resolveConversationForMember(
      state,
      conversationId,
      userId,
    );
    if (!conversation) {
      return false;
    }

    const peerId = this.resolveConversationPeerId(conversation, userId);
    if (!peerId) {
      return false;
    }

    this.messagesHub.sendToUser(peerId, {
      conversationId: conversation.id,
      fromUserId: userId,
      isTyping: Boolean(payload?.isTyping),
      serverTime: nowIso(),
      type: 'typing',
    });
    return true;
  }

  getConversationUserState(
    state,
    conversationId,
    userId,
    createIfMissing = false,
  ) {
    if (!Array.isArray(state.conversationUserStates)) {
      state.conversationUserStates = [];
    }
    const normalizedConversationId = normalizeText(conversationId);
    const normalizedUserId = normalizeText(userId);
    if (!normalizedConversationId || !normalizedUserId) {
      return null;
    }
    let item = state.conversationUserStates.find(
      entry =>
        entry.conversationId === normalizedConversationId &&
        entry.userId === normalizedUserId,
    );
    if (!item && createIfMissing) {
      item = {
        clearedAt: '',
        conversationId: normalizedConversationId,
        deletedAt: '',
        isMuted: false,
        lastReadAt: '',
        lastReadMessageId: '',
        updatedAt: nowIso(),
        userId: normalizedUserId,
      };
      state.conversationUserStates.push(item);
    }
    return item || null;
  }

  parseTimestamp(value) {
    const stamp = new Date(normalizeText(value)).getTime();
    return Number.isFinite(stamp) ? stamp : 0;
  }

  conversationCutoffStamp(state, conversationId, userId) {
    const userState = this.getConversationUserState(
      state,
      conversationId,
      userId,
      false,
    );
    if (!userState) {
      return 0;
    }
    const clearedAt = this.parseTimestamp(userState.clearedAt);
    const deletedAt = this.parseTimestamp(userState.deletedAt);
    return Math.max(clearedAt, deletedAt);
  }

  isConversationVisibleForUser(state, conversation, userId) {
    const userState = this.getConversationUserState(
      state,
      conversation.id,
      userId,
      false,
    );
    if (!userState || !normalizeText(userState.deletedAt)) {
      return true;
    }
    const deletedAtStamp = this.parseTimestamp(userState.deletedAt);
    const lastMessageStamp = this.parseTimestamp(conversation.lastMessageAt);
    return lastMessageStamp > deletedAtStamp;
  }

  createConversation(req, payload) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const recipientId = normalizeText(payload.recipientId);
    const initialMessage = normalizeText(payload.initialMessage);
    if (!recipientId || recipientId === user.id) {
      return {
        error: errorPayload('invalid_recipient', 'Gecerli bir alici secmelisin.'),
      };
    }
    const recipient = state.users.find(candidate => candidate.id === recipientId);
    if (!recipient) {
      return {
        error: errorPayload('user_not_found', 'Kullanici bulunamadi.'),
      };
    }

    const isBlockedByViewer = this.isUserBlocked(state, user.id, recipientId);
    const isBlockedByRecipient = this.isUserBlocked(state, recipientId, user.id);
    if (isBlockedByViewer || isBlockedByRecipient) {
      return {
        error: errorPayload(
          'blocked_relationship',
          isBlockedByViewer
            ? 'Bu kullaniciyi engelledigin icin mesaj gonderemezsin.'
            : 'Bu kullanici sana mesaj kabul etmiyor.',
        ),
      };
    }

    const existingConversation = this.getConversation(user.id, recipientId);
    let conv = existingConversation;
    if (!conv) {
      conv = {
        id: createId('conv'),
        lastMessage: '',
        lastMessageAt: nowIso(),
        userId1: user.id,
        userId2: recipientId,
        unreadCount1: 0,
        unreadCount2: 0,
      };
      state.conversations.push(conv);
    }
    if (this.isFollowingUser(state, user.id, recipientId)) {
      this.upsertConversationChatRequest(
        state,
        conv,
        user.id,
        recipientId,
        'accepted',
      );
    }
    const messaging = this.resolveConversationMessagingAccess(state, conv, user.id);
    if (initialMessage && !messaging.canSendMessage) {
      if (!existingConversation) {
        state.conversations = state.conversations.filter(item => item.id !== conv.id);
      }
      return {
        error: errorPayload(
          messaging.messagingMode === 'request_rejected'
            ? 'message_request_rejected'
            : messaging.messagingMode === 'restricted'
              ? 'messages_limited_to_following'
              : 'message_request_pending',
          messaging.messagingHint || 'Mesaj gonderilemiyor.',
        ),
      };
    }

    const viewerConversationState = this.getConversationUserState(
      state,
      conv.id,
      user.id,
      true,
    );
    viewerConversationState.deletedAt = '';
    viewerConversationState.updatedAt = nowIso();
    const peerConversationState = this.getConversationUserState(
      state,
      conv.id,
      recipientId,
      true,
    );
    peerConversationState.deletedAt = '';
    peerConversationState.updatedAt = nowIso();

    let createdMessage = null;
    let storedMessage = null;
    let shouldPersist = true;
    let didCreatePendingRequest = false;
    let pendingRequestEventId = '';
    if (initialMessage) {
      if (messaging.messagingMode === 'request_required') {
        const requestBefore = this.findConversationChatRequest(state, conv.id);
        const hadPendingRequest =
          requestBefore && normalizeText(requestBefore.status) === 'pending';
        const requestAfterUpsert = this.upsertConversationChatRequest(
          state,
          conv,
          user.id,
          recipientId,
          'pending',
        );
        didCreatePendingRequest = !hadPendingRequest;
        if (didCreatePendingRequest) {
          pendingRequestEventId = `mreq:create:${normalizeText(requestAfterUpsert?.id, conv.id)}`;
        }
      }
      storedMessage = this.appendConversationMessage(
        state,
        conv,
        user.id,
        initialMessage,
      );
      createdMessage = this.enrichConversationMessageForViewer(
        storedMessage,
        user.id,
      );
    }

    if (storedMessage) {
      const actorLabel = normalizeText(user.fullName, 'Bir kullanici');
      this.createNotification(state, {
        actorId: user.id,
        body: 'sana yeni bir mesaj gonderdi.',
        channel: 'messages',
        conversationId: conv.id,
        messageId: storedMessage.id,
        metadata: {
          conversationId: conv.id,
          messageId: storedMessage.id,
        },
        recipientId: recipientId,
        title: actorLabel,
        type: 'message',
      });
    }
    const summary = this.formatConversationSummary(conv, user.id);
    if (shouldPersist) {
      this.store.save();
    }
    if (storedMessage) {
      this.emitConversationMessageCreated(conv, storedMessage);
    }
    if (didCreatePendingRequest && this.messagesHub) {
      const payload = {
        conversationId: conv.id,
        eventId: pendingRequestEventId || `mreq:create:${conv.id}:${Date.now()}`,
        fromUserId: user.id,
        peerUserId: recipientId,
        requestDelta: 1,
        requestReason: 'pending',
        serverTime: nowIso(),
        status: 'pending',
        type: 'message_request.created',
      };
      this.messagesHub.sendToUser(user.id, payload);
      this.messagesHub.sendToUser(recipientId, payload);
    }
    return {
      conversation: summary,
      conversationId: summary.conversationId,
      message: createdMessage || undefined,
    };
  }

  formatConversationSummary(conv, viewerId) {
    const state = this.store.getState();
    const peerId = conv.userId1 === viewerId ? conv.userId2 : conv.userId1;
    const peer = state.users.find(u => u.id === peerId);
    const unreadCount =
      conv.userId1 === viewerId ? conv.unreadCount1 : conv.unreadCount2;
    const messaging = this.resolveConversationMessagingAccess(state, conv, viewerId);
    const viewerConversationState = this.getConversationUserState(
      state,
      conv.id,
      viewerId,
      false,
    );
    const peerConversationState = this.getConversationUserState(
      state,
      conv.id,
      peerId,
      false,
    );
    return enrichConversationSummary({
      canSendMessage: messaging.canSendMessage,
      chatRequestDirection: messaging.chatRequestDirection,
      chatRequestStatus: messaging.chatRequestStatus,
      conversationId: conv.id,
      isMessageRequest: messaging.isMessageRequest,
      isMuted: Boolean(viewerConversationState?.isMuted),
      isPeerBlockedByViewer: messaging.isPeerBlockedByViewer,
      isUnread: unreadCount > 0,
      isViewerBlockedByPeer: messaging.isViewerBlockedByPeer,
      lastMessage: conv.lastMessage,
      lastMessageAt: conv.lastMessageAt,
      lastMessagePreview:
        normalizeText(conv.lastMessage).length > 0
          ? undefined
          : messaging.messagingMode === 'request_required'
            ? 'Ilk mesajini yaz'
            : messaging.messagingMode === 'restricted'
              ? messaging.messagingHint
              : 'Yeni sohbet',
      messagingHint: messaging.messagingHint,
      messagingMode: messaging.messagingMode,
      peerLastReadAt: normalizeText(peerConversationState?.lastReadAt) || null,
      peerLastReadMessageId: normalizeText(
        peerConversationState?.lastReadMessageId,
      ),
      peer: {
        avatarUrl: peer ? peer.avatarUrl : '',
        fullName: peer ? peer.fullName : 'Bilinmeyen Kullanici',
        id: peerId,
        isVerified: peer ? peer.isVerified : false,
        username: peer ? peer.username : 'unknown',
      },
      unreadCount,
    });
  }

  normalizeConversationLimit(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 36;
    }
    return Math.min(parsed, 80);
  }

  normalizeConversationMessageLimit(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 40;
    }
    return Math.min(parsed, 120);
  }

  fetchConversations(req, options) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const normalizeSearchValue = value =>
      normalizeText(value)
        .toLowerCase()
        .replace(/^@+/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u0131]/g, 'i')
        .replace(/[\u00e7]/g, 'c')
        .replace(/[\u011f]/g, 'g')
        .replace(/[\u00f6]/g, 'o')
        .replace(/[\u015f]/g, 's')
        .replace(/[\u00fc]/g, 'u')
        .replace(/\s+/g, ' ')
        .trim();
    const query = normalizeSearchValue(options.search);
    const queryTokens = query.length > 0 ? query.split(' ') : [];

    let convs = state.conversations
      .filter(c => c.userId1 === user.id || c.userId2 === user.id)
      .filter(c => this.isConversationVisibleForUser(state, c, user.id))
      .map(c => this.formatConversationSummary(c, user.id));

    if (queryTokens.length > 0) {
      convs = convs.filter(c => {
        const normalizedUsername = normalizeSearchValue(c.peer.username);
        const normalizedFullName = normalizeSearchValue(c.peer.fullName);
        return queryTokens.every(
          token =>
            normalizedUsername.includes(token) ||
            normalizedFullName.includes(token),
        );
      });
    }
    if (options.unreadOnly) {
      convs = convs.filter(c => c.isUnread);
    }
    if (options.requestsOnly) {
      convs = convs.filter(c => c.isMessageRequest);
    }

    convs.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime(),
    );

    const limit = this.normalizeConversationLimit(options.limit);
    const cursor = normalizeText(options.cursor);
    if (cursor) {
      const cursorIndex = convs.findIndex(
        item => item.conversationId === cursor,
      );
      if (cursorIndex !== -1) {
        convs = convs.slice(cursorIndex + 1);
      }
    }
    const page = convs.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const visible = hasMore ? page.slice(0, limit) : page;

    return {
      conversations: visible,
      hasMore,
      nextCursor: hasMore
        ? visible[visible.length - 1].conversationId
        : undefined,
    };
  }

  fetchConversationMessages(req, conversationId, options) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = this.resolveConversationForMember(
      state,
      conversationId,
      user.id,
    );
    if (!conv) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }
    const cutOffStamp = this.conversationCutoffStamp(state, conv.id, user.id);
    let msgs = state.messages.filter(
      m =>
        m.conversationId === conv.id &&
        this.parseTimestamp(m.createdAt) > cutOffStamp,
    );
    msgs.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const limit = this.normalizeConversationMessageLimit(options.limit);
    const cursor = normalizeText(options.cursor);
    if (cursor) {
      const cursorIndex = msgs.findIndex(item => item.id === cursor);
      if (cursorIndex !== -1) {
        msgs = msgs.slice(cursorIndex + 1);
      }
    }
    const page = msgs.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const visible = hasMore ? page.slice(0, limit) : page;

    return {
      conversationId: conv.id,
      messages: visible.map(m =>
        enrichConversationMessage({
          body: m.text,
          clientNonce: normalizeText(m.clientNonce) || undefined,
          conversationId: m.conversationId,
          createdAt: m.createdAt,
          id: m.id,
          isMine: m.senderId === user.id,
          senderId: m.senderId,
        }),
      ),
      hasMore,
      nextCursor: hasMore ? visible[visible.length - 1].id : undefined,
    };
  }

  sendConversationMessage(req, conversationId, payload) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = state.conversations.find(
      c =>
        c.id === conversationId &&
        (c.userId1 === user.id || c.userId2 === user.id),
    );
    if (!conv) return { error: errorPayload('not_found', 'Sohbet bulunamadi') };

    const text = normalizeText(payload.text);
    const clientNonce = normalizeText(payload.clientNonce);
    if (!text)
      return { error: errorPayload('invalid_request', 'Mesaj bos olamaz') };

    if (clientNonce) {
      const existing = state.messages.find(
        message =>
          message.conversationId === conversationId &&
          message.senderId === user.id &&
          normalizeText(message.clientNonce) === clientNonce,
      );
      if (existing) {
        return {
          message: this.enrichConversationMessageForViewer(existing, user.id),
        };
      }
    }

    const peerId = this.resolveConversationPeerId(conv, user.id);
    if (this.isFollowingUser(state, user.id, peerId)) {
      this.upsertConversationChatRequest(state, conv, user.id, peerId, 'accepted');
    }
    const messaging = this.resolveConversationMessagingAccess(state, conv, user.id);
    if (!messaging.canSendMessage) {
      const code =
        messaging.messagingMode === 'restricted'
          ? 'messages_limited_to_following'
          : messaging.messagingMode === 'request_rejected'
            ? 'message_request_rejected'
            : messaging.messagingMode === 'blocked'
              ? 'blocked_relationship'
              : 'message_request_pending';
      return {
        error: errorPayload(code, messaging.messagingHint || 'Mesaj gonderilemiyor.'),
      };
    }

    if (messaging.messagingMode === 'request_required') {
      this.upsertConversationChatRequest(
        state,
        conv,
        user.id,
        peerId,
        'pending',
      );
    }

    const msg = this.appendConversationMessage(
      state,
      conv,
      user.id,
      text,
      clientNonce,
    );

    const actorLabel = normalizeText(user.fullName, 'Bir kullanici');
    this.createNotification(state, {
      actorId: user.id,
      body: 'sana yeni bir mesaj gonderdi.',
      channel: 'messages',
      conversationId: conv.id,
      messageId: msg.id,
      metadata: {
        conversationId: conv.id,
        messageId: msg.id,
      },
      recipientId: peerId,
      title: actorLabel,
      type: 'message',
    });
    this.store.save();
    const responseMessage = this.enrichConversationMessageForViewer(
      msg,
      user.id,
    );
    const summary = this.formatConversationSummary(conv, user.id);
    this.emitConversationMessageCreated(conv, msg);

    return {
      conversation: summary,
      conversationId: conv.id,
      message: responseMessage,
    };
  }

  acceptConversationRequest(req, conversationId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = this.resolveConversationForMember(state, conversationId, user.id);
    if (!conv) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }

    const request = this.findConversationChatRequest(state, conv.id);
    if (!request || request.status !== 'pending' || request.recipientId !== user.id) {
      return {
        error: errorPayload(
          'conversation_request_not_actionable',
          'Bu mesaj istegi artik islenebilir degil.',
        ),
      };
    }

    const acceptedAt = nowIso();
    request.status = 'accepted';
    request.updatedAt = acceptedAt;
    request.respondedAt = acceptedAt;
    this.store.save();
    this.emitConversationRequestUpdated(
      conv,
      user.id,
      request.requesterId,
      'accepted',
    );

    return {
      acceptedAt,
      conversation: this.formatConversationSummary(conv, user.id),
      conversationId: conv.id,
    };
  }

  rejectConversationRequest(req, conversationId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = this.resolveConversationForMember(state, conversationId, user.id);
    if (!conv) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }

    const request = this.findConversationChatRequest(state, conv.id);
    if (!request || request.status !== 'pending' || request.recipientId !== user.id) {
      return {
        error: errorPayload(
          'conversation_request_not_actionable',
          'Bu mesaj istegi artik islenebilir degil.',
        ),
      };
    }

    const rejectedAt = nowIso();
    state.chatRequests = this.ensureChatRequestsCollection(state).filter(
      item => item.id !== request.id,
    );

    const recipientState = this.getConversationUserState(
      state,
      conv.id,
      user.id,
      true,
    );
    recipientState.clearedAt = rejectedAt;
    recipientState.deletedAt = rejectedAt;
    recipientState.updatedAt = rejectedAt;
    if (conv.userId1 === user.id) {
      conv.unreadCount1 = 0;
    } else {
      conv.unreadCount2 = 0;
    }
    this.clearConversationMessageNotifications(state, user.id, conv.id);

    this.store.save();
    this.emitConversationRequestRemoved(conv, user.id, request.requesterId);
    return {
      conversation: this.formatConversationSummary(conv, request.requesterId),
      conversationId: conv.id,
      rejectedAt,
    };
  }

  markConversationRead(req, conversationId, payload = {}) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = this.resolveConversationForMember(
      state,
      conversationId,
      user.id,
    );
    if (!conv) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }

    const userState = this.getConversationUserState(
      state,
      conv.id,
      user.id,
      true,
    );
    const previousLastReadAt = normalizeText(userState.lastReadAt);
    const previousLastReadMessageId = normalizeText(
      userState.lastReadMessageId,
    );
    const requestedLastReadMessageId = normalizeText(payload?.messageId);
    const hasRequestedMessageId =
      requestedLastReadMessageId.length > 0 &&
      state.messages.some(
        message =>
          message.conversationId === conv.id &&
          message.id === requestedLastReadMessageId,
      );
    const nextLastReadMessageId = hasRequestedMessageId
      ? requestedLastReadMessageId
      : previousLastReadMessageId;
    const previousUnreadCount =
      conv.userId1 === user.id ? conv.unreadCount1 : conv.unreadCount2;
    const shouldResetUnread = previousUnreadCount > 0;
    const shouldUpdateMessageId =
      nextLastReadMessageId !== previousLastReadMessageId;

    if (!shouldResetUnread && !shouldUpdateMessageId) {
      return {
        conversationId: conv.id,
        lastReadAt: previousLastReadAt || nowIso(),
        lastReadMessageId: previousLastReadMessageId,
        unreadCount: 0,
      };
    }

    const lastReadAt = nowIso();
    userState.lastReadAt = lastReadAt;
    userState.lastReadMessageId = nextLastReadMessageId;
    userState.updatedAt = lastReadAt;
    if (conv.userId1 === user.id) {
      conv.unreadCount1 = 0;
    } else {
      conv.unreadCount2 = 0;
    }
    this.store.save();
    this.emitConversationRead(
      conv,
      user.id,
      lastReadAt,
      nextLastReadMessageId,
      0,
    );
    return {
      conversationId: conv.id,
      lastReadAt,
      lastReadMessageId: nextLastReadMessageId,
      unreadCount: 0,
    };
  }

  setConversationMuted(req, conversationId, payload) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = this.resolveConversationForMember(
      state,
      conversationId,
      user.id,
    );
    if (!conv) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }

    const muted =
      payload && typeof payload.muted === 'boolean'
        ? payload.muted
        : !this.getConversationUserState(state, conv.id, user.id, false)
            ?.isMuted;
    const userState = this.getConversationUserState(
      state,
      conv.id,
      user.id,
      true,
    );
    userState.isMuted = muted;
    userState.updatedAt = nowIso();
    this.store.save();
    return {
      conversationId: conv.id,
      muted,
    };
  }

  clearConversationMessages(req, conversationId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = this.resolveConversationForMember(
      state,
      conversationId,
      user.id,
    );
    if (!conv) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }

    const now = nowIso();
    const userState = this.getConversationUserState(
      state,
      conv.id,
      user.id,
      true,
    );
    userState.clearedAt = now;
    userState.deletedAt = '';
    userState.updatedAt = now;

    if (conv.userId1 === user.id) {
      conv.unreadCount1 = 0;
    } else {
      conv.unreadCount2 = 0;
    }

    this.store.save();
    return {
      clearedAt: now,
      conversationId: conv.id,
      unreadCount: 0,
    };
  }

  deleteConversationForUser(req, conversationId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = this.resolveConversationForMember(
      state,
      conversationId,
      user.id,
    );
    if (!conv) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }

    const now = nowIso();
    const userState = this.getConversationUserState(
      state,
      conv.id,
      user.id,
      true,
    );
    userState.clearedAt = now;
    userState.deletedAt = now;
    userState.updatedAt = now;

    if (conv.userId1 === user.id) {
      conv.unreadCount1 = 0;
    } else {
      conv.unreadCount2 = 0;
    }

    this.store.save();
    return {
      conversationId: conv.id,
      deleted: true,
      mode: 'self',
    };
  }

  hardDeleteConversationForAll(req, conversationId) {
    const user = this.requireUser(req);
    const state = this.store.getState();
    const conv = this.resolveConversationForMember(
      state,
      conversationId,
      user.id,
    );
    if (!conv) {
      return {
        error: errorPayload('conversation_not_found', 'Sohbet bulunamadi.'),
      };
    }

    const conversationIdKey = conv.id;
    state.conversations = state.conversations.filter(
      item => item.id !== conversationIdKey,
    );
    state.messages = state.messages.filter(
      item => item.conversationId !== conversationIdKey,
    );
    state.conversationUserStates = state.conversationUserStates.filter(
      item => item.conversationId !== conversationIdKey,
    );
    this.ensureChatRequestsCollection(state);
    state.chatRequests = state.chatRequests.filter(
      item => item.conversationId !== conversationIdKey,
    );
    if (Array.isArray(state.voiceMessages)) {
      state.voiceMessages = state.voiceMessages.filter(voiceMessage => {
        const belongsToConversation =
          voiceMessage.conversationId === conversationIdKey;
        if (belongsToConversation) {
          try {
            const voicePath = path.join(
              VOICE_STORAGE_DIR,
              normalizeText(voiceMessage.fileName),
            );
            if (
              voicePath.startsWith(VOICE_STORAGE_DIR) &&
              fs.existsSync(voicePath)
            ) {
              fs.unlinkSync(voicePath);
            }
          } catch {}
        }
        return !belongsToConversation;
      });
    }

    this.store.save();
    return {
      conversationId: conversationIdKey,
      deleted: true,
      mode: 'hard',
    };
  }
}

module.exports = { MacRadarBackend };
