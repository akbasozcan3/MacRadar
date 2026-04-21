// Professional Search & Padding System for MacRadar Backend
const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');

class ProfessionalSearchSystem {
  constructor() {
    this.searchIndex = new Map();
    this.userProfiles = new Map();
    this.searchHistory = new Map();
    this.trendingQueries = new Map();
    this.paddingStrategies = new Map();
    this.performanceMetrics = {
      totalSearches: 0,
      avgResponseTime: 0,
      cacheHitRate: 0,
      popularQueries: new Map()
    };
    this.initializePaddingStrategies();
  }

  initializePaddingStrategies() {
    this.paddingStrategies.set('smart', {
      name: 'Smart Padding',
      description: 'Intelligent padding based on user behavior',
      apply: (results, options) => this.applySmartPadding(results, options)
    });

    this.paddingStrategies.set('balanced', {
      name: 'Balanced Padding',
      description: 'Even distribution of results',
      apply: (results, options) => this.applyBalancedPadding(results, options)
    });

    this.paddingStrategies.set('quality', {
      name: 'Quality Padding',
      description: 'Prioritize high-quality content',
      apply: (results, options) => this.applyQualityPadding(results, options)
    });

    this.paddingStrategies.set('diversity', {
      name: 'Diversity Padding',
      description: 'Ensure content diversity',
      apply: (results, options) => this.applyDiversityPadding(results, options)
    });
  }

  // Smart Padding Algorithm
  applySmartPadding(results, options = {}) {
    const { userId, query, limit = 20 } = options;
    const userProfile = this.getUserProfile(userId);
    
    // Score each result based on multiple factors
    const scoredResults = results.map(result => ({
      ...result,
      score: this.calculateSmartScore(result, userProfile, query)
    }));

    // Sort by score
    scoredResults.sort((a, b) => b.score - a.score);

    // Apply diversity constraints
    const diversifiedResults = this.ensureDiversity(scoredResults, userProfile);

    // Apply padding for optimal user experience
    const paddedResults = this.applyOptimalPadding(diversifiedResults, limit);

    return {
      results: paddedResults,
      strategy: 'smart',
      totalFound: results.length,
      returned: paddedResults.length,
      paddingApplied: true,
      metrics: this.calculatePaddingMetrics(results, paddedResults)
    };
  }

  calculateSmartScore(result, userProfile, query) {
    let score = 0;

    // Base relevance score
    score += result.relevanceScore || 0;

    // User preference alignment
    score += this.calculateUserPreferenceScore(result, userProfile);

    // Content quality score
    score += this.calculateQualityScore(result);

    // Freshness score
    score += this.calculateFreshnessScore(result);

    // Engagement score
    score += this.calculateEngagementScore(result);

    // Query matching boost
    score += this.calculateQueryMatchScore(result, query);

    // Diversity penalty for similar content
    score -= this.calculateSimilarityPenalty(result, userProfile);

    return score;
  }

  calculateUserPreferenceScore(result, userProfile) {
    let score = 0;

    // Category preferences
    if (userProfile.preferredCategories && result.category) {
      const categoryWeight = userProfile.preferredCategories.get(result.category) || 0;
      score += categoryWeight * 10;
    }

    // Author preferences
    if (userProfile.preferredAuthors && result.authorId) {
      const authorWeight = userProfile.preferredAuthors.get(result.authorId) || 0;
      score += authorWeight * 5;
    }

    // Content type preferences
    if (userProfile.preferredContentTypes && result.contentType) {
      const typeWeight = userProfile.preferredContentTypes.get(result.contentType) || 0;
      score += typeWeight * 3;
    }

    return score;
  }

  calculateQualityScore(result) {
    let score = 0;

    // Media quality
    if (result.hasMedia) score += 5;
    if (result.hasHD) score += 3;
    if (result.hasOriginalAudio) score += 2;

    // Content length optimization
    if (result.contentLength) {
      if (result.contentLength > 50 && result.contentLength < 500) {
        score += 3; // Optimal length
      }
    }

    // Metadata completeness
    if (result.hasLocation) score += 2;
    if (result.hasHashtags) score += 1;
    if (result.hasMentions) score += 1;

    return score;
  }

  calculateFreshnessScore(result) {
    if (!result.createdAt) return 0;

    const hoursSinceCreation = (Date.now() - new Date(result.createdAt).getTime()) / (1000 * 60 * 60);
    
    // Exponential decay for freshness
    if (hoursSinceCreation < 1) return 10;
    if (hoursSinceCreation < 6) return 8;
    if (hoursSinceCreation < 24) return 6;
    if (hoursSinceCreation < 72) return 4;
    if (hoursSinceCreation < 168) return 2;
    
    return 0;
  }

  calculateEngagementScore(result) {
    let score = 0;

    // Weight different engagement types
    score += (result.likes || 0) * 1;
    score += (result.comments || 0) * 2;
    score += (result.shares || 0) * 3;
    score += (result.saves || 0) * 2.5;

    // Normalize by content age
    if (result.createdAt) {
      const hoursSinceCreation = (Date.now() - new Date(result.createdAt).getTime()) / (1000 * 60 * 60);
      const timeDecay = Math.max(0.1, 1 - (hoursSinceCreation / 168)); // Decay over 1 week
      score *= timeDecay;
    }

    return score;
  }

  calculateQueryMatchScore(result, query) {
    if (!query || !result.content) return 0;

    const queryLower = query.toLowerCase();
    const contentLower = result.content.toLowerCase();

    // Exact match bonus
    if (contentLower.includes(queryLower)) {
      return 15;
    }

    // Word matching
    const queryWords = queryLower.split(' ').filter(word => word.length > 2);
    const contentWords = contentLower.split(' ');
    
    let matchCount = 0;
    queryWords.forEach(queryWord => {
      if (contentWords.some(contentWord => contentWord.includes(queryWord))) {
        matchCount++;
      }
    });

    return (matchCount / queryWords.length) * 10;
  }

  calculateSimilarityPenalty(result, userProfile) {
    if (!userProfile.recentlyViewed) return 0;

    let similarityScore = 0;
    userProfile.recentlyViewed.forEach(recentItem => {
      similarityScore += this.calculateContentSimilarity(result, recentItem);
    });

    return similarityScore * 2; // Penalty for similar content
  }

  calculateContentSimilarity(item1, item2) {
    let similarity = 0;

    // Author similarity
    if (item1.authorId === item2.authorId) similarity += 0.3;

    // Category similarity
    if (item1.category === item2.category) similarity += 0.4;

    // Hashtag overlap
    if (item1.hashtags && item2.hashtags) {
      const commonHashtags = item1.hashtags.filter(tag => item2.hashtags.includes(tag));
      similarity += (commonHashtags.length / Math.max(item1.hashtags.length, item2.hashtags.length)) * 0.3;
    }

    return similarity;
  }

  ensureDiversity(results, userProfile) {
    const diversified = [];
    const categoryCounts = new Map();
    const authorCounts = new Map();
    const typeCounts = new Map();

    // Diversity constraints
    const maxSameCategory = Math.max(1, Math.floor(results.length * 0.3));
    const maxSameAuthor = Math.max(1, Math.floor(results.length * 0.2));
    const maxSameType = Math.max(1, Math.floor(results.length * 0.4));

    results.forEach(result => {
      const categoryCount = categoryCounts.get(result.category) || 0;
      const authorCount = authorCounts.get(result.authorId) || 0;
      const typeCount = typeCounts.get(result.contentType) || 0;

      if (categoryCount < maxSameCategory &&
          authorCount < maxSameAuthor &&
          typeCount < maxSameType) {
        diversified.push(result);
        
        categoryCounts.set(result.category, categoryCount + 1);
        authorCounts.set(result.authorId, authorCount + 1);
        typeCounts.set(result.contentType, typeCount + 1);
      }
    });

    // Fill remaining slots with highest scoring items
    const remainingSlots = results.length - diversified.length;
    const remainingItems = results.filter(item => !diversified.includes(item))
      .sort((a, b) => b.score - a.score)
      .slice(0, remainingSlots);

    return [...diversified, ...remainingItems];
  }

  applyOptimalPadding(results, limit) {
    // Apply golden ratio for optimal user experience
    const goldenRatio = 0.618;
    const primaryResults = Math.floor(limit * goldenRatio);
    const secondaryResults = limit - primaryResults;

    // Split into high-quality and diverse content
    const highQuality = results.slice(0, primaryResults);
    const diverse = results.slice(primaryResults, primaryResults + secondaryResults);

    return [...highQuality, ...diverse];
  }

  // Balanced Padding
  applyBalancedPadding(results, options = {}) {
    const { limit = 20 } = options;
    
    // Even distribution across categories
    const categories = [...new Set(results.map(r => r.category))];
    const perCategory = Math.ceil(limit / categories.length);
    
    const balanced = [];
    categories.forEach(category => {
      const categoryResults = results.filter(r => r.category === category);
      balanced.push(...categoryResults.slice(0, perCategory));
    });

    return {
      results: balanced.slice(0, limit),
      strategy: 'balanced',
      totalFound: results.length,
      returned: balanced.length,
      paddingApplied: true
    };
  }

  // Quality Padding
  applyQualityPadding(results, options = {}) {
    const { limit = 20 } = options;
    
    // Sort by quality metrics
    const qualitySorted = results.sort((a, b) => {
      const scoreA = this.calculateQualityScore(a) + this.calculateEngagementScore(a);
      const scoreB = this.calculateQualityScore(b) + this.calculateEngagementScore(b);
      return scoreB - scoreA;
    });

    return {
      results: qualitySorted.slice(0, limit),
      strategy: 'quality',
      totalFound: results.length,
      returned: qualitySorted.length,
      paddingApplied: true
    };
  }

  // Diversity Padding
  applyDiversityPadding(results, options = {}) {
    const { limit = 20 } = options;
    
    // Maximize diversity
    const diversified = [];
    const usedCategories = new Set();
    const usedAuthors = new Set();
    const usedTypes = new Set();

    for (const result of results) {
      if (diversified.length >= limit) break;
      
      const categoryKey = result.category || 'unknown';
      const authorKey = result.authorId || 'unknown';
      const typeKey = result.contentType || 'unknown';

      // Prioritize unseen categories, authors, and types
      if (!usedCategories.has(categoryKey) || 
          !usedAuthors.has(authorKey) || 
          !usedTypes.has(typeKey)) {
        diversified.push(result);
        usedCategories.add(categoryKey);
        usedAuthors.add(authorKey);
        usedTypes.add(typeKey);
      }
    }

    return {
      results: diversified,
      strategy: 'diversity',
      totalFound: results.length,
      returned: diversified.length,
      paddingApplied: true
    };
  }

  // Search Methods
  async search(query, options = {}) {
    const startTime = Date.now();
    const { userId, strategy = 'smart', limit = 20, offset = 0, filters = {} } = options;

    // Update performance metrics
    this.performanceMetrics.totalSearches++;

    // Log search query
    this.logSearchQuery(userId, query);

    // Get base results
    let baseResults = await this.getBaseResults(query, filters);

    // Apply padding strategy
    const strategyFunction = this.paddingStrategies.get(strategy);
    if (!strategyFunction) {
      throw new Error(`Unknown padding strategy: ${strategy}`);
    }

    const paddedResults = strategyFunction.apply(baseResults, {
      userId,
      query,
      limit,
      offset,
      filters
    });

    // Update user profile based on search
    this.updateUserProfile(userId, query, paddedResults.results);

    // Calculate response time
    const responseTime = Date.now() - startTime;
    this.updatePerformanceMetrics(responseTime);

    return {
      query,
      strategy,
      ...paddedResults,
      responseTime,
      timestamp: new Date().toISOString()
    };
  }

  async getBaseResults(query, filters) {
    // Mock implementation - in real system, this would query databases
    const mockResults = [
      {
        id: 'result1',
        content: 'Amazing sunset photography from the mountains',
        category: 'nature',
        authorId: 'user1',
        contentType: 'image',
        relevanceScore: 0.9,
        likes: 150,
        comments: 23,
        shares: 45,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        hasMedia: true,
        hasHD: true,
        hashtags: ['sunset', 'mountains', 'photography'],
        hasLocation: true
      },
      {
        id: 'result2',
        content: 'Professional web development tips and tricks',
        category: 'tech',
        authorId: 'user2',
        contentType: 'article',
        relevanceScore: 0.85,
        likes: 89,
        comments: 15,
        shares: 67,
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        hasMedia: false,
        hashtags: ['webdev', 'programming', 'tips'],
        hasLocation: false
      },
      {
        id: 'result3',
        content: 'Delicious homemade pasta recipe tutorial',
        category: 'food',
        authorId: 'user3',
        contentType: 'video',
        relevanceScore: 0.8,
        likes: 234,
        comments: 56,
        shares: 89,
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        hasMedia: true,
        hasHD: true,
        hashtags: ['pasta', 'recipe', 'cooking'],
        hasLocation: false
      }
    ];

    // Filter by query
    if (query) {
      const queryLower = query.toLowerCase();
      return mockResults.filter(result => 
        result.content.toLowerCase().includes(queryLower) ||
        result.hashtags.some(tag => tag.toLowerCase().includes(queryLower))
      );
    }

    return mockResults;
  }

  getUserProfile(userId) {
    if (!this.userProfiles.has(userId)) {
      this.userProfiles.set(userId, {
        preferredCategories: new Map(),
        preferredAuthors: new Map(),
        preferredContentTypes: new Map(),
        recentlyViewed: [],
        searchHistory: [],
        lastActive: new Date().toISOString()
      });
    }
    return this.userProfiles.get(userId);
  }

  updateUserProfile(userId, query, results) {
    const profile = this.getUserProfile(userId);
    
    // Update search history
    profile.searchHistory.push({
      query,
      timestamp: new Date().toISOString(),
      resultCount: results.length
    });

    // Update recently viewed
    results.forEach(result => {
      profile.recentlyViewed.push({
        id: result.id,
        category: result.category,
        timestamp: new Date().toISOString()
      });
    });

    // Keep only recent items
    if (profile.searchHistory.length > 100) {
      profile.searchHistory = profile.searchHistory.slice(-100);
    }
    if (profile.recentlyViewed.length > 50) {
      profile.recentlyViewed = profile.recentlyViewed.slice(-50);
    }

    // Update preferences based on interactions
    results.forEach(result => {
      const categoryWeight = profile.preferredCategories.get(result.category) || 0;
      profile.preferredCategories.set(result.category, categoryWeight + 1);
    });

    profile.lastActive = new Date().toISOString();
  }

  logSearchQuery(userId, query) {
    if (!this.searchHistory.has(userId)) {
      this.searchHistory.set(userId, []);
    }
    
    this.searchHistory.get(userId).push({
      query,
      timestamp: new Date().toISOString()
    });

    // Update trending queries
    const currentCount = this.trendingQueries.get(query) || 0;
    this.trendingQueries.set(query, currentCount + 1);
  }

  updatePerformanceMetrics(responseTime) {
    // Update average response time
    const totalResponseTime = this.performanceMetrics.avgResponseTime * (this.performanceMetrics.totalSearches - 1) + responseTime;
    this.performanceMetrics.avgResponseTime = totalResponseTime / this.performanceMetrics.totalSearches;
  }

  calculatePaddingMetrics(originalResults, paddedResults) {
    return {
      originalCount: originalResults.length,
      paddedCount: paddedResults.length,
      paddingRatio: paddedResults.length / originalResults.length,
      diversityScore: this.calculateDiversityScore(paddedResults),
      qualityScore: this.calculateAverageQualityScore(paddedResults)
    };
  }

  calculateDiversityScore(results) {
    const categories = new Set(results.map(r => r.category));
    const authors = new Set(results.map(r => r.authorId));
    const types = new Set(results.map(r => r.contentType));
    
    return (categories.size + authors.size + types.size) / (results.length * 3);
  }

  calculateAverageQualityScore(results) {
    if (results.length === 0) return 0;
    
    const totalQuality = results.reduce((sum, result) => 
      sum + this.calculateQualityScore(result) + this.calculateEngagementScore(result), 0
    );
    
    return totalQuality / results.length;
  }

  // Analytics and Insights
  getSearchAnalytics(timeRange = '24h') {
    return {
      totalSearches: this.performanceMetrics.totalSearches,
      avgResponseTime: this.performanceMetrics.avgResponseTime,
      cacheHitRate: this.performanceMetrics.cacheHitRate,
      popularQueries: Array.from(this.performanceMetrics.popularQueries.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      trendingQueries: Array.from(this.trendingQueries.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      availableStrategies: Array.from(this.paddingStrategies.keys()),
      timestamp: new Date().toISOString()
    };
  }

  getUserAnalytics(userId) {
    const profile = this.getUserProfile(userId);
    const history = this.searchHistory.get(userId) || [];
    
    return {
      userId,
      preferredCategories: Array.from(profile.preferredCategories.entries())
        .sort((a, b) => b[1] - a[1]),
      searchCount: history.length,
      lastSearch: history.length > 0 ? history[history.length - 1] : null,
      profileStrength: this.calculateProfileStrength(profile),
      timestamp: new Date().toISOString()
    };
  }

  calculateProfileStrength(profile) {
    let strength = 0;
    
    strength += profile.preferredCategories.size * 10;
    strength += profile.preferredAuthors.size * 5;
    strength += profile.preferredContentTypes.size * 3;
    strength += Math.min(profile.searchHistory.length, 100);
    strength += Math.min(profile.recentlyViewed.length, 50);
    
    return Math.min(100, strength / 3); // Normalize to 0-100
  }
}

// Initialize the professional search system
const searchSystem = new ProfessionalSearchSystem();

// Express app setup
const app = express();
const PORT = process.env.SEARCH_PORT || 8104;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// API Routes

// Professional search endpoint with padding
app.post('/api/v1/search', async (req, res) => {
  try {
    const { query, userId, strategy = 'smart', limit = 20, offset = 0, filters = {} } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }

    const results = await searchSystem.search(query, {
      userId,
      strategy,
      limit,
      offset,
      filters
    });

    res.json({
      success: true,
      ...results
    });
  } catch (error) {
    console.error('[Search] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available padding strategies
app.get('/api/v1/search/strategies', (req, res) => {
  const strategies = Array.from(searchSystem.paddingStrategies.entries()).map(([key, value]) => ({
    key,
    ...value
  }));

  res.json({
    success: true,
    strategies
  });
});

// Search analytics
app.get('/api/v1/search/analytics', (req, res) => {
  const { timeRange = '24h' } = req.query;
  
  try {
    const analytics = searchSystem.getSearchAnalytics(timeRange);
    res.json({
      success: true,
      ...analytics
    });
  } catch (error) {
    console.error('[Search] Analytics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// User-specific analytics
app.get('/api/v1/search/users/:userId/analytics', (req, res) => {
  const { userId } = req.params;
  
  try {
    const analytics = searchSystem.getUserAnalytics(userId);
    res.json({
      success: true,
      ...analytics
    });
  } catch (error) {
    console.error('[Search] User analytics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'professional-search',
    status: 'healthy',
    port: PORT,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    totalSearches: searchSystem.performanceMetrics.totalSearches,
    avgResponseTime: searchSystem.performanceMetrics.avgResponseTime,
    availableStrategies: searchSystem.paddingStrategies.size,
    userProfiles: searchSystem.userProfiles.size
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ProfessionalSearch] Server running on port ${PORT}`);
  console.log(`[ProfessionalSearch] Health: http://localhost:${PORT}/health`);
  console.log(`[ProfessionalSearch] Search API: http://localhost:${PORT}/api/v1/search`);
});

module.exports = { ProfessionalSearchSystem, app, searchSystem };
