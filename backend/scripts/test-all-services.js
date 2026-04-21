#!/usr/bin/env node

const axios = require('axios');
const WebSocket = require('ws');

const SERVICES = {
  node: { url: 'http://localhost:8090', name: 'Node.js Backend' },
  go: { url: 'http://localhost:8092', name: 'Go Backend' },
  rust: { url: 'http://localhost:8098', name: 'Rust Sensor Hub' },
  voice: { url: 'http://localhost:8096', name: 'Voice Service' },
  fastify: { url: 'http://localhost:8094', name: 'Fastify Messages' }
};

const WS_SERVICES = {
  voice: { url: 'ws://localhost:8097', name: 'Voice WebSocket' }
};

class ServiceTester {
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
      const response = await axios.get(`${service.url}/healthz`, { timeout: 5000 });
      
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

  async testVoiceService(serviceKey, service) {
    const testName = `${service.name} Health Check`;
    this.results.total++;
    
    try {
      const response = await axios.get(`${service.url}/health`, { timeout: 5000 });
      
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

  async testVoiceAPI() {
    const testName = 'Voice API - List Files';
    this.results.total++;
    
    try {
      const response = await axios.get(`${SERVICES.voice.url}/api/v1/voice/list`, { timeout: 5000 });
      
      if (response.status === 200 && response.data.success) {
        this.results.passed++;
        this.results.details.push({
          service: 'voice',
          test: testName,
          status: 'PASS',
          response: response.data
        });
        console.log(`[PASS] ${testName}`);
        return true;
      } else {
        throw new Error('Invalid response structure');
      }
    } catch (error) {
      this.results.failed++;
      this.results.details.push({
        service: 'voice',
        test: testName,
        status: 'FAIL',
        error: error.message
      });
      console.log(`[FAIL] ${testName}: ${error.message}`);
      return false;
    }
  }

  async testNodeVoiceWebhook() {
    const testName = 'Node Voice Webhook';
    this.results.total++;
    
    try {
      const response = await axios.post(`${SERVICES.node.url}/api/v1/voice/webhook`, {
        type: 'voice_stream',
        data: { test: 'data' },
        timestamp: new Date().toISOString()
      }, { timeout: 5000 });
      
      if (response.status === 200 && response.data.success) {
        this.results.passed++;
        this.results.details.push({
          service: 'node',
          test: testName,
          status: 'PASS',
          response: response.data
        });
        console.log(`[PASS] ${testName}`);
        return true;
      } else {
        throw new Error('Webhook failed');
      }
    } catch (error) {
      this.results.failed++;
      this.results.details.push({
        service: 'node',
        test: testName,
        status: 'FAIL',
        error: error.message
      });
      console.log(`[FAIL] ${testName}: ${error.message}`);
      return false;
    }
  }

  async runAllTests() {
    console.log('=== MacRadar Backend Service Test Suite ===\n');
    
    // Test HTTP services
    console.log('Testing HTTP Services...');
    await this.testHTTPService('node', SERVICES.node);
    await this.testHTTPService('go', SERVICES.go);
    await this.testHTTPService('rust', SERVICES.rust);
    await this.testHTTPService('fastify', SERVICES.fastify);
    
    // Test voice service (different endpoint)
    await this.testVoiceService('voice', SERVICES.voice);
    
    // Test WebSocket services
    console.log('\nTesting WebSocket Services...');
    await this.testWebSocketService('voice', WS_SERVICES.voice);
    
    // Test API functionality
    console.log('\nTesting API Functionality...');
    await this.testVoiceAPI();
    await this.testNodeVoiceWebhook();
    
    // Print results
    this.printResults();
  }

  printResults() {
    console.log('\n=== Test Results ===');
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
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ServiceTester();
  tester.runAllTests().catch(console.error);
}

module.exports = ServiceTester;
