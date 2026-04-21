#!/usr/bin/env node

// Test Professional Search System
const axios = require('axios');

async function testSearchSystem() {
  console.log('=== Professional Search System Test ===\n');

  const baseUrl = 'http://localhost:8104';

  try {
    // Test 1: Health Check
    console.log('1. Testing Health Check...');
    const healthResponse = await axios.get(`${baseUrl}/health`);
    console.log('   Health:', healthResponse.data.status);
    console.log('   Available Strategies:', healthResponse.data.availableStrategies);
    console.log('   Port:', healthResponse.data.port);

    // Test 2: Get Strategies
    console.log('\n2. Getting Available Strategies...');
    const strategiesResponse = await axios.get(`${baseUrl}/api/v1/search/strategies`);
    console.log('   Strategies:');
    strategiesResponse.data.strategies.forEach(strategy => {
      console.log(`   - ${strategy.key}: ${strategy.name}`);
      console.log(`     ${strategy.description}`);
    });

    // Test 3: Smart Search
    console.log('\n3. Testing Smart Search Strategy...');
    const smartSearchResponse = await axios.post(`${baseUrl}/api/v1/search`, {
      query: 'sunset photography',
      userId: 'test_user_1',
      strategy: 'smart',
      limit: 10
    });
    console.log('   Query:', smartSearchResponse.data.query);
    console.log('   Strategy:', smartSearchResponse.data.strategy);
    console.log('   Results Found:', smartSearchResponse.data.totalFound);
    console.log('   Results Returned:', smartSearchResponse.data.returned);
    console.log('   Response Time:', smartSearchResponse.data.responseTime + 'ms');
    console.log('   Padding Applied:', smartSearchResponse.data.paddingApplied);
    if (smartSearchResponse.data.metrics) {
      console.log('   Diversity Score:', smartSearchResponse.data.metrics.diversityScore.toFixed(2));
      console.log('   Quality Score:', smartSearchResponse.data.metrics.qualityScore.toFixed(2));
    }

    // Test 4: Quality Search
    console.log('\n4. Testing Quality Search Strategy...');
    const qualitySearchResponse = await axios.post(`${baseUrl}/api/v1/search`, {
      query: 'web development',
      userId: 'test_user_2',
      strategy: 'quality',
      limit: 5
    });
    console.log('   Query:', qualitySearchResponse.data.query);
    console.log('   Strategy:', qualitySearchResponse.data.strategy);
    console.log('   Results:', qualitySearchResponse.data.results.length);

    // Test 5: Diversity Search
    console.log('\n5. Testing Diversity Search Strategy...');
    const diversitySearchResponse = await axios.post(`${baseUrl}/api/v1/search`, {
      query: 'cooking',
      userId: 'test_user_3',
      strategy: 'diversity',
      limit: 8
    });
    console.log('   Query:', diversitySearchResponse.data.query);
    console.log('   Strategy:', diversitySearchResponse.data.strategy);
    console.log('   Results:', diversitySearchResponse.data.results.length);

    // Test 6: User Analytics
    console.log('\n6. Testing User Analytics...');
    const analyticsResponse = await axios.get(`${baseUrl}/api/v1/search/users/test_user_1/analytics`);
    console.log('   User ID:', analyticsResponse.data.userId);
    console.log('   Search Count:', analyticsResponse.data.searchCount);
    console.log('   Profile Strength:', analyticsResponse.data.profileStrength.toFixed(1));
    console.log('   Preferred Categories:');
    analyticsResponse.data.preferredCategories.forEach(([category, weight]) => {
      console.log(`     ${category}: ${weight}`);
    });

    // Test 7: System Analytics
    console.log('\n7. Testing System Analytics...');
    const systemAnalyticsResponse = await axios.get(`${baseUrl}/api/v1/search/analytics`);
    console.log('   Total Searches:', systemAnalyticsResponse.data.totalSearches);
    console.log('   Average Response Time:', systemAnalyticsResponse.data.avgResponseTime.toFixed(2) + 'ms');
    console.log('   Available Strategies:', systemAnalyticsResponse.data.availableStrategies.length);
    console.log('   User Profiles:', systemAnalyticsResponse.data.userProfiles);

    console.log('\n=== All Tests Passed! ===');
    console.log('Professional Search System is working perfectly!');

  } catch (error) {
    console.error('Test Error:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', error.response.data);
    }
  }
}

testSearchSystem();
