const http = require('node:http');
const { Buffer } = require('node:buffer');

const HOST = process.env.GO_HOST || '127.0.0.1';
const PORT = process.env.GO_PORT || process.env.PORT || '8090';

function request({ path, method = 'GET', headers = {}, body = null, timeoutMs = 4000 }) {
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
          resolve({
            statusCode: response.statusCode || 0,
            body: raw,
          });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Request timeout for ${method} ${path}`));
    });

    if (hasBody) {
      req.write(payload);
    }
    req.end();
  });
}

function parseJson(rawBody, label) {
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
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(response.statusCode)) {
    throw new Error(`${label} failed (${response.statusCode})`);
  }
}

async function createSession(prefix, fullName) {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 9999)
    .toString(36)
    .padStart(2, '0')}`;
  const username = `${prefix}${unique}`.replace(/[^a-z0-9]/gi, '').slice(0, 20);
  const login = await request({
    path: '/api/v1/auth/social',
    method: 'POST',
    body: {
      provider: 'google',
      email: `${username}@macradar.app`,
      fullName,
      username,
      city: 'Istanbul',
    },
  });

  expectStatus(login, 200, `${prefix} social login`);
  const payload = unwrapData(parseJson(login.body, `${prefix} social login`));
  const token = typeof payload?.session?.token === 'string' ? payload.session.token : '';
  const userId = typeof payload?.profile?.id === 'string' ? payload.profile.id : '';
  const resolvedUsername =
    typeof payload?.profile?.username === 'string' ? payload.profile.username : '';
  if (!token) {
    throw new Error(`${prefix} social login did not return a token`);
  }
  if (!userId) {
    throw new Error(`${prefix} social login did not return profile id`);
  }
  return { token, userId, username: resolvedUsername || username };
}

function createAuthHeader(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

(async () => {
  const checks = [];
  const viewer = await createSession('tabsmoke', 'Tabs Smoke User');
  const searchTarget = await createSession('tabssearch', 'Tabs Search User');
  const headers = createAuthHeader(viewer.token);

  const mapPreferences = await request({
    path: '/api/v1/map/preferences',
    headers,
  });
  expectStatus(mapPreferences, 200, 'map/preferences');
  const mapPreferencesData = unwrapData(parseJson(mapPreferences.body, 'map/preferences'));
  if (
    typeof mapPreferencesData?.trackingEnabled !== 'boolean' ||
    typeof mapPreferencesData?.mapFilterMode !== 'string'
  ) {
    throw new Error('map/preferences payload shape is invalid');
  }
  checks.push('map/preferences=200');

  const updateMapPreferences = await request({
    path: '/api/v1/map/preferences',
    method: 'PATCH',
    headers,
    body: {
      mapFilterMode: mapPreferencesData.mapFilterMode,
      mapThemeMode: mapPreferencesData.mapThemeMode,
      showLocalLayer: mapPreferencesData.showLocalLayer,
      showRemoteLayer: mapPreferencesData.showRemoteLayer,
      trackingEnabled: mapPreferencesData.trackingEnabled,
    },
  });
  expectStatus(updateMapPreferences, 200, 'map/preferences patch');
  checks.push('map/preferences.patch=200');

  const exploreFeed = await request({
    path: '/api/v1/explore/feed?segment=kesfet&limit=6',
    headers,
  });
  expectStatus(exploreFeed, 200, 'explore/feed');
  const exploreFeedData = unwrapData(parseJson(exploreFeed.body, 'explore/feed'));
  const feedPosts = Array.isArray(exploreFeedData?.posts) ? exploreFeedData.posts : [];
  if (String(exploreFeedData?.segment || '') !== 'kesfet') {
    throw new Error('explore/feed segment did not match kesfet');
  }
  checks.push(`explore/feed=200(${feedPosts.length})`);
  const exploreOnlyEngagementTarget = feedPosts.find(item => {
    const postId = String(item?.id || '').trim();
    const authorId = String(item?.author?.id || '').trim();
    return postId.length > 0 && authorId !== viewer.userId;
  });

  const exploreFollowingFeed = await request({
    path: '/api/v1/explore/feed?segment=takipte&limit=6',
    headers,
  });
  expectStatus(exploreFollowingFeed, 200, 'explore/feed takipte');
  const exploreFollowingFeedData = unwrapData(
    parseJson(exploreFollowingFeed.body, 'explore/feed takipte'),
  );
  const followingFeedPosts = Array.isArray(exploreFollowingFeedData?.posts)
    ? exploreFollowingFeedData.posts
    : [];
  if (String(exploreFollowingFeedData?.segment || '') !== 'takipte') {
    throw new Error('explore/feed takipte segment did not match takipte');
  }
  checks.push(`explore/feed.takipte=200(${followingFeedPosts.length})`);

  const exploreForYouFeed = await request({
    path: '/api/v1/explore/feed?segment=sizin-icin&limit=6',
    headers,
  });
  expectStatus(exploreForYouFeed, 200, 'explore/feed sizin-icin');
  const exploreForYouFeedData = unwrapData(
    parseJson(exploreForYouFeed.body, 'explore/feed sizin-icin'),
  );
  const forYouFeedPosts = Array.isArray(exploreForYouFeedData?.posts)
    ? exploreForYouFeedData.posts
    : [];
  if (String(exploreForYouFeedData?.segment || '') !== 'sizin-icin') {
    throw new Error('explore/feed sizin-icin segment did not match sizin-icin');
  }
  checks.push(`explore/feed.sizin-icin=200(${forYouFeedPosts.length})`);

  const exploreTrending = await request({
    path: '/api/v1/explore/search/trending-tags?limit=6',
    headers,
  });
  expectStatus(exploreTrending, 200, 'explore/trending-tags');
  const exploreTrendingData = unwrapData(
    parseJson(exploreTrending.body, 'explore/trending-tags'),
  );
  const tags = Array.isArray(exploreTrendingData?.tags) ? exploreTrendingData.tags : [];
  if (
    tags.length > 0 &&
    (typeof tags[0]?.count !== 'number' ||
      typeof tags[0]?.recentCount !== 'number' ||
      typeof tags[0]?.score !== 'number' ||
      typeof tags[0]?.lastUsedAt !== 'string')
  ) {
    throw new Error('explore/trending-tags payload shape is invalid');
  }
  checks.push(`explore/trending-tags=200(${tags.length})`);

  const exploreUserSearch = await request({
    path: `/api/v1/explore/search/users?q=${encodeURIComponent(searchTarget.username)}&limit=6`,
    headers,
  });
  expectStatus(exploreUserSearch, 200, 'explore/search/users');
  const exploreUserSearchData = unwrapData(
    parseJson(exploreUserSearch.body, 'explore/search/users'),
  );
  const foundUsers = Array.isArray(exploreUserSearchData?.users)
    ? exploreUserSearchData.users
    : [];
  if (!foundUsers.some(item => String(item?.id || '') === searchTarget.userId)) {
    throw new Error('explore/search/users did not include expected target user');
  }
  checks.push(`explore/search/users=200(${foundUsers.length})`);

  const postSearchToken = `tabs-smoke-${Date.now().toString(36)}`;
  const trendTagToken = `trend${Date.now().toString(36).slice(-8)}`;
  const createCameraPost = await request({
    path: '/api/v1/profile/me/posts',
    method: 'POST',
    headers,
    body: {
      caption: `tabs camera smoke ${postSearchToken} #${trendTagToken} #aksamrotasi`,
      location: 'Istanbul',
      mediaType: 'photo',
      mediaUrl: `https://cdn.macradar.app/tabs-smoke/${Date.now()}.jpg`,
    },
  });
  expectStatus(createCameraPost, 201, 'profile/me/posts create');
  const createdPostData = unwrapData(parseJson(createCameraPost.body, 'profile/me/posts create'));
  const createdPostId = typeof createdPostData?.id === 'string' ? createdPostData.id : '';
  if (!createdPostId) {
    throw new Error('profile/me/posts create did not return id');
  }
  checks.push('profile/me/posts.create=201');

  const createSecondCameraPost = await request({
    path: '/api/v1/profile/me/posts',
    method: 'POST',
    headers,
    body: {
      caption: `tabs camera followup ${postSearchToken} #${trendTagToken} #kopruaksami`,
      location: 'Besiktas',
      mediaType: 'video',
      mediaUrl: `https://cdn.macradar.app/tabs-smoke/${Date.now()}.mp4`,
    },
  });
  expectStatus(createSecondCameraPost, 201, 'profile/me/posts create second');
  const createdSecondPostData = unwrapData(
    parseJson(createSecondCameraPost.body, 'profile/me/posts create second'),
  );
  const createdSecondPostId =
    typeof createdSecondPostData?.id === 'string' ? createdSecondPostData.id : '';
  if (!createdSecondPostId) {
    throw new Error('profile/me/posts create second did not return id');
  }
  checks.push('profile/me/posts.create-second=201');

  const updatedCaption = `tabs camera edited ${postSearchToken} #${trendTagToken} #sahilgecesi`;
  const updatedVisibility = 'friends';
  const updateCameraPost = await request({
    path: `/api/v1/profile/me/posts/${encodeURIComponent(createdPostId)}`,
    method: 'PATCH',
    headers,
    body: {
      caption: updatedCaption,
      location: 'Sariyer',
      visibility: updatedVisibility,
    },
  });
  expectStatus(updateCameraPost, 200, 'profile/me/posts patch');
  const updatedPostData = unwrapData(
    parseJson(updateCameraPost.body, 'profile/me/posts patch'),
  );
  if (updatedPostData?.caption !== updatedCaption) {
    throw new Error('profile/me/posts patch did not update caption');
  }
  if (updatedPostData?.visibility !== updatedVisibility) {
    throw new Error('profile/me/posts patch did not update visibility');
  }
  checks.push('profile/me/posts.patch=200');

  const searchPostsPageOne = await request({
    path: `/api/v1/explore/search/posts?q=${encodeURIComponent(postSearchToken)}&limit=1&sort=relevant&mediaType=all`,
    headers,
  });
  expectStatus(searchPostsPageOne, 200, 'explore/search/posts page one');
  const searchPostsPageOneData = unwrapData(
    parseJson(searchPostsPageOne.body, 'explore/search/posts page one'),
  );
  const searchPostsPageOneList = Array.isArray(searchPostsPageOneData?.posts)
    ? searchPostsPageOneData.posts
    : [];
  if (searchPostsPageOneData?.filter !== 'all') {
    throw new Error('explore/search/posts page one did not echo filter');
  }
  if (searchPostsPageOneData?.sort !== 'relevant') {
    throw new Error('explore/search/posts page one did not echo sort');
  }
  if (searchPostsPageOneList.length !== 1) {
    throw new Error('explore/search/posts page one did not respect the requested limit');
  }
  if (searchPostsPageOneData?.hasMore !== true) {
    throw new Error('explore/search/posts page one should have another page');
  }
  if (typeof searchPostsPageOneData?.nextCursor !== 'string' || !searchPostsPageOneData.nextCursor) {
    throw new Error('explore/search/posts page one did not return nextCursor');
  }

  const searchPostsPageTwo = await request({
    path: `/api/v1/explore/search/posts?q=${encodeURIComponent(postSearchToken)}&limit=1&sort=relevant&mediaType=all&cursor=${encodeURIComponent(searchPostsPageOneData.nextCursor)}`,
    headers,
  });
  expectStatus(searchPostsPageTwo, 200, 'explore/search/posts page two');
  const searchPostsPageTwoData = unwrapData(
    parseJson(searchPostsPageTwo.body, 'explore/search/posts page two'),
  );
  const searchPostsPageTwoList = Array.isArray(searchPostsPageTwoData?.posts)
    ? searchPostsPageTwoData.posts
    : [];
  const foundSearchPostIds = new Set(
    [...searchPostsPageOneList, ...searchPostsPageTwoList].map(item =>
      String(item?.id || ''),
    ),
  );
  if (!foundSearchPostIds.has(createdPostId) || !foundSearchPostIds.has(createdSecondPostId)) {
    throw new Error('explore/search/posts pagination did not return both created posts');
  }
  checks.push(`explore/search/posts=200(${foundSearchPostIds.size})`);

  const searchVideoPosts = await request({
    path: `/api/v1/explore/search/posts?q=${encodeURIComponent(postSearchToken)}&limit=6&sort=relevant&mediaType=video`,
    headers,
  });
  expectStatus(searchVideoPosts, 200, 'explore/search/posts video filter');
  const searchVideoPostsData = unwrapData(
    parseJson(searchVideoPosts.body, 'explore/search/posts video filter'),
  );
  const searchVideoPostsList = Array.isArray(searchVideoPostsData?.posts)
    ? searchVideoPostsData.posts
    : [];
  if (!searchVideoPostsList.some(item => String(item?.id || '') === createdSecondPostId)) {
    throw new Error('explore/search/posts video filter did not include the created video post');
  }
  if (searchVideoPostsList.some(item => String(item?.id || '') === createdPostId)) {
    throw new Error('explore/search/posts video filter incorrectly included the photo post');
  }
  checks.push(`explore/search/posts.video=200(${searchVideoPostsList.length})`);

  const trendTagDetail = await request({
    path: `/api/v1/explore/tags/${encodeURIComponent(trendTagToken)}?limit=6`,
    headers,
  });
  expectStatus(trendTagDetail, 200, 'explore/tags detail');
  const trendTagDetailData = unwrapData(
    parseJson(trendTagDetail.body, 'explore/tags detail'),
  );
  const trendTagTopPosts = Array.isArray(trendTagDetailData?.topPosts)
    ? trendTagDetailData.topPosts
    : [];
  const trendTagRecentPosts = Array.isArray(trendTagDetailData?.recentPosts)
    ? trendTagDetailData.recentPosts
    : [];
  const trendTagRelated = Array.isArray(trendTagDetailData?.relatedTags)
    ? trendTagDetailData.relatedTags
    : [];
  if (trendTagDetailData?.tag?.tag !== trendTagToken) {
    throw new Error('explore/tags detail did not return the requested tag');
  }
  if (typeof trendTagDetailData?.tag?.count !== 'number' || trendTagDetailData.tag.count < 2) {
    throw new Error('explore/tags detail did not return the expected post count');
  }
  if (
    !trendTagTopPosts.some(item => String(item?.id || '') === createdPostId) ||
    !trendTagRecentPosts.some(item => String(item?.id || '') === createdSecondPostId)
  ) {
    throw new Error('explore/tags detail did not include the created posts');
  }
  if (trendTagRelated.length > 0 && typeof trendTagRelated[0]?.count !== 'number') {
    throw new Error('explore/tags detail related tags payload shape is invalid');
  }
  checks.push(
    `explore/tags.detail=200(top:${trendTagTopPosts.length},recent:${trendTagRecentPosts.length},related:${trendTagRelated.length})`,
  );

  const likeExplorePost = await request({
    path: `/api/v1/explore/posts/${encodeURIComponent(createdSecondPostId)}/reactions`,
    method: 'POST',
    headers,
    body: {
      kind: 'like',
    },
  });
  expectStatus(likeExplorePost, 200, 'explore/posts reactions like');
  const likeExplorePostData = unwrapData(
    parseJson(likeExplorePost.body, 'explore/posts reactions like'),
  );
  if (likeExplorePostData?.viewerState?.isLiked !== true) {
    throw new Error('explore/posts reactions like did not toggle isLiked');
  }
  checks.push(`explore/posts.like=200(${likeExplorePostData?.stats?.likesCount ?? 0})`);

  const bookmarkExplorePost = await request({
    path: `/api/v1/explore/posts/${encodeURIComponent(createdSecondPostId)}/reactions`,
    method: 'POST',
    headers,
    body: {
      kind: 'bookmark',
    },
  });
  expectStatus(bookmarkExplorePost, 200, 'explore/posts reactions bookmark');
  const bookmarkExplorePostData = unwrapData(
    parseJson(bookmarkExplorePost.body, 'explore/posts reactions bookmark'),
  );
  if (bookmarkExplorePostData?.viewerState?.isBookmarked !== true) {
    throw new Error('explore/posts reactions bookmark did not toggle isBookmarked');
  }
  checks.push(
    `explore/posts.bookmark=200(${bookmarkExplorePostData?.stats?.bookmarksCount ?? 0})`,
  );

  const shareExplorePost = await request({
    path: `/api/v1/explore/posts/${encodeURIComponent(createdSecondPostId)}/reactions`,
    method: 'POST',
    headers,
    body: {
      kind: 'share',
    },
  });
  expectStatus(shareExplorePost, 200, 'explore/posts reactions share');
  const shareExplorePostData = unwrapData(
    parseJson(shareExplorePost.body, 'explore/posts reactions share'),
  );
  if (Number(shareExplorePostData?.stats?.sharesCount ?? 0) < 1) {
    throw new Error('explore/posts reactions share did not increment sharesCount');
  }
  checks.push(`explore/posts.share=200(${shareExplorePostData?.stats?.sharesCount ?? 0})`);

  if (exploreOnlyEngagementTarget) {
    const exploreOnlyTargetPostId = String(exploreOnlyEngagementTarget.id || '').trim();
    const likeExploreOnlyPost = await request({
      path: `/api/v1/explore/posts/${encodeURIComponent(exploreOnlyTargetPostId)}/reactions`,
      method: 'POST',
      headers,
      body: {
        kind: 'like',
      },
    });
    expectStatus(likeExploreOnlyPost, 200, 'explore-only post like');
    const likeExploreOnlyPostData = unwrapData(
      parseJson(likeExploreOnlyPost.body, 'explore-only post like'),
    );
    if (likeExploreOnlyPostData?.viewerState?.isLiked !== true) {
      throw new Error('explore-only post like did not toggle isLiked');
    }

    const bookmarkExploreOnlyPost = await request({
      path: `/api/v1/explore/posts/${encodeURIComponent(exploreOnlyTargetPostId)}/reactions`,
      method: 'POST',
      headers,
      body: {
        kind: 'bookmark',
      },
    });
    expectStatus(bookmarkExploreOnlyPost, 200, 'explore-only post bookmark');
    const bookmarkExploreOnlyPostData = unwrapData(
      parseJson(bookmarkExploreOnlyPost.body, 'explore-only post bookmark'),
    );
    if (bookmarkExploreOnlyPostData?.viewerState?.isBookmarked !== true) {
      throw new Error('explore-only post bookmark did not toggle isBookmarked');
    }

    const likedPostsResponse = await request({
      path: '/api/v1/profile/me/liked-posts?limit=24',
      headers,
    });
    expectStatus(likedPostsResponse, 200, 'profile/me/liked-posts list');
    const likedPostsData = unwrapData(
      parseJson(likedPostsResponse.body, 'profile/me/liked-posts list'),
    );
    const likedPosts = Array.isArray(likedPostsData?.posts) ? likedPostsData.posts : [];
    const likedTarget = likedPosts.find(
      item => String(item?.id || '') === exploreOnlyTargetPostId,
    );
    if (!likedTarget) {
      throw new Error('profile/me/liked-posts did not include explore-only liked post');
    }
    if (likedTarget?.isUnavailable === true || String(likedTarget?.mediaUrl || '').trim().length === 0) {
      throw new Error('profile/me/liked-posts returned explore-only liked post as unavailable');
    }
    checks.push('profile/me/liked-posts.explore=200');

    const savedPostsResponse = await request({
      path: '/api/v1/profile/me/saved-posts?limit=24',
      headers,
    });
    expectStatus(savedPostsResponse, 200, 'profile/me/saved-posts list');
    const savedPostsData = unwrapData(
      parseJson(savedPostsResponse.body, 'profile/me/saved-posts list'),
    );
    const savedPosts = Array.isArray(savedPostsData?.posts) ? savedPostsData.posts : [];
    const savedTarget = savedPosts.find(
      item => String(item?.id || '') === exploreOnlyTargetPostId,
    );
    if (!savedTarget) {
      throw new Error('profile/me/saved-posts did not include explore-only saved post');
    }
    if (savedTarget?.isUnavailable === true || String(savedTarget?.mediaUrl || '').trim().length === 0) {
      throw new Error('profile/me/saved-posts returned explore-only saved post as unavailable');
    }
    checks.push('profile/me/saved-posts.explore=200');
  }

  const exploreCommentText = `explore comment ${postSearchToken}`;
  const createExploreComment = await request({
    path: `/api/v1/explore/posts/${encodeURIComponent(createdSecondPostId)}/comments`,
    method: 'POST',
    headers,
    body: {
      text: exploreCommentText,
    },
  });
  expectStatus(createExploreComment, 201, 'explore/posts comments create');
  const createExploreCommentData = unwrapData(
    parseJson(createExploreComment.body, 'explore/posts comments create'),
  );
  if (String(createExploreCommentData?.comment?.body || '') !== exploreCommentText) {
    throw new Error('explore/posts comments create did not echo the created comment');
  }
  if (Number(createExploreCommentData?.stats?.commentsCount ?? 0) < 1) {
    throw new Error('explore/posts comments create did not increment commentsCount');
  }
  checks.push(
    `explore/posts.comment.create=201(${createExploreCommentData?.stats?.commentsCount ?? 0})`,
  );

  const listExploreComments = await request({
    path: `/api/v1/explore/posts/${encodeURIComponent(createdSecondPostId)}/comments`,
    headers,
  });
  expectStatus(listExploreComments, 200, 'explore/posts comments list');
  const listExploreCommentsData = unwrapData(
    parseJson(listExploreComments.body, 'explore/posts comments list'),
  );
  const listedExploreComments = Array.isArray(listExploreCommentsData?.comments)
    ? listExploreCommentsData.comments
    : [];
  if (
    !listedExploreComments.some(
      item => String(item?.body || '') === exploreCommentText,
    )
  ) {
    throw new Error('explore/posts comments list did not include the created comment');
  }
  checks.push(`explore/posts.comments=200(${listedExploreComments.length})`);

  const reportExplorePost = await request({
    path: `/api/v1/explore/posts/${encodeURIComponent(createdSecondPostId)}/report`,
    method: 'POST',
    headers,
    body: {
      reason: 'spam',
    },
  });
  expectStatus(reportExplorePost, 201, 'explore/posts report');
  const reportExplorePostData = unwrapData(
    parseJson(reportExplorePost.body, 'explore/posts report'),
  );
  if (String(reportExplorePostData?.reason || '') !== 'spam') {
    throw new Error('explore/posts report did not return the submitted reason');
  }
  checks.push('explore/posts.report=201');

  const profilePosts = await request({
    path: '/api/v1/profile/me/posts?limit=8',
    headers,
  });
  expectStatus(profilePosts, 200, 'profile/me/posts list');
  const profilePostsData = unwrapData(parseJson(profilePosts.body, 'profile/me/posts list'));
  const posts = Array.isArray(profilePostsData?.posts) ? profilePostsData.posts : [];
  const updatedProfilePost = posts.find(
    item => String(item?.id || '') === createdPostId,
  );
  if (!updatedProfilePost) {
    throw new Error('profile/me/posts list did not include created post');
  }
  if (String(updatedProfilePost?.caption || '') !== updatedCaption) {
    throw new Error('profile/me/posts list did not reflect updated caption');
  }
  checks.push(`profile/me/posts.list=200(${posts.length})`);

  const profileAppSettings = await request({
    path: '/api/v1/profile/app-settings',
    headers,
  });
  expectStatus(profileAppSettings, 200, 'profile/app-settings');
  const profileAppSettingsData = unwrapData(
    parseJson(profileAppSettings.body, 'profile/app-settings'),
  );
  if (typeof profileAppSettingsData?.language !== 'string') {
    throw new Error('profile/app-settings payload shape is invalid');
  }
  checks.push('profile/app-settings=200');

  const patchAppSettings = await request({
    path: '/api/v1/profile/app-settings',
    method: 'PATCH',
    headers,
    body: {
      language: profileAppSettingsData.language,
      gender: profileAppSettingsData.gender,
      notifyFollowRequests: profileAppSettingsData.notifyFollowRequests,
      notifyMessages: profileAppSettingsData.notifyMessages,
      notifyPostLikes: profileAppSettingsData.notifyPostLikes,
    },
  });
  expectStatus(patchAppSettings, 200, 'profile/app-settings patch');
  checks.push('profile/app-settings.patch=200');

  const profilePrivacy = await request({
    path: '/api/v1/profile/privacy',
    headers,
  });
  expectStatus(profilePrivacy, 200, 'profile/privacy');
  const profilePrivacyData = unwrapData(parseJson(profilePrivacy.body, 'profile/privacy'));
  if (
    typeof profilePrivacyData?.isMapVisible !== 'boolean' ||
    typeof profilePrivacyData?.isPrivateAccount !== 'boolean'
  ) {
    throw new Error('profile/privacy payload shape is invalid');
  }
  checks.push('profile/privacy=200');

  const patchPrivacy = await request({
    path: '/api/v1/profile/privacy',
    method: 'PATCH',
    headers,
    body: {
      isMapVisible: profilePrivacyData.isMapVisible,
      isPrivateAccount: profilePrivacyData.isPrivateAccount,
    },
  });
  expectStatus(patchPrivacy, 200, 'profile/privacy patch');
  checks.push('profile/privacy.patch=200');

  const profileHelp = await request({
    path: '/api/v1/profile/help',
    headers,
  });
  expectStatus(profileHelp, 200, 'profile/help');
  const profileHelpData = unwrapData(parseJson(profileHelp.body, 'profile/help'));
  if (!Array.isArray(profileHelpData?.items)) {
    throw new Error('profile/help payload shape is invalid');
  }
  checks.push(`profile/help=200(${profileHelpData.items.length})`);

  const blockedUsersListBefore = await request({
    path: '/api/v1/profile/blocked-users',
    headers,
  });
  expectStatus(blockedUsersListBefore, 200, 'profile/blocked-users list');
  checks.push('profile/blocked-users.list=200');

  const blockTargetUser = await request({
    path: `/api/v1/profile/blocked-users/${encodeURIComponent(searchTarget.userId)}`,
    method: 'POST',
    headers,
    body: {},
  });
  expectStatus(blockTargetUser, 200, 'profile/blocked-users block');
  checks.push('profile/blocked-users.block=200');

  const blockedUsersListAfterBlock = await request({
    path: '/api/v1/profile/blocked-users',
    headers,
  });
  expectStatus(blockedUsersListAfterBlock, 200, 'profile/blocked-users list after block');
  const blockedUsersAfterBlockData = unwrapData(
    parseJson(blockedUsersListAfterBlock.body, 'profile/blocked-users list after block'),
  );
  const blockedUsersAfterBlock = Array.isArray(blockedUsersAfterBlockData?.users)
    ? blockedUsersAfterBlockData.users
    : [];
  if (!blockedUsersAfterBlock.some(item => String(item?.id || '') === searchTarget.userId)) {
    throw new Error('blocked user list did not include blocked target');
  }
  checks.push(`profile/blocked-users.list.after-block=200(${blockedUsersAfterBlock.length})`);

  const unblockTargetUser = await request({
    path: `/api/v1/profile/blocked-users/${encodeURIComponent(searchTarget.userId)}`,
    method: 'DELETE',
    headers,
  });
  expectStatus(unblockTargetUser, 200, 'profile/blocked-users unblock');
  checks.push('profile/blocked-users.unblock=200');

  const blockedUsersListAfterUnblock = await request({
    path: '/api/v1/profile/blocked-users',
    headers,
  });
  expectStatus(
    blockedUsersListAfterUnblock,
    200,
    'profile/blocked-users list after unblock',
  );
  const blockedUsersAfterUnblockData = unwrapData(
    parseJson(blockedUsersListAfterUnblock.body, 'profile/blocked-users list after unblock'),
  );
  const blockedUsersAfterUnblock = Array.isArray(blockedUsersAfterUnblockData?.users)
    ? blockedUsersAfterUnblockData.users
    : [];
  if (blockedUsersAfterUnblock.some(item => String(item?.id || '') === searchTarget.userId)) {
    throw new Error('blocked user list still included target after unblock');
  }
  checks.push(
    `profile/blocked-users.list.after-unblock=200(${blockedUsersAfterUnblock.length})`,
  );

  const profileRequestSummary = await request({
    path: '/api/v1/profile/request-summary',
    headers,
  });
  expectStatus(profileRequestSummary, 200, 'profile/request-summary');
  const profileRequestSummaryData = unwrapData(
    parseJson(profileRequestSummary.body, 'profile/request-summary'),
  );
  if (!Number.isFinite(profileRequestSummaryData?.messagesUnreadCount)) {
    throw new Error('profile/request-summary payload shape is invalid');
  }
  checks.push('profile/request-summary=200');

  console.log(`[smoke] Tab backend contracts passed: ${checks.join(', ')}`);
})().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
