const axios = require('axios');
const WebSocket = require('ws');

class VoiceServiceIntegration {
  constructor() {
    this.voiceServiceUrl = process.env.VOICE_SERVICE_URL || 'http://localhost:8096';
    this.voiceWebSocketUrl = process.env.VOICE_WS_URL || 'ws://localhost:8097';
    this.nodeServiceUrl = process.env.NODE_SERVICE_URL || 'http://localhost:8090';
    this.goServiceUrl = process.env.GO_SERVICE_URL || 'http://localhost:8092';
    
    this.ws = null;
    this.isConnected = false;
  }

  // Connect to voice service WebSocket
  connectWebSocket() {
    try {
      this.ws = new WebSocket(this.voiceWebSocketUrl);
      
      this.ws.on('open', () => {
        console.log('[voice-integration] WebSocket connected to voice service');
        this.isConnected = true;
      });
      
      this.ws.on('message', (data) => {
        this.handleVoiceMessage(data);
      });
      
      this.ws.on('close', () => {
        console.log('[voice-integration] WebSocket disconnected from voice service');
        this.isConnected = false;
        // Auto-reconnect after 5 seconds
        setTimeout(() => this.connectWebSocket(), 5000);
      });
      
      this.ws.on('error', (error) => {
        console.error('[voice-integration] WebSocket error:', error);
      });
    } catch (error) {
      console.error('[voice-integration] Failed to connect WebSocket:', error);
    }
  }

  // Handle incoming voice messages
  handleVoiceMessage(data) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'voice_stream':
          this.handleVoiceStream(message.data);
          break;
        case 'voice_response':
          this.handleVoiceResponse(message.data);
          break;
        default:
          console.log('[voice-integration] Unknown voice message type:', message.type);
      }
    } catch (error) {
      console.error('[voice-integration] Error parsing voice message:', error);
    }
  }

  // Handle voice streaming data
  async handleVoiceStream(data) {
    try {
      // Forward voice stream data to other services
      await this.forwardToNodeService('voice_stream', data);
      await this.forwardToGoService('voice_stream', data);
      
      console.log('[voice-integration] Voice stream forwarded to other services');
    } catch (error) {
      console.error('[voice-integration] Error handling voice stream:', error);
    }
  }

  // Handle voice response data
  async handleVoiceResponse(data) {
    try {
      // Process voice response and update relevant services
      console.log('[voice-integration] Voice response received:', data);
      
      // You can add specific logic here to handle voice responses
      // For example, updating user status, triggering notifications, etc.
    } catch (error) {
      console.error('[voice-integration] Error handling voice response:', error);
    }
  }

  // Forward data to Node.js service
  async forwardToNodeService(type, data) {
    try {
      await axios.post(`${this.nodeServiceUrl}/api/v1/voice/webhook`, {
        type,
        data,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[voice-integration] Failed to forward to Node service:', error.message);
    }
  }

  // Forward data to Go service
  async forwardToGoService(type, data) {
    try {
      await axios.post(`${this.goServiceUrl}/api/v1/voice/webhook`, {
        type,
        data,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[voice-integration] Failed to forward to Go service:', error.message);
    }
  }

  // Send voice request through WebSocket
  sendVoiceRequest(requestData) {
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'voice_request',
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        data: requestData
      });
      
      this.ws.send(message);
      return true;
    } else {
      console.error('[voice-integration] WebSocket not connected');
      return false;
    }
  }

  // Upload voice file through REST API
  async uploadVoiceFile(filePath, metadata = {}) {
    try {
      const FormData = require('form-data');
      const fs = require('fs');
      
      const form = new FormData();
      form.append('audio', fs.createReadStream(filePath));
      
      if (metadata.durationSec) {
        form.append('durationSec', metadata.durationSec.toString());
      }
      if (metadata.waveform) {
        form.append('waveform', JSON.stringify(metadata.waveform));
      }
      
      const response = await axios.post(`${this.voiceServiceUrl}/api/v1/voice/upload`, form, {
        headers: {
          ...form.getHeaders()
        }
      });
      
      console.log('[voice-integration] Voice file uploaded successfully');
      return response.data;
    } catch (error) {
      console.error('[voice-integration] Failed to upload voice file:', error);
      throw error;
    }
  }

  // Get voice file list
  async getVoiceFiles() {
    try {
      const response = await axios.get(`${this.voiceServiceUrl}/api/v1/voice/list`);
      return response.data;
    } catch (error) {
      console.error('[voice-integration] Failed to get voice files:', error);
      throw error;
    }
  }

  // Delete voice file
  async deleteVoiceFile(filename) {
    try {
      const response = await axios.delete(`${this.voiceServiceUrl}/api/v1/voice/file/${filename}`);
      console.log('[voice-integration] Voice file deleted successfully');
      return response.data;
    } catch (error) {
      console.error('[voice-integration] Failed to delete voice file:', error);
      throw error;
    }
  }

  // Check voice service health
  async checkHealth() {
    try {
      const response = await axios.get(`${this.voiceServiceUrl}/health`);
      return response.data;
    } catch (error) {
      console.error('[voice-integration] Voice service health check failed:', error);
      throw error;
    }
  }

  // Start the integration service
  start() {
    console.log('[voice-integration] Starting voice service integration...');
    this.connectWebSocket();
    
    // Periodic health check
    setInterval(async () => {
      try {
        const health = await this.checkHealth();
        console.log('[voice-integration] Voice service health:', health.status);
      } catch (error) {
        console.error('[voice-integration] Health check failed:', error.message);
      }
    }, 30000); // Check every 30 seconds
  }
}

module.exports = VoiceServiceIntegration;

// If run directly, start the integration service
if (require.main === module) {
  const integration = new VoiceServiceIntegration();
  integration.start();
}
