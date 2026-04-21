const fs = require('node:fs');
const path = require('node:path');

const seeds = require('../data/seeds');
const { createDemoCommunitySeed } = require('../data/demo-seed');

const STORE_PATH = process.env.NODE_STORE_PATH
  ? path.resolve(process.env.NODE_STORE_PATH)
  : path.join(__dirname, '..', 'data', 'local-store.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class LocalStore {
  constructor() {
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(STORE_PATH)) {
      const initialState = clone(seeds);
      this.ensurePasswordSeed(initialState);
      this.ensureMissingCollections(initialState);
      this.cleanupDeprecatedNotificationData(initialState);
      this.ensureDemoCommunitySeed(initialState);
      fs.writeFileSync(STORE_PATH, JSON.stringify(initialState, null, 2));
      return initialState;
    }

    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    this.ensurePasswordSeed(parsed);
    this.ensureMissingCollections(parsed);
    this.cleanupDeprecatedNotificationData(parsed);
    this.ensureDemoCommunitySeed(parsed);
    fs.writeFileSync(STORE_PATH, JSON.stringify(parsed, null, 2));
    return parsed;
  }

  // Ensure all new collections exist on existing store files
  ensureMissingCollections(state) {
    if (!Array.isArray(state.appSettings)) {
      state.appSettings = clone(seeds.appSettings);
    }
    if (!Array.isArray(state.blockedUsers)) {
      state.blockedUsers = [];
    }
    if (!Array.isArray(state.chatRequests)) {
      state.chatRequests = [];
    }
    if (!Array.isArray(state.followRequests)) {
      state.followRequests = [];
    }
    if (!Array.isArray(state.mapPreferences)) {
      state.mapPreferences = clone(seeds.mapPreferences);
    }
    if (!Array.isArray(state.notifications)) {
      state.notifications = [];
    }
    if (!Array.isArray(state.passwordResetCodes)) {
      state.passwordResetCodes = [];
    }
    if (!Array.isArray(state.privacySettings)) {
      state.privacySettings = clone(seeds.privacySettings);
    }
    if (!Array.isArray(state.profilePosts)) {
      state.profilePosts = clone(seeds.profilePosts);
    }
    if (!Array.isArray(state.posts)) {
      state.posts = clone(seeds.posts);
    }
    if (!Array.isArray(state.comments)) {
      state.comments = clone(seeds.comments);
    }
    if (!Array.isArray(state.postEngagements)) {
      state.postEngagements = clone(seeds.postEngagements);
    }
    if (!Array.isArray(state.commentEngagements)) {
      state.commentEngagements = [];
    }
    if (!Array.isArray(state.profilePostMediaFiles)) {
      state.profilePostMediaFiles = clone(seeds.profilePostMediaFiles);
    }
    if (!Array.isArray(state.streetFriends)) {
      state.streetFriends = clone(seeds.streetFriends);
    }
    if (!Array.isArray(state.conversations)) {
      state.conversations = [];
    }
    if (!Array.isArray(state.conversationUserStates)) {
      state.conversationUserStates = [];
    }
    if (!Array.isArray(state.messages)) {
      state.messages = [];
    }
    if (!Array.isArray(state.voiceMessages)) {
      state.voiceMessages = [];
    }
    if (!Array.isArray(state.verificationCodes)) {
      state.verificationCodes = [];
    }
    for (const settings of state.appSettings) {
      if (typeof settings.onlyFollowedUsersCanMessage !== 'boolean') {
        settings.onlyFollowedUsersCanMessage = false;
      }
    }
    // Ensure birthYear on existing users
    for (const user of state.users) {
      if (typeof user.birthYear !== 'number') {
        user.birthYear = 1994;
      }
    }
  }

  cleanupDeprecatedNotificationData(state) {
    if (!Array.isArray(state.notifications)) {
      state.notifications = [];
      return;
    }

    state.notifications = state.notifications.filter(item => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const type = String(item.type || '').trim().toLowerCase();
      const title = String(item.title || '').trim().toLowerCase();
      const metadata =
        item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      const metadataKind = String(metadata.kind || '').trim().toLowerCase();

      return type !== 'demo' && metadataKind !== 'demo' && title !== 'test bildirimi';
    });
  }

  ensurePasswordSeed(state) {
    const { hashPassword } = require('./utils');
    for (const user of state.users) {
      if (!user.passwordHash && user.id === 'user_viewer_local') {
        user.passwordHash = hashPassword('secret123');
      }
    }
  }

  ensureDemoCommunitySeed(state) {
    const demoSeedEnabled = ['1', 'true', 'yes', 'on'].includes(
      String(process.env.NODE_ENABLE_DEMO_SEED || '')
        .trim()
        .toLowerCase(),
    );
    if (!demoSeedEnabled) {
      return;
    }

    const hasAnyLiveExploreContent =
      state.posts.some(post => post && post.isLive !== false) ||
      state.profilePosts.some(post => post && post.isLive !== false);
    if (hasAnyLiveExploreContent) {
      return;
    }

    const demoSeed = createDemoCommunitySeed();
    const mergeByKey = (target, incoming, getKey) => {
      const seen = new Set(
        target.map(item => String(getKey(item) || '')).filter(Boolean),
      );
      incoming.forEach(item => {
        const key = String(getKey(item) || '');
        if (!key || seen.has(key)) {
          return;
        }
        seen.add(key);
        target.push(clone(item));
      });
    };

    mergeByKey(state.users, demoSeed.users, item => item?.id);
    mergeByKey(
      state.privacySettings,
      demoSeed.privacySettings,
      item => item?.userId,
    );
    mergeByKey(state.appSettings, demoSeed.appSettings, item => item?.userId);
    mergeByKey(state.follows, demoSeed.follows, item => item?.id);
    mergeByKey(state.streetFriends, demoSeed.streetFriends, item => item?.id);
    mergeByKey(state.posts, demoSeed.posts, item => item?.id);
    mergeByKey(state.profilePosts, demoSeed.profilePosts, item => item?.id);
  }

  save() {
    fs.writeFileSync(STORE_PATH, JSON.stringify(this.state, null, 2));
  }

  getState() {
    return this.state;
  }
}

module.exports = {
  LocalStore,
  STORE_PATH,
};
