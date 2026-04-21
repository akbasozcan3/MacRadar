// Instagram-like Feed System with Professional Features
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

class FeedSystem {
  constructor() {
    this.users = new Map();
    this.posts = new Map();
    this.stories = new Map();
    this.follows = new Map(); // userId -> Set of following user IDs
    this.blockedUsers = new Map(); // userId -> Set of blocked user IDs
    this.likes = new Map(); // postId -> Set of user IDs who liked
    this.comments = new Map(); // postId -> Array of comments
    this.saves = new Map(); // userId -> Set of saved post IDs
    this.notifications = new Map(); // userId -> Array of notifications
    this.hashtags = new Map();
    this.locations = new Map();
    this.algorithms = new FeedAlgorithms(this);
    this.moderation = new ContentModeration(this);
    this.analytics = new FeedAnalytics(this);
    this.wsServer = null;
    this.initializeSystem();
  }

  initializeSystem() {
    // Initialize trending hashtags
    const trendingHashtags = ['macradar', 'explore', 'discover', 'social', 'connect', 'share', 'lifestyle', 'travel'];
    trendingHashtags.forEach(tag => {
      this.hashtags.set(tag, {
        count: Math.floor(Math.random() * 1000) + 100,
        posts: [],
        trending: true
      });
    });
  }

  initializeWebSocketServer(port = 8100) {
    if (this.wsServer) {
      return this.wsServer;
    }

    this.wsServer = new WebSocket.Server({ port });
    
    this.wsServer.on('connection', (ws, req) => {
      const userId = this.extractUserIdFromRequest(req);
      this.handleUserConnection(ws, userId);
    });

    console.log(`[FeedSystem] WebSocket server running on port ${port}`);
  }

  extractUserIdFromRequest(req) {
    const url = new URL(req.url, `http://localhost:8100`);
    return url.searchParams.get('userId') || 'anonymous';
  }

  handleUserConnection(ws, userId) {
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleWebSocketMessage(userId, message);
      } catch (error) {
        console.error('[FeedSystem] WebSocket message error:', error);
      }
    });
  }

  handleWebSocketMessage(userId, message) {
    switch (message.type) {
      case 'feed_update':
        this.handleFeedUpdate(userId, message);
        break;
      case 'story_view':
        this.handleStoryView(userId, message);
        break;
      case 'notification_read':
        this.handleNotificationRead(userId, message);
        break;
    }
  }

  // User Management
  createUser(userData) {
    const user = {
      id: userData.id || this.generateUserId(),
      username: userData.username,
      email: userData.email,
      profile: {
        displayName: userData.displayName || userData.username,
        bio: userData.bio || '',
        avatar: userData.avatar || null,
        website: userData.website || '',
        location: userData.location || '',
        birthday: userData.birthday || null,
        gender: userData.gender || null,
        isPrivate: userData.isPrivate || false,
        isVerified: userData.isVerified || false
      },
      stats: {
        posts: 0,
        followers: 0,
        following: 0,
        likes: 0,
        comments: 0
      },
      preferences: {
        theme: 'light',
        language: 'en',
        notifications: {
          likes: true,
          comments: true,
          follows: true,
          mentions: true,
          stories: true
        }
      },
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      isBlocked: false,
      isDeleted: false
    };

    this.users.set(user.id, user);
    this.follows.set(user.id, new Set());
    this.blockedUsers.set(user.id, new Set());
    this.saves.set(user.id, new Set());
    this.notifications.set(user.id, []);
    
    return user;
  }

  generateUserId() {
    return 'user_' + crypto.randomBytes(16).toString('hex');
  }

  // Follow/Unfollow System
  followUser(followerId, followingId) {
    if (followerId === followingId) {
      throw new Error('Cannot follow yourself');
    }

    const follower = this.users.get(followerId);
    const following = this.users.get(followingId);

    if (!follower || !following) {
      throw new Error('User not found');
    }

    if (this.isUserBlocked(followingId, followerId)) {
      throw new Error('Cannot follow this user');
    }

    const follows = this.follows.get(followerId);
    if (follows.has(followingId)) {
      throw new Error('Already following this user');
    }

    follows.add(followingId);
    
    // Update stats
    follower.stats.following++;
    following.stats.followers++;

    // Create notification
    this.createNotification(followingId, {
      type: 'follow',
      fromUserId: followerId,
      timestamp: new Date().toISOString()
    });

    return { success: true, message: 'User followed successfully' };
  }

  unfollowUser(followerId, followingId) {
    const follower = this.users.get(followerId);
    const following = this.users.get(followingId);

    if (!follower || !following) {
      throw new Error('User not found');
    }

    const follows = this.follows.get(followerId);
    if (!follows.has(followingId)) {
      throw new Error('Not following this user');
    }

    follows.delete(followingId);
    
    // Update stats
    follower.stats.following--;
    following.stats.followers--;

    return { success: true, message: 'User unfollowed successfully' };
  }

  // Block/Unblock System
  blockUser(blockerId, blockedId) {
    if (blockerId === blockedId) {
      throw new Error('Cannot block yourself');
    }

    const blocker = this.users.get(blockerId);
    const blocked = this.users.get(blockedId);

    if (!blocker || !blocked) {
      throw new Error('User not found');
    }

    const blockedUsers = this.blockedUsers.get(blockerId);
    if (blockedUsers.has(blockedId)) {
      throw new Error('User already blocked');
    }

    blockedUsers.add(blockedId);

    // Remove from follows if following
    const follows = this.follows.get(blockerId);
    if (follows.has(blockedId)) {
      follows.delete(blockedId);
      blocker.stats.following--;
      blocked.stats.followers--;
    }

    // Remove follower if they're following us
    const theirFollows = this.follows.get(blockedId);
    if (theirFollows.has(blockerId)) {
      theirFollows.delete(blockerId);
      blocker.stats.followers--;
      blocked.stats.following--;
    }

    // Create notification (optional, based on privacy settings)
    this.createNotification(blockedId, {
      type: 'blocked',
      fromUserId: blockerId,
      timestamp: new Date().toISOString(),
      isPrivate: true
    });

    return { success: true, message: 'User blocked successfully' };
  }

  unblockUser(blockerId, blockedId) {
    const blocker = this.users.get(blockerId);
    const blocked = this.users.get(blockedId);

    if (!blocker || !blocked) {
      throw new Error('User not found');
    }

    const blockedUsers = this.blockedUsers.get(blockerId);
    if (!blockedUsers.has(blockedId)) {
      throw new Error('User not blocked');
    }

    blockedUsers.delete(blockedId);

    return { success: true, message: 'User unblocked successfully' };
  }

  isUserBlocked(userId, targetUserId) {
    const blocked = this.blockedUsers.get(userId);
    return blocked && blocked.has(targetUserId);
  }

  // Post Management
  createPost(postData) {
    const post = {
      id: this.generatePostId(),
      userId: postData.userId,
      content: {
        caption: postData.caption || '',
        media: postData.media || [],
        location: postData.location || null,
        hashtags: postData.hashtags || [],
        mentions: postData.mentions || [],
        taggedUsers: postData.taggedUsers || []
      },
      engagement: {
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        views: 0
      },
      metadata: {
        isPrivate: postData.isPrivate || false,
        allowComments: postData.allowComments !== false,
        allowSharing: postData.allowSharing !== false,
        hideLikes: postData.hideLikes || false,
        isSponsored: postData.isSponsored || false,
        isPinned: postData.isPinned || false
      },
      algorithm: {
        score: 0,
        reach: 0,
        engagement: 0,
        quality: 0
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
      isArchived: false
    };

    this.posts.set(post.id, post);
    
    // Update user stats
    const user = this.users.get(post.userId);
    if (user) {
      user.stats.posts++;
    }

    // Update hashtags
    post.content.hashtags.forEach(hashtag => {
      if (!this.hashtags.has(hashtag)) {
        this.hashtags.set(hashtag, {
          count: 0,
          posts: [],
          trending: false
        });
      }
      
      const hashtagData = this.hashtags.get(hashtag);
      hashtagData.count++;
      hashtagData.posts.push(post.id);
    });

    // Update location
    if (post.content.location) {
      const locationKey = `${post.content.location.latitude.toFixed(2)},${post.content.location.longitude.toFixed(2)}`;
      if (!this.locations.has(locationKey)) {
        this.locations.set(locationKey, {
          ...post.content.location,
          posts: [],
          checkins: 0
        });
      }
      
      const locationData = this.locations.get(locationKey);
      locationData.posts.push(post.id);
      locationData.checkins++;
    }

    // Calculate algorithm score
    this.algorithms.calculatePostScore(post);

    // Process mentions
    post.content.mentions.forEach(mentionedUserId => {
      if (mentionedUserId !== post.userId) {
        this.createNotification(mentionedUserId, {
          type: 'mention',
          fromUserId: post.userId,
          postId: post.id,
          timestamp: new Date().toISOString()
        });
      }
    });

    return post;
  }

  generatePostId() {
    return 'post_' + crypto.randomBytes(16).toString('hex');
  }

  // Feed Generation
  getUserFeed(userId, options = {}) {
    const {
      limit = 20,
      offset = 0,
      feedType = 'main', // 'main', 'following', 'explore', 'saved'
      refresh = false
    } = options;

    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    let candidatePosts = [];

    switch (feedType) {
      case 'following':
        candidatePosts = this.getFollowingFeed(userId);
        break;
      case 'explore':
        candidatePosts = this.getExploreFeed(userId);
        break;
      case 'saved':
        candidatePosts = this.getSavedFeed(userId);
        break;
      default:
        candidatePosts = this.getMainFeed(userId);
    }

    // Filter out blocked users' posts
    candidatePosts = candidatePosts.filter(post => 
      !this.isUserBlocked(userId, post.userId)
    );

    // Apply algorithm ranking
    const rankedPosts = this.algorithms.rankPosts(candidatePosts, userId);

    // Apply pagination
    const paginatedPosts = rankedPosts.slice(offset, offset + limit);

    return {
      posts: paginatedPosts,
      hasMore: rankedPosts.length > offset + limit,
      nextOffset: offset + limit,
      feedType,
      timestamp: new Date().toISOString()
    };
  }

  getMainFeed(userId) {
    const following = this.follows.get(userId);
    const candidatePosts = [];

    // Get posts from followed users
    for (const post of this.posts.values()) {
      if (post.isDeleted || post.isArchived) continue;
      
      // Include own posts and following users' posts
      if (post.userId === userId || (following && following.has(post.userId))) {
        candidatePosts.push(post);
      }
    }

    return candidatePosts;
  }

  getFollowingFeed(userId) {
    const following = this.follows.get(userId);
    const candidatePosts = [];

    for (const post of this.posts.values()) {
      if (post.isDeleted || post.isArchived) continue;
      
      // Only include posts from followed users (not own posts)
      if (following && following.has(post.userId) && post.userId !== userId) {
        candidatePosts.push(post);
      }
    }

    return candidatePosts;
  }

  getExploreFeed(userId) {
    const candidatePosts = [];
    const following = this.follows.get(userId);
    const blocked = this.blockedUsers.get(userId);

    for (const post of this.posts.values()) {
      if (post.isDeleted || post.isArchived || post.metadata.isPrivate) continue;
      
      // Exclude own posts and already followed users' posts
      if (post.userId !== userId && 
          (!following || !following.has(post.userId)) &&
          (!blocked || !blocked.has(post.userId))) {
        candidatePosts.push(post);
      }
    }

    return candidatePosts;
  }

  getSavedFeed(userId) {
    const savedPosts = this.saves.get(userId);
    const candidatePosts = [];

    if (savedPosts) {
      for (const postId of savedPosts) {
        const post = this.posts.get(postId);
        if (post && !post.isDeleted && !post.isArchived) {
          candidatePosts.push(post);
        }
      }
    }

    return candidatePosts;
  }

  // Story System
  createStory(storyData) {
    const story = {
      id: this.generateStoryId(),
      userId: storyData.userId,
      content: {
        media: storyData.media || [],
        caption: storyData.caption || '',
        hashtags: storyData.hashtags || [],
        mentions: storyData.mentions || []
      },
      engagement: {
        views: 0,
        replies: 0,
        reactions: 0
      },
      metadata: {
        isPrivate: storyData.isPrivate || false,
        allowReplies: storyData.allowReplies !== false,
        viewers: [], // Array of user IDs who viewed
        highlights: false
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      isDeleted: false
    };

    this.stories.set(story.id, story);

    // Process mentions
    story.content.mentions.forEach(mentionedUserId => {
      if (mentionedUserId !== story.userId) {
        this.createNotification(mentionedUserId, {
          type: 'story_mention',
          fromUserId: story.userId,
          storyId: story.id,
          timestamp: new Date().toISOString()
        });
      }
    });

    return story;
  }

  generateStoryId() {
    return 'story_' + crypto.randomBytes(16).toString('hex');
  }

  getUserStories(userId, viewerId = null) {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if viewer is blocked
    if (viewerId && this.isUserBlocked(userId, viewerId)) {
      return { stories: [], hasStories: false };
    }

    // Check privacy settings
    if (user.profile.isPrivate && viewerId !== userId) {
      const following = this.follows.get(viewerId);
      if (!following || !following.has(userId)) {
        return { stories: [], hasStories: false };
      }
    }

    const stories = [];
    const now = Date.now();

    for (const story of this.stories.values()) {
      if (story.isDeleted || story.userId !== userId) continue;
      
      // Check if story is expired
      if (new Date(story.expiresAt).getTime() < now) continue;
      
      // Check privacy
      if (story.metadata.isPrivate && viewerId !== userId) {
        const following = this.follows.get(viewerId);
        if (!following || !following.has(userId)) continue;
      }

      stories.push(story);
    }

    return {
      stories: stories.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      hasStories: stories.length > 0
    };
  }

  viewStory(storyId, viewerId) {
    const story = this.stories.get(storyId);
    if (!story || story.isDeleted) {
      throw new Error('Story not found');
    }

    // Check if viewer is blocked
    if (this.isUserBlocked(story.userId, viewerId)) {
      throw new Error('Cannot view this story');
    }

    // Add to viewers if not already viewed
    if (!story.metadata.viewers.includes(viewerId)) {
      story.metadata.viewers.push(viewerId);
      story.engagement.views++;
    }

    return { success: true, story };
  }

  // Interaction System
  likePost(userId, postId) {
    const post = this.posts.get(postId);
    if (!post || post.isDeleted) {
      throw new Error('Post not found');
    }

    // Check if user is blocked
    if (this.isUserBlocked(post.userId, userId)) {
      throw new Error('Cannot interact with this post');
    }

    const postLikes = this.likes.get(postId);
    if (postLikes && postLikes.has(userId)) {
      throw new Error('Post already liked');
    }

    if (!postLikes) {
      this.likes.set(postId, new Set());
    }
    this.likes.get(postId).add(userId);

    post.engagement.likes++;
    post.updatedAt = new Date().toISOString();

    // Create notification (if not own post)
    if (post.userId !== userId) {
      this.createNotification(post.userId, {
        type: 'like',
        fromUserId: userId,
        postId: postId,
        timestamp: new Date().toISOString()
      });
    }

    return { success: true, likes: post.engagement.likes };
  }

  unlikePost(userId, postId) {
    const post = this.posts.get(postId);
    if (!post) {
      throw new Error('Post not found');
    }

    const postLikes = this.likes.get(postId);
    if (!postLikes || !postLikes.has(userId)) {
      throw new Error('Post not liked');
    }

    postLikes.delete(userId);
    post.engagement.likes--;
    post.updatedAt = new Date().toISOString();

    return { success: true, likes: post.engagement.likes };
  }

  savePost(userId, postId) {
    const post = this.posts.get(postId);
    if (!post || post.isDeleted) {
      throw new Error('Post not found');
    }

    const userSaves = this.saves.get(userId);
    if (userSaves && userSaves.has(postId)) {
      throw new Error('Post already saved');
    }

    if (!userSaves) {
      this.saves.set(userId, new Set());
    }
    this.saves.get(userId).add(postId);

    post.engagement.saves++;
    post.updatedAt = new Date().toISOString();

    return { success: true, saves: post.engagement.saves };
  }

  unsavePost(userId, postId) {
    const userSaves = this.saves.get(userId);
    if (!userSaves || !userSaves.has(postId)) {
      throw new Error('Post not saved');
    }

    userSaves.delete(postId);

    const post = this.posts.get(postId);
    if (post) {
      post.engagement.saves--;
      post.updatedAt = new Date().toISOString();
    }

    return { success: true };
  }

  // Comment System
  addComment(userId, postId, commentData) {
    const post = this.posts.get(postId);
    if (!post || post.isDeleted) {
      throw new Error('Post not found');
    }

    if (!post.metadata.allowComments) {
      throw new Error('Comments not allowed on this post');
    }

    // Check if user is blocked
    if (this.isUserBlocked(post.userId, userId)) {
      throw new Error('Cannot comment on this post');
    }

    const comment = {
      id: this.generateCommentId(),
      userId: userId,
      postId: postId,
      content: commentData.content,
      parentId: commentData.parentId || null,
      mentions: commentData.mentions || [],
      engagement: {
        likes: 0,
        replies: 0
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false
    };

    if (!this.comments.has(postId)) {
      this.comments.set(postId, []);
    }
    this.comments.get(postId).push(comment);

    post.engagement.comments++;
    post.updatedAt = new Date().toISOString();

    // Create notification (if not own post)
    if (post.userId !== userId) {
      this.createNotification(post.userId, {
        type: 'comment',
        fromUserId: userId,
        postId: postId,
        commentId: comment.id,
        timestamp: new Date().toISOString()
      });
    }

    // Process mentions
    comment.mentions.forEach(mentionedUserId => {
      if (mentionedUserId !== userId && mentionedUserId !== post.userId) {
        this.createNotification(mentionedUserId, {
          type: 'comment_mention',
          fromUserId: userId,
          postId: postId,
          commentId: comment.id,
          timestamp: new Date().toISOString()
        });
      }
    });

    return comment;
  }

  generateCommentId() {
    return 'comment_' + crypto.randomBytes(16).toString('hex');
  }

  getPostComments(postId, options = {}) {
    const { limit = 50, offset = 0, sortBy = 'newest' } = options;
    
    const post = this.posts.get(postId);
    if (!post) {
      throw new Error('Post not found');
    }

    const comments = this.comments.get(postId) || [];
    const activeComments = comments.filter(c => !c.isDeleted);

    // Sort comments
    let sortedComments;
    switch (sortBy) {
      case 'newest':
        sortedComments = activeComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'oldest':
        sortedComments = activeComments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'popular':
        sortedComments = activeComments.sort((a, b) => b.engagement.likes - a.engagement.likes);
        break;
      default:
        sortedComments = activeComments;
    }

    // Apply pagination
    const paginatedComments = sortedComments.slice(offset, offset + limit);

    return {
      comments: paginatedComments,
      hasMore: sortedComments.length > offset + limit,
      nextOffset: offset + limit,
      total: activeComments.length
    };
  }

  // Notification System
  createNotification(userId, notificationData) {
    const user = this.users.get(userId);
    if (!user) return;

    const notification = {
      id: this.generateNotificationId(),
      userId: userId,
      ...notificationData,
      isRead: false,
      createdAt: new Date().toISOString()
    };

    const userNotifications = this.notifications.get(userId);
    userNotifications.unshift(notification);

    // Keep only last 100 notifications
    if (userNotifications.length > 100) {
      userNotifications.splice(100);
    }

    // Send real-time notification
    this.sendNotificationToUser(userId, notification);
  }

  generateNotificationId() {
    return 'notif_' + crypto.randomBytes(16).toString('hex');
  }

  sendNotificationToUser(userId, notification) {
    // WebSocket implementation would go here
    console.log(`[FeedSystem] Notification for ${userId}:`, notification.type);
  }

  getUserNotifications(userId, options = {}) {
    const { limit = 20, offset = 0, unreadOnly = false } = options;
    
    const userNotifications = this.notifications.get(userId) || [];
    let filteredNotifications = userNotifications;

    if (unreadOnly) {
      filteredNotifications = userNotifications.filter(n => !n.isRead);
    }

    const paginatedNotifications = filteredNotifications.slice(offset, offset + limit);

    return {
      notifications: paginatedNotifications,
      hasMore: filteredNotifications.length > offset + limit,
      nextOffset: offset + limit,
      unreadCount: userNotifications.filter(n => !n.isRead).length
    };
  }

  markNotificationRead(userId, notificationId) {
    const userNotifications = this.notifications.get(userId);
    if (!userNotifications) return;

    const notification = userNotifications.find(n => n.id === notificationId);
    if (notification) {
      notification.isRead = true;
    }

    return { success: true };
  }

  markAllNotificationsRead(userId) {
    const userNotifications = this.notifications.get(userId);
    if (userNotifications) {
      userNotifications.forEach(n => n.isRead = true);
    }

    return { success: true };
  }
}

class FeedAlgorithms {
  constructor(feedSystem) {
    this.feedSystem = feedSystem;
  }

  calculatePostScore(post) {
    let score = 0;

    // Base engagement score
    const engagementScore = post.engagement.likes + 
                           (post.engagement.comments * 2) + 
                           (post.engagement.shares * 3) + 
                           (post.engagement.saves * 1.5);
    
    score += engagementScore;

    // Quality factors
    const qualityFactors = this.calculateQualityFactors(post);
    score *= qualityFactors;

    // Recency factor
    const hoursSinceCreation = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
    const recencyFactor = Math.max(0.1, 1 - (hoursSinceCreation / 72)); // Decay over 72 hours
    score *= recencyFactor;

    // Save the calculated score
    post.algorithm.score = score;
    post.algorithm.engagement = engagementScore;
    post.algorithm.quality = qualityFactors;

    return score;
  }

  calculateQualityFactors(post) {
    let factors = 1;

    // Media quality
    if (post.content.media.length > 0) {
      factors *= 1.2;
    }

    // Caption length (optimal range)
    const captionLength = post.content.caption.length;
    if (captionLength > 10 && captionLength < 500) {
      factors *= 1.1;
    }

    // Hashtag usage (optimal range)
    const hashtagCount = post.content.hashtags.length;
    if (hashtagCount >= 3 && hashtagCount <= 10) {
      factors *= 1.05;
    }

    // Location tag
    if (post.content.location) {
      factors *= 1.1;
    }

    return factors;
  }

  rankPosts(posts, userId) {
    const userProfile = this.getUserProfile(userId);
    
    const scoredPosts = posts.map(post => ({
      post,
      score: this.calculatePersonalizedScore(post, userProfile)
    }));

    return scoredPosts
      .sort((a, b) => b.score - a.score)
      .map(item => item.post);
  }

  calculatePersonalizedScore(post, userProfile) {
    let score = post.algorithm.score || 0;

    // User interest alignment
    const interestBonus = this.calculateInterestBonus(post, userProfile);
    score += interestBonus;

    // Relationship factor
    const relationshipFactor = this.calculateRelationshipFactor(post, userProfile);
    score *= relationshipFactor;

    // Diversity factor
    const diversityFactor = this.calculateDiversityFactor(post, userProfile);
    score *= diversityFactor;

    return score;
  }

  getUserProfile(userId) {
    // This would typically be stored and updated based on user behavior
    return {
      interests: new Map(),
      recentInteractions: [],
      preferredCategories: [],
      relationshipStrengths: new Map()
    };
  }

  calculateInterestBonus(post, userProfile) {
    let bonus = 0;

    // Category interest
    if (userProfile.preferredCategories.includes(post.content.category)) {
      bonus += 10;
    }

    // Hashtag interest
    post.content.hashtags.forEach(hashtag => {
      const interestScore = userProfile.interests.get(`hashtag:${hashtag}`) || 0;
      bonus += interestScore;
    });

    return bonus;
  }

  calculateRelationshipFactor(post, userProfile) {
    const relationshipStrength = userProfile.relationshipStrengths.get(post.userId) || 0;
    return 1 + (relationshipStrength / 100); // Normalize to 1-2 range
  }

  calculateDiversityFactor(post, userProfile) {
    // Ensure diversity in feed
    const recentPosts = userProfile.recentInteractions.slice(-20);
    const similarPosts = recentPosts.filter(interaction => 
      this.arePostsSimilar(interaction.postId, post.id)
    );

    // Penalize if too many similar posts recently
    return Math.max(0.5, 1 - (similarPosts.length * 0.1));
  }

  arePostsSimilar(postId1, postId2) {
    const post1 = this.feedSystem.posts.get(postId1);
    const post2 = this.feedSystem.posts.get(postId2);
    
    if (!post1 || !post2) return false;

    // Check hashtag similarity
    const commonHashtags = post1.content.hashtags.filter(tag => 
      post2.content.hashtags.includes(tag)
    );
    
    if (commonHashtags.length > 0) return true;

    // Check location similarity
    if (post1.content.location && post2.content.location) {
      const distance = this.calculateDistance(
        post1.content.location.latitude,
        post1.content.location.longitude,
        post2.content.location.latitude,
        post2.content.location.longitude
      );
      
      if (distance < 5) return true; // Within 5km
    }

    return false;
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
}

class ContentModeration {
  constructor(feedSystem) {
    this.feedSystem = feedSystem;
    this.blockedWords = new Set(['spam', 'abuse', 'inappropriate']); // Add actual moderation words
    this.suspiciousPatterns = new Set();
  }

  moderatePost(post) {
    const issues = [];

    // Check for inappropriate content
    const words = post.content.caption.toLowerCase().split(' ');
    const foundInappropriate = words.some(word => this.blockedWords.has(word));
    
    if (foundInappropriate) {
      issues.push('inappropriate_content');
    }

    // Check for spam patterns
    if (this.isSpam(post)) {
      issues.push('spam');
    }

    // Check for duplicate content
    if (this.isDuplicate(post)) {
      issues.push('duplicate_content');
    }

    return {
      isApproved: issues.length === 0,
      issues,
      requiresReview: issues.length > 0
    };
  }

  isSpam(post) {
    // Implement spam detection logic
    const caption = post.content.caption;
    
    // Check for excessive hashtags
    if (post.content.hashtags.length > 30) return true;
    
    // Check for repetitive content
    const words = caption.split(' ');
    const uniqueWords = new Set(words);
    if (words.length / uniqueWords.size > 2) return true;
    
    return false;
  }

  isDuplicate(post) {
    // Check for duplicate posts from same user
    const userPosts = Array.from(this.feedSystem.posts.values())
      .filter(p => p.userId === post.userId && !p.isDeleted);
    
    const recentPosts = userPosts.filter(p => 
      Math.abs(new Date(p.createdAt) - new Date(post.createdAt)) < 60000 // Within 1 minute
    );
    
    return recentPosts.length > 1;
  }
}

class FeedAnalytics {
  constructor(feedSystem) {
    this.feedSystem = feedSystem;
    this.metrics = new Map();
  }

  trackEvent(eventType, data) {
    const key = `${eventType}:${new Date().toISOString().split('T')[0]}`;
    const current = this.metrics.get(key) || { count: 0, users: new Set(), data: [] };
    current.count++;
    current.users.add(data.userId);
    current.data.push(data);
    
    this.metrics.set(key, current);
  }

  getMetrics(timeRange = '24h') {
    const now = Date.now();
    const rangeMs = this.parseTimeRange(timeRange);
    const relevantMetrics = {};
    
    for (const [key, value] of this.metrics.entries()) {
      const metricDate = new Date(key.split(':')[1]);
      if (now - metricDate.getTime() <= rangeMs) {
        relevantMetrics[key] = value;
      }
    }
    
    return relevantMetrics;
  }

  parseTimeRange(timeRange) {
    switch (timeRange) {
      case '1h': return 60 * 60 * 1000;
      case '6h': return 6 * 60 * 60 * 1000;
      case '24h': return 24 * 60 * 60 * 1000;
      case '7d': return 7 * 24 * 60 * 60 * 1000;
      case '30d': return 30 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  getTopPosts(timeRange = '24h', limit = 10) {
    const posts = Array.from(this.feedSystem.posts.values())
      .filter(post => !post.isDeleted)
      .filter(post => {
        const postAge = Date.now() - new Date(post.createdAt).getTime();
        const rangeMs = this.parseTimeRange(timeRange);
        return postAge <= rangeMs;
      })
      .sort((a, b) => b.engagement.likes - a.engagement.likes)
      .slice(0, limit);
    
    return posts;
  }

  getTopUsers(timeRange = '24h', limit = 10) {
    const userEngagement = new Map();
    
    for (const post of this.feedSystem.posts.values()) {
      if (post.isDeleted) continue;
      
      const postAge = Date.now() - new Date(post.createdAt).getTime();
      const rangeMs = this.parseTimeRange(timeRange);
      
      if (postAge <= rangeMs) {
        const current = userEngagement.get(post.userId) || 0;
        userEngagement.set(post.userId, current + post.engagement.likes);
      }
    }
    
    const sorted = Array.from(userEngagement.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    
    return sorted.map(([userId, engagement]) => ({
      userId,
      engagement,
      user: this.feedSystem.users.get(userId)
    }));
  }
}

// Initialize the feed system
const feedSystem = new FeedSystem();

// Express app setup
const app = express();
const PORT = process.env.FEED_PORT || 8102;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

function startServer(port = PORT, host = '0.0.0.0') {
  const normalizedPort = Number.parseInt(String(port), 10);
  if (!Number.isFinite(normalizedPort) || normalizedPort <= 0) {
    throw new Error('Invalid FEED_PORT value');
  }
  feedSystem.initializeWebSocketServer(normalizedPort + 1);

  return app.listen(normalizedPort, host, () => {
    console.log(`[FeedSystem] Server running on port ${normalizedPort}`);
  });
}

// API Routes

// User Management
app.post('/api/v1/feed/users', (req, res) => {
  try {
    const user = feedSystem.createUser(req.body);
    res.status(201).json({
      success: true,
      user
    });
  } catch (error) {
    console.error('[Feed] Create user error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Follow/Unfollow
app.post('/api/v1/feed/users/:userId/follow', (req, res) => {
  try {
    const { userId } = req.params;
    const { followerId } = req.body;
    
    const result = feedSystem.followUser(followerId, userId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Follow error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/v1/feed/users/:userId/unfollow', (req, res) => {
  try {
    const { userId } = req.params;
    const { followerId } = req.body;
    
    const result = feedSystem.unfollowUser(followerId, userId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Unfollow error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Block/Unblock
app.post('/api/v1/feed/users/:userId/block', (req, res) => {
  try {
    const { userId } = req.params;
    const { blockerId } = req.body;
    
    const result = feedSystem.blockUser(blockerId, userId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Block error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/v1/feed/users/:userId/unblock', (req, res) => {
  try {
    const { userId } = req.params;
    const { unblockerId } = req.body;
    
    const result = feedSystem.unblockUser(unblockerId, userId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Unblock error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Post Management
app.post('/api/v1/feed/posts', (req, res) => {
  try {
    const post = feedSystem.createPost(req.body);
    res.status(201).json({
      success: true,
      post
    });
  } catch (error) {
    console.error('[Feed] Create post error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Feed Endpoints
app.get('/api/v1/feed', (req, res) => {
  try {
    const { userId } = req.query;
    const options = {
      limit: parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0,
      feedType: req.query.feedType || 'main'
    };
    
    const feed = feedSystem.getUserFeed(userId, options);
    res.json({
      success: true,
      ...feed
    });
  } catch (error) {
    console.error('[Feed] Get feed error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Interaction Endpoints
app.post('/api/v1/feed/posts/:postId/like', (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;
    
    const result = feedSystem.likePost(userId, postId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Like error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/v1/feed/posts/:postId/unlike', (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;
    
    const result = feedSystem.unlikePost(userId, postId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Unlike error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/v1/feed/posts/:postId/save', (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;
    
    const result = feedSystem.savePost(userId, postId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Save error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/v1/feed/posts/:postId/unsave', (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;
    
    const result = feedSystem.unsavePost(userId, postId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Unsave error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Comment Endpoints
app.post('/api/v1/feed/posts/:postId/comments', (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, content, parentId, mentions } = req.body;
    
    const comment = feedSystem.addComment(userId, postId, {
      content,
      parentId,
      mentions
    });
    
    res.status(201).json({
      success: true,
      comment
    });
  } catch (error) {
    console.error('[Feed] Add comment error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/v1/feed/posts/:postId/comments', (req, res) => {
  try {
    const { postId } = req.params;
    const options = {
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
      sortBy: req.query.sortBy || 'newest'
    };
    
    const comments = feedSystem.getPostComments(postId, options);
    res.json({
      success: true,
      ...comments
    });
  } catch (error) {
    console.error('[Feed] Get comments error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Story Endpoints
app.post('/api/v1/feed/stories', (req, res) => {
  try {
    const story = feedSystem.createStory(req.body);
    res.status(201).json({
      success: true,
      story
    });
  } catch (error) {
    console.error('[Feed] Create story error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/v1/feed/users/:userId/stories', (req, res) => {
  try {
    const { userId } = req.params;
    const { viewerId } = req.query;
    
    const stories = feedSystem.getUserStories(userId, viewerId);
    res.json({
      success: true,
      ...stories
    });
  } catch (error) {
    console.error('[Feed] Get stories error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/v1/feed/stories/:storyId/view', (req, res) => {
  try {
    const { storyId } = req.params;
    const { viewerId } = req.body;
    
    const result = feedSystem.viewStory(storyId, viewerId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] View story error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Notification Endpoints
app.get('/api/v1/feed/notifications', (req, res) => {
  try {
    const { userId } = req.query;
    const options = {
      limit: parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0,
      unreadOnly: req.query.unreadOnly === 'true'
    };
    
    const notifications = feedSystem.getUserNotifications(userId, options);
    res.json({
      success: true,
      ...notifications
    });
  } catch (error) {
    console.error('[Feed] Get notifications error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/v1/feed/notifications/:notificationId/read', (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userId } = req.body;
    
    const result = feedSystem.markNotificationRead(userId, notificationId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Mark notification read error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/v1/feed/notifications/read-all', (req, res) => {
  try {
    const { userId } = req.body;
    
    const result = feedSystem.markAllNotificationsRead(userId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Feed] Mark all notifications read error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Analytics Endpoints
app.get('/api/v1/feed/analytics', (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    const metrics = feedSystem.analytics.getMetrics(timeRange);
    const topPosts = feedSystem.analytics.getTopPosts(timeRange);
    const topUsers = feedSystem.analytics.getTopUsers(timeRange);
    
    res.json({
      success: true,
      timeRange,
      metrics,
      topPosts,
      topUsers
    });
  } catch (error) {
    console.error('[Feed] Analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics'
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'feed-system',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: PORT,
    websocketPort: PORT + 1,
    users: feedSystem.users.size,
    posts: feedSystem.posts.size,
    stories: feedSystem.stories.size
  });
});

if (require.main === module) {
  startServer();
}

module.exports = { FeedSystem, app, feedSystem, startServer };
