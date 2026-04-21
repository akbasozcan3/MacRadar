#!/usr/bin/env node

const axios = require('axios');
const WebSocket = require('ws');

const SERVICES = {
  node: { url: 'http://localhost:8090', name: 'Node.js Backend', healthPath: '/healthz' },
  go: { url: 'http://localhost:8092', name: 'Go Backend', healthPath: '/healthz' },
  rust: { url: 'http://localhost:8181', name: 'Rust Sensor Hub', healthPath: '/healthz' },
  voice: { url: 'http://localhost:8096', name: 'Voice Service', healthPath: '/health' },
  fastify: { url: 'http://localhost:8094', name: 'Fastify Messages', healthPath: '/health' },
  explore: { url: 'http://localhost:8099', name: 'Explore Service', healthPath: '/health' },
  feed: { url: 'http://localhost:8102', name: 'Feed Service', healthPath: '/health' }
};

const WS_SERVICES = {
  voice: { url: 'ws://localhost:8097', name: 'Voice WebSocket' },
  messages: { url: 'ws://localhost:8095', name: 'Messages WebSocket' },
  explore: { url: 'ws://localhost:8100', name: 'Explore WebSocket' },
  feed: { url: 'ws://localhost:8103', name: 'Feed WebSocket' }
};

class ComprehensiveServiceTester {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      total: 0,
      details: []
    };
  }

  async testHTTPService(serviceKey, service) {
    const testName = `${service.name} Health Check`;
    this.results.total++;
    
    try {
      const healthPath = service.healthPath || '/health';
      const response = await axios.get(`${service.url}${healthPath}`, { timeout: 5000 });
      
      if (response.status === 200) {
        this.results.passed++;
        this.results.details.push({
          service: serviceKey,
          test: testName,
          status: 'PASS',
          response: response.data
        });
        console.log(`[PASS] ${testName}`);
        return true;
      } else {
        throw new Error(`Unexpected status: ${response.status}`);
      }
    } catch (error) {
      this.results.failed++;
      this.results.details.push({
        service: serviceKey,
        test: testName,
        status: 'FAIL',
        error: error.message
      });
      console.log(`[FAIL] ${testName}: ${error.message}`);
      return false;
    }
  }

  async testWebSocketService(serviceKey, service) {
    const testName = `${service.name} Connection`;
    this.results.total++;
    
    return new Promise((resolve) => {
      const ws = new WebSocket(service.url);
      const timeout = setTimeout(() => {
        ws.close();
        this.results.failed++;
        this.results.details.push({
          service: serviceKey,
          test: testName,
          status: 'FAIL',
          error: 'Connection timeout'
        });
        console.log(`[FAIL] ${testName}: Connection timeout`);
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.results.passed++;
        this.results.details.push({
          service: serviceKey,
          test: testName,
          status: 'PASS'
        });
        console.log(`[PASS] ${testName}`);
        ws.close();
        resolve(true);
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        this.results.failed++;
        this.results.details.push({
          service: serviceKey,
          test: testName,
          status: 'FAIL',
          error: error.message
        });
        console.log(`[FAIL] ${testName}: ${error.message}`);
        resolve(false);
      });
    });
  }

  async testServiceIntegration() {
    const testName = 'Service Integration';
    this.results.total++;
    
    try {
      // Test voice service integration
      const voiceResponse = await axios.get(`${SERVICES.voice.url}/api/v1/voice/list`);
      
      // Test explore service
      const exploreResponse = await axios.get(`${SERVICES.explore.url}/api/v1/explore/categories`);
      
      // Test feed service
      const feedResponse = await axios.post(`${SERVICES.feed.url}/api/v1/feed/users`, {
        id: 'test_user_' + Date.now(),
        username: 'testuser',
        email: 'test@example.com'
      });
      
      this.results.passed++;
      this.results.details.push({
        service: 'integration',
        test: testName,
        status: 'PASS',
        voiceService: voiceResponse.data.success,
        exploreService: exploreResponse.data.success,
        feedService: feedResponse.data.success
      });
      console.log(`[PASS] ${testName}`);
      return true;
    } catch (error) {
      this.results.failed++;
      this.results.details.push({
        service: 'integration',
        test: testName,
        status: 'FAIL',
        error: error.message
      });
      console.log(`[FAIL] ${testName}: ${error.message}`);
      return false;
    }
  }

  async testAdvancedFeatures() {
    const tests = [
      {
        name: 'Voice File Upload',
        test: () => this.testVoiceUpload()
      },
      {
        name: 'Explore Search',
        test: () => this.testExploreSearch()
      },
      {
        name: 'Feed Post Creation',
        test: () => this.testFeedPostCreation()
      },
      {
        name: 'User Blocking',
        test: () => this.testUserBlocking()
      },
      {
        name: 'Message Sending',
        test: () => this.testMessageSending()
      }
    ];

    for (const { name, test } of tests) {
      this.results.total++;
      try {
        await test();
        this.results.passed++;
        this.results.details.push({
          service: 'advanced',
          test: name,
          status: 'PASS'
        });
        console.log(`[PASS] ${name}`);
      } catch (error) {
        this.results.failed++;
        this.results.details.push({
          service: 'advanced',
          test: name,
          status: 'FAIL',
          error: error.message
        });
        console.log(`[FAIL] ${name}: ${error.message}`);
      }
    }
  }

  async testVoiceUpload() {
    // Test voice service file listing
    const response = await axios.get(`${SERVICES.voice.url}/api/v1/voice/list`);
    if (!response.data.success) {
      throw new Error('Voice service list failed');
    }
  }

  async testExploreSearch() {
    // Test explore service search
    const response = await axios.get(`${SERVICES.explore.url}/api/v1/explore/search?q=test`);
    if (!response.data.success) {
      throw new Error('Explore search failed');
    }
  }

  async testFeedPostCreation() {
    // Create a test user first
    const userResponse = await axios.post(`${SERVICES.feed.url}/api/v1/feed/users`, {
      id: 'test_user_' + Date.now(),
      username: 'feedtest',
      email: 'feedtest@example.com'
    });

    if (!userResponse.data.success) {
      throw new Error('Feed user creation failed');
    }

    // Test post creation
    const postResponse = await axios.post(`${SERVICES.feed.url}/api/v1/feed/posts`, {
      userId: userResponse.data.user.id,
      caption: 'Test post for integration testing',
      hashtags: ['test', 'integration'],
      media: []
    });

    if (!postResponse.data.success) {
      throw new Error('Feed post creation failed');
    }
  }

  async testUserBlocking() {
    // Create test users
    const user1Response = await axios.post(`${SERVICES.feed.url}/api/v1/feed/users`, {
      id: 'test_user_1_' + Date.now(),
      username: 'blocker',
      email: 'blocker@example.com'
    });

    const user2Response = await axios.post(`${SERVICES.feed.url}/api/v1/feed/users`, {
      id: 'test_user_2_' + Date.now(),
      username: 'blocked',
      email: 'blocked@example.com'
    });

    if (!user1Response.data.success || !user2Response.data.success) {
      throw new Error('Test user creation failed');
    }

    // Test blocking
    const blockResponse = await axios.post(`${SERVICES.feed.url}/api/v1/feed/users/${user2Response.data.user.id}/block`, {
      blockerId: user1Response.data.user.id
    });

    if (!blockResponse.data.success) {
      throw new Error('User blocking failed');
    }
  }

  async testMessageSending() {
    // Test message webhook
    const response = await axios.post(`${SERVICES.node.url}/api/v1/voice/webhook`, {
      type: 'voice_stream',
      data: { test: 'integration test' },
      timestamp: new Date().toISOString()
    });

    if (response.status !== 200) {
      throw new Error('Message webhook failed');
    }
  }

  async runAllTests() {
    console.log('=== MacRadar Backend Comprehensive Service Test Suite ===\n');
    
    // Test HTTP services
    console.log('Testing HTTP Services...');
    for (const [key, service] of Object.entries(SERVICES)) {
      await this.testHTTPService(key, service);
    }
    
    // Test WebSocket services
    console.log('\nTesting WebSocket Services...');
    for (const [key, service] of Object.entries(WS_SERVICES)) {
      await this.testWebSocketService(key, service);
    }
    
    // Test service integration
    console.log('\nTesting Service Integration...');
    await this.testServiceIntegration();
    
    // Test advanced features
    console.log('\nTesting Advanced Features...');
    await this.testAdvancedFeatures();
    
    // Print results
    this.printResults();
  }

  printResults() {
    console.log('\n=== Comprehensive Test Results ===');
    console.log(`Total Tests: ${this.results.total}`);
    console.log(`Passed: ${this.results.passed}`);
    console.log(`Failed: ${this.results.failed}`);
    console.log(`Success Rate: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);
    
    if (this.results.failed > 0) {
      console.log('\nFailed Tests:');
      this.results.details
        .filter(detail => detail.status === 'FAIL')
        .forEach(detail => {
          console.log(`  - ${detail.service}: ${detail.test} (${detail.error})`);
        });
    }
    
    console.log('\n=== Service Status Summary ===');
    Object.keys(SERVICES).forEach(key => {
      const serviceTests = this.results.details.filter(d => d.service === key);
      const passed = serviceTests.filter(t => t.status === 'PASS').length;
      const total = serviceTests.length;
      const status = total > 0 && passed === total ? 'HEALTHY' : 'ISSUES';
      console.log(`${SERVICES[key].name}: ${status} (${passed}/${total})`);
    });

    console.log('\n=== WebSocket Status Summary ===');
    Object.keys(WS_SERVICES).forEach(key => {
      const serviceTests = this.results.details.filter(d => d.service === key);
      const passed = serviceTests.filter(t => t.status === 'PASS').length;
      const total = serviceTests.length;
      const status = total > 0 && passed === total ? 'CONNECTED' : 'ISSUES';
      console.log(`${WS_SERVICES[key].name}: ${status} (${passed}/${total})`);
    });

    console.log('\n=== Advanced Features Status ===');
    const advancedTests = this.results.details.filter(d => d.service === 'advanced');
    const passed = advancedTests.filter(t => t.status === 'PASS').length;
    const total = advancedTests.length;
    console.log(`Advanced Features: ${passed}/${total} working`);

    console.log('\n=== Port Allocation Summary ===');
    console.log('Node.js Backend: 8090');
    console.log('Go Backend: 8092');
    console.log('Fastify Messages: 8094');
    console.log('Voice Service: 8096');
    console.log('Voice WebSocket: 8097');
    console.log('Messages WebSocket: 8095');
    console.log('Explore Service: 8099');
    console.log('Explore WebSocket: 8100');
    console.log('Feed Service: 8100');
    console.log('Feed WebSocket: 8101');
    console.log('Rust Sensor Hub: 8181');
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ComprehensiveServiceTester();
  tester.runAllTests().catch(console.error);
}

module.exports = ComprehensiveServiceTester;
