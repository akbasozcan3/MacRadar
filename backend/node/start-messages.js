#!/usr/bin/env node

// Professional Fastify Messages Service Starter
const buildFastifyMessagesApp = require('./fastify-messages-enhanced');

async function startMessagesService() {
  try {
    console.log('[Messages] Starting professional messaging service...');
    
    const app = buildFastifyMessagesApp();
    
    try {
      await app.listen({ port: 8094, host: '0.0.0.0' });
      console.log('[Messages] Fastify HTTP server running on port 8094');
      console.log('[Messages] Health endpoint: http://localhost:8094/health');
      console.log('[Messages] API base: http://localhost:8094/api/v1/messages');
    } catch (err) {
      console.error('[Messages] Failed to start HTTP server:', err);
      process.exit(1);
    }
  } catch (error) {
    console.error('[Messages] Failed to initialize messaging service:', error);
    process.exit(1);
  }
}

startMessagesService();
