// Professional Explore & Discover System for MacRadar Backend
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

class ExploreSystem {
  constructor() {
    this.posts = new Map();
    this.users = new Map();
    this.trends = new Map();
    this.categories = new Map();
    this.locations = new Map();
    this.hashtags = new Map();
    this.userInteractions = new Map();
    this.recommendationEngine = new RecommendationEngine(this);
    this.analytics = new AnalyticsEngine(this);
    this.wsServer = null;
    this.initializeData();
  }

  initializeData() {
    // Initialize default categories
    this.categories.set('food', { name: 'Food & Dining', icon: 'restaurant', color: '#FF6B6B' });
    this.categories.set('travel', { name: 'Travel', icon: 'plane', color: '#4ECDC4' });
    this.categories.set('fashion', { name: 'Fashion', icon: 'shirt', color: '#45B7D1' });
    this.categories.set('tech', { name: 'Technology', icon: 'laptop', color: '#96CEB4' });
    this.categories.set('fitness', { name: 'Fitness', icon: 'dumbbell', color: '#FFEAA7' });
    this.categories.set('art', { name: 'Art & Design', icon: 'palette', color: '#DDA0DD' });
    this.categories.set('music', { name: 'Music', icon: 'music', color: '#FF69B4' });
    this.categories.set('nature', { name: 'Nature', icon: 'leaf', color: '#98D8C8' });
  }

  initializeWebSocketServer(port = 8099) {
    this.wsServer = new WebSocket.Server({ port });
    
    this.wsServer.on('connection', (ws, req) => {
      const userId = this.extractUserIdFromRequest(req);
      this.handleUserConnection(ws, userId);
    });

    console.log(`[ExploreSystem] WebSocket server running on port ${port}`);
  }

  extractUserIdFromRequest(req) {
    const url = new URL(req.url, `http://localhost:8099`);
    return url.searchParams.get('userId') || 'anonymous';
  }

  handleUserConnection(ws, userId) {
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleWebSocketMessage(userId, message);
      } catch (error) {
        console.error('[ExploreSystem] WebSocket message error:', error);
      }
    });
  }

  handleWebSocketMessage(userId, message) {
    switch (message.type) {
      case 'explore_request':
        this.handleExploreRequest(userId, message);
        break;
      case 'trending_request':
        this.handleTrendingRequest(userId, message);
        break;
      case 'interaction':
        this.handleUserInteraction(userId, message);
        break;
    }
  }

  handleExploreRequest(userId, message) {
    const { filters, limit = 20, offset = 0 } = message;
    const recommendations = this.recommendationEngine.getRecommendations(userId, filters, limit, offset);
    
    this.sendToUser(userId, {
      type: 'explore_response',
      recommendations,
      timestamp: new Date().toISOString()
    });
  }

  handleTrendingRequest(userId, message) {
    const { category, timeRange = '24h' } = message;
    const trending = this.getTrendingContent(category, timeRange);
    
    this.sendToUser(userId, {
      type: 'trending_response',
      trending,
      timestamp: new Date().toISOString()
    });
  }

  handleUserInteraction(userId, message) {
    const { postId, interactionType, metadata = {} } = message;
    this.recordUserInteraction(userId, postId, interactionType, metadata);
    this.analytics.trackInteraction(userId, postId, interactionType, metadata);
  }

  sendToUser(userId, message) {
    // Implementation for sending messages to specific users
  }

  createPost(postData) {
    const post = {
      id: this.generatePostId(),
      userId: postData.userId,
      content: postData.content,
      media: postData.media || [],
      location: postData.location || null,
      hashtags: postData.hashtags || [],
      category: postData.category || 'general',
      mentions: postData.mentions || [],
      metadata: {
        likes: 0,
        comments: 0,
        shares: 0,
        views: 0,
        ...postData.metadata
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPublic: postData.isPublic !== false,
      isDeleted: false,
      engagement: {
        score: 0,
        velocity: 0,
        reach: 0
      }
    };

    this.posts.set(post.id, post);
    this.updateTrends(post);
    this.updateHashtags(post.hashtags);
    this.updateLocation(post.location);
    
    return post;
  }

  generatePostId() {
    return 'post_' + crypto.randomBytes(16).toString('hex');
  }

  updateTrends(post) {
    const category = post.category;
    if (!this.trends.has(category)) {
      this.trends.set(category, []);
    }
    
    const categoryTrends = this.trends.get(category);
    categoryTrends.push({
      postId: post.id,
      timestamp: post.createdAt,
      engagement: post.metadata.likes + post.metadata.comments + post.metadata.shares
    });

    // Keep only last 1000 posts per category
    if (categoryTrends.length > 1000) {
      categoryTrends.splice(0, categoryTrends.length - 1000);
    }
  }

  updateHashtags(hashtags) {
    hashtags.forEach(hashtag => {
      if (!this.hashtags.has(hashtag)) {
        this.hashtags.set(hashtag, {
          count: 0,
          posts: [],
          trending: false
        });
      }
      
      const hashtagData = this.hashtags.get(hashtag);
      hashtagData.count++;
      hashtagData.posts.push(Date.now());
      
      // Update trending status
      const recentPosts = hashtagData.posts.filter(time => 
        Date.now() - time < 24 * 60 * 60 * 1000 // Last 24 hours
      );
      
      hashtagData.trending = recentPosts.length > 10; // Threshold for trending
    });
  }

  updateLocation(location) {
    if (!location) return;
    
    const locationKey = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
    if (!this.locations.has(locationKey)) {
      this.locations.set(locationKey, {
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name || 'Unknown Location',
        posts: [],
        popularity: 0
      });
    }
    
    const locationData = this.locations.get(locationKey);
    locationData.posts.push(Date.now());
    locationData.popularity = locationData.posts.length;
  }

  getTrendingContent(category, timeRange) {
    const categoryTrends = this.trends.get(category) || [];
    const now = Date.now();
    const timeRangeMs = this.parseTimeRange(timeRange);
    
    const recentTrends = categoryTrends.filter(trend => 
      now - new Date(trend.timestamp).getTime() <= timeRangeMs
    );

    // Sort by engagement and return top posts
    recentTrends.sort((a, b) => b.engagement - a.engagement);
    
    return recentTrends.slice(0, 20).map(trend => ({
      ...trend,
      post: this.posts.get(trend.postId)
    }));
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

  recordUserInteraction(userId, postId, interactionType, metadata) {
    if (!this.userInteractions.has(userId)) {
      this.userInteractions.set(userId, []);
    }
    
    const interactions = this.userInteractions.get(userId);
    interactions.push({
      postId,
      interactionType,
      timestamp: new Date().toISOString(),
      metadata
    });

    // Update post engagement
    const post = this.posts.get(postId);
    if (post) {
      switch (interactionType) {
        case 'like':
          post.metadata.likes++;
          break;
        case 'comment':
          post.metadata.comments++;
          break;
        case 'share':
          post.metadata.shares++;
          break;
        case 'view':
          post.metadata.views++;
          break;
      }
      
      post.engagement.score = post.metadata.likes + post.metadata.comments + post.metadata.shares;
      post.updatedAt = new Date().toISOString();
    }
  }

  searchPosts(query, filters = {}) {
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const post of this.posts.values()) {
      if (post.isDeleted) continue;
      
      // Text search
      const matchesText = post.content.toLowerCase().includes(queryLower);
      const matchesHashtags = post.hashtags.some(tag => tag.toLowerCase().includes(queryLower));
      const matchesMentions = post.mentions.some(mention => mention.toLowerCase().includes(queryLower));
      
      if (!matchesText && !matchesHashtags && !matchesMentions) continue;
      
      // Apply filters
      if (filters.category && post.category !== filters.category) continue;
      if (filters.location && !this.matchesLocation(post.location, filters.location)) continue;
      if (filters.dateRange && !this.matchesDateRange(post.createdAt, filters.dateRange)) continue;
      
      results.push(post);
    }
    
    // Sort by relevance (engagement score + recency)
    results.sort((a, b) => {
      const scoreA = this.calculateRelevanceScore(a, query);
      const scoreB = this.calculateRelevanceScore(b, query);
      return scoreB - scoreA;
    });
    
    return results;
  }

  calculateRelevanceScore(post, query) {
    const queryLower = query.toLowerCase();
    let score = post.engagement.score;
    
    // Boost for exact matches
    if (post.content.toLowerCase().includes(queryLower)) {
      score *= 2;
    }
    
    // Boost for recent posts
    const hoursSinceCreation = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
    const recencyBoost = Math.max(0, 1 - hoursSinceCreation / 24); // Decay over 24 hours
    score *= (1 + recencyBoost);
    
    return score;
  }

  matchesLocation(postLocation, filterLocation) {
    if (!postLocation || !filterLocation) return false;
    
    const distance = this.calculateDistance(
      postLocation.latitude,
      postLocation.longitude,
      filterLocation.latitude,
      filterLocation.longitude
    );
    
    return distance <= (filterLocation.radius || 10); // Default 10km radius
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

  matchesDateRange(postDate, dateRange) {
    const post = new Date(postDate);
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    
    return post >= start && post <= end;
  }

  getExploreFeed(userId, options = {}) {
    const { 
      limit = 20, 
      offset = 0, 
      categories = [], 
      location = null,
      refresh = false 
    } = options;
    
    const recommendations = this.recommendationEngine.getRecommendations(
      userId, 
      { categories, location }, 
      limit, 
      offset
    );
    
    return {
      posts: recommendations,
      hasMore: recommendations.length === limit,
      nextOffset: offset + limit,
      timestamp: new Date().toISOString()
    };
  }
}

class RecommendationEngine {
  constructor(exploreSystem) {
    this.exploreSystem = exploreSystem;
    this.userProfiles = new Map();
  }

  getRecommendations(userId, filters, limit, offset) {
    const userProfile = this.getUserProfile(userId);
    const candidates = this.getCandidatePosts(filters);
    const scored = candidates.map(post => ({
      post,
      score: this.calculateScore(userProfile, post)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(offset, offset + limit).map(item => item.post);
  }

  getUserProfile(userId) {
    if (!this.userProfiles.has(userId)) {
      this.userProfiles.set(userId, {
        interests: new Map(),
        interactionHistory: [],
        preferredCategories: [],
        preferredLocations: [],
        lastActive: new Date().toISOString()
      });
    }
    return this.userProfiles.get(userId);
  }

  getCandidatePosts(filters) {
    const candidates = [];
    
    for (const post of this.exploreSystem.posts.values()) {
      if (post.isDeleted || !post.isPublic) continue;
      
      // Apply filters
      if (filters.categories.length > 0 && !filters.categories.includes(post.category)) continue;
      if (filters.location && !this.exploreSystem.matchesLocation(post.location, filters.location)) continue;
      
      candidates.push(post);
    }
    
    return candidates;
  }

  calculateScore(userProfile, post) {
    let score = 0;
    
    // Interest-based scoring
    const interestScore = this.calculateInterestScore(userProfile, post);
    score += interestScore * 0.4;
    
    // Engagement-based scoring
    const engagementScore = Math.log(post.engagement.score + 1);
    score += engagementScore * 0.3;
    
    // Recency scoring
    const recencyScore = this.calculateRecencyScore(post);
    score += recencyScore * 0.2;
    
    // Diversity scoring
    const diversityScore = this.calculateDiversityScore(userProfile, post);
    score += diversityScore * 0.1;
    
    return score;
  }

  calculateInterestScore(userProfile, post) {
    let score = 0;
    
    // Category interest
    const categoryInterest = userProfile.interests.get(post.category) || 0;
    score += categoryInterest;
    
    // Hashtag interest
    post.hashtags.forEach(hashtag => {
      const hashtagInterest = userProfile.interests.get(`hashtag:${hashtag}`) || 0;
      score += hashtagInterest * 0.5;
    });
    
    // Location interest
    if (post.location) {
      const locationKey = `${post.location.latitude.toFixed(2)},${post.location.longitude.toFixed(2)}`;
      const locationInterest = userProfile.interests.get(`location:${locationKey}`) || 0;
      score += locationInterest * 0.3;
    }
    
    return score;
  }

  calculateRecencyScore(post) {
    const hoursSinceCreation = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
    return Math.max(0, 1 - hoursSinceCreation / 48); // Decay over 48 hours
  }

  calculateDiversityScore(userProfile, post) {
    // Encourage diversity in recommendations
    const recentInteractions = userProfile.interactionHistory.slice(-50);
    const similarPosts = recentInteractions.filter(interaction => 
      this.arePostsSimilar(interaction.postId, post.id)
    );
    
    // Penalize if too many similar posts recently
    return Math.max(0, 1 - similarPosts.length * 0.1);
  }

  arePostsSimilar(postId1, postId2) {
    const post1 = this.exploreSystem.posts.get(postId1);
    const post2 = this.exploreSystem.posts.get(postId2);
    
    if (!post1 || !post2) return false;
    
    // Check category similarity
    if (post1.category === post2.category) return true;
    
    // Check hashtag overlap
    const commonHashtags = post1.hashtags.filter(tag => post2.hashtags.includes(tag));
    if (commonHashtags.length > 0) return true;
    
    // Check location proximity
    if (post1.location && post2.location) {
      const distance = this.exploreSystem.calculateDistance(
        post1.location.latitude,
        post1.location.longitude,
        post2.location.latitude,
        post2.location.longitude
      );
      if (distance < 5) return true; // Within 5km
    }
    
    return false;
  }

  updateUserProfile(userId, postId, interactionType) {
    const userProfile = this.getUserProfile(userId);
    const post = this.exploreSystem.posts.get(postId);
    
    if (!post) return;
    
    // Update interests
    this.updateInterest(userProfile, post.category, interactionType);
    
    post.hashtags.forEach(hashtag => {
      this.updateInterest(userProfile, `hashtag:${hashtag}`, interactionType);
    });
    
    if (post.location) {
      const locationKey = `${post.location.latitude.toFixed(2)},${post.location.longitude.toFixed(2)}`;
      this.updateInterest(userProfile, `location:${locationKey}`, interactionType);
    }
    
    // Update interaction history
    userProfile.interactionHistory.push({
      postId,
      interactionType,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 100 interactions
    if (userProfile.interactionHistory.length > 100) {
      userProfile.interactionHistory = userProfile.interactionHistory.slice(-100);
    }
    
    userProfile.lastActive = new Date().toISOString();
  }

  updateInterest(userProfile, interestKey, interactionType) {
    const currentScore = userProfile.interests.get(interestKey) || 0;
    let delta = 0;
    
    switch (interactionType) {
      case 'like':
        delta = 1;
        break;
      case 'comment':
        delta = 2;
        break;
      case 'share':
        delta = 3;
        break;
      case 'view':
        delta = 0.1;
        break;
      case 'skip':
        delta = -0.5;
        break;
    }
    
    userProfile.interests.set(interestKey, currentScore + delta);
  }
}

class AnalyticsEngine {
  constructor(exploreSystem) {
    this.exploreSystem = exploreSystem;
    this.metrics = new Map();
  }

  trackInteraction(userId, postId, interactionType, metadata) {
    const key = `${interactionType}:${new Date().toISOString().split('T')[0]}`;
    const current = this.metrics.get(key) || { count: 0, users: new Set() };
    current.count++;
    current.users.add(userId);
    this.metrics.set(key, current);
  }

  getMetrics(timeRange = '24h') {
    const now = Date.now();
    const rangeMs = this.exploreSystem.parseTimeRange(timeRange);
    const relevantMetrics = {};
    
    for (const [key, value] of this.metrics.entries()) {
      const metricDate = new Date(key.split(':')[1]);
      if (now - metricDate.getTime() <= rangeMs) {
        relevantMetrics[key] = value;
      }
    }
    
    return relevantMetrics;
  }

  getTopCategories(timeRange = '24h') {
    const categoryScores = new Map();
    
    for (const post of this.exploreSystem.posts.values()) {
      if (post.isDeleted) continue;
      
      const postAge = Date.now() - new Date(post.createdAt).getTime();
      const rangeMs = this.exploreSystem.parseTimeRange(timeRange);
      
      if (postAge <= rangeMs) {
        const currentScore = categoryScores.get(post.category) || 0;
        categoryScores.set(post.category, currentScore + post.engagement.score);
      }
    }
    
    const sorted = Array.from(categoryScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    return sorted.map(([category, score]) => ({
      category,
      score,
      info: this.exploreSystem.categories.get(category)
    }));
  }

  getTopHashtags(timeRange = '24h') {
    const hashtagScores = new Map();
    
    for (const post of this.exploreSystem.posts.values()) {
      if (post.isDeleted) continue;
      
      const postAge = Date.now() - new Date(post.createdAt).getTime();
      const rangeMs = this.exploreSystem.parseTimeRange(timeRange);
      
      if (postAge <= rangeMs) {
        post.hashtags.forEach(hashtag => {
          const currentScore = hashtagScores.get(hashtag) || 0;
          hashtagScores.set(hashtag, currentScore + post.engagement.score);
        });
      }
    }
    
    const sorted = Array.from(hashtagScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    return sorted.map(([hashtag, score]) => ({
      hashtag,
      score,
      info: this.exploreSystem.hashtags.get(hashtag)
    }));
  }
}

// Initialize the explore system
const exploreSystem = new ExploreSystem();

// Express app setup
const app = express();
const PORT = process.env.EXPLORE_PORT || 8099;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Initialize WebSocket
exploreSystem.initializeWebSocketServer(PORT + 1);

// API Routes

// Get explore feed
app.get('/api/v1/explore/feed', (req, res) => {
  try {
    const { userId } = req.query;
    const options = {
      limit: parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0,
      categories: req.query.categories ? req.query.categories.split(',') : [],
      location: req.query.location ? JSON.parse(req.query.location) : null
    };
    
    const feed = exploreSystem.getExploreFeed(userId, options);
    
    res.json({
      success: true,
      ...feed
    });
  } catch (error) {
    console.error('[Explore] Feed error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get explore feed'
    });
  }
});

// Search posts
app.get('/api/v1/explore/search', (req, res) => {
  try {
    const { q: query } = req.query;
    const filters = {
      category: req.query.category,
      location: req.query.location ? JSON.parse(req.query.location) : null,
      dateRange: req.query.dateRange ? JSON.parse(req.query.dateRange) : null
    };
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }
    
    const results = exploreSystem.searchPosts(query, filters);
    
    res.json({
      success: true,
      query,
      results: results.slice(0, 50), // Limit results
      total: results.length
    });
  } catch (error) {
    console.error('[Explore] Search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
});

// Get trending content
app.get('/api/v1/explore/trending', (req, res) => {
  try {
    const { category, timeRange = '24h' } = req.query;
    
    const trending = exploreSystem.getTrendingContent(category, timeRange);
    
    res.json({
      success: true,
      category,
      timeRange,
      trending
    });
  } catch (error) {
    console.error('[Explore] Trending error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get trending content'
    });
  }
});

// Create new post
app.post('/api/v1/explore/posts', (req, res) => {
  try {
    const postData = req.body;
    
    if (!postData.userId || !postData.content) {
      return res.status(400).json({
        success: false,
        error: 'User ID and content are required'
      });
    }
    
    const post = exploreSystem.createPost(postData);
    
    res.status(201).json({
      success: true,
      post
    });
  } catch (error) {
    console.error('[Explore] Create post error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create post'
    });
  }
});

// Record interaction
app.post('/api/v1/explore/posts/:postId/interact', (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, interactionType, metadata = {} } = req.body;
    
    if (!userId || !interactionType) {
      return res.status(400).json({
        success: false,
        error: 'User ID and interaction type are required'
      });
    }
    
    exploreSystem.recordUserInteraction(userId, postId, interactionType, metadata);
    exploreSystem.recommendationEngine.updateUserProfile(userId, postId, interactionType);
    
    res.json({
      success: true,
      message: 'Interaction recorded successfully'
    });
  } catch (error) {
    console.error('[Explore] Interaction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record interaction'
    });
  }
});

// Get categories
app.get('/api/v1/explore/categories', (req, res) => {
  try {
    const categories = Array.from(exploreSystem.categories.entries()).map(([key, value]) => ({
      key,
      ...value
    }));
    
    res.json({
      success: true,
      categories
    });
  } catch (error) {
    console.error('[Explore] Categories error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get categories'
    });
  }
});

// Get analytics
app.get('/api/v1/explore/analytics', (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    const metrics = exploreSystem.analytics.getMetrics(timeRange);
    const topCategories = exploreSystem.analytics.getTopCategories(timeRange);
    const topHashtags = exploreSystem.analytics.getTopHashtags(timeRange);
    
    res.json({
      success: true,
      timeRange,
      metrics,
      topCategories,
      topHashtags
    });
  } catch (error) {
    console.error('[Explore] Analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics'
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'explore-system',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: PORT,
    websocketPort: PORT + 1,
    posts: exploreSystem.posts.size,
    categories: exploreSystem.categories.size,
    hashtags: exploreSystem.hashtags.size
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ExploreSystem] Server running on port ${PORT}`);
});

module.exports = { ExploreSystem, app, exploreSystem };
