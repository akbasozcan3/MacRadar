const express = require('express');
const multer = require('multer');
const { Buffer } = require('node:buffer');
const path = require('path');
const fs = require('fs');
const { WebSocket } = require('ws');

const app = express();
const PORT = process.env.VOICE_PORT || 8096;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Voice storage configuration
const VOICE_STORAGE_DIR = path.join(__dirname, '..', 'storage', 'voice', 'messages');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
[VOICE_STORAGE_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `voice-${uniqueSuffix}.webm`);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

// WebSocket server for real-time voice communication
const wss = new WebSocket.Server({ port: 8097 });

function parseSocketPayload(message) {
  const rawText = Buffer.isBuffer(message)
    ? message.toString('utf8')
    : String(message ?? '');
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === 'ping' || trimmed === 'pong') {
    return { type: trimmed };
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    console.warn('[voice-service] Ignoring non-JSON websocket payload');
    return null;
  }
}

wss.on('connection', (ws) => {
  console.log('[voice-service] WebSocket client connected');
  
  ws.on('message', (message) => {
    try {
      const data = parseSocketPayload(message);
      if (!data) {
        return;
      }
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ serverTime: new Date().toISOString(), type: 'pong' }));
        return;
      }
      if (data.type === 'pong' || data.type === 'heartbeat') {
        return;
      }
      if (typeof data.type !== 'string' || data.type.trim().length === 0) {
        console.warn('[voice-service] Ignoring websocket payload without type');
        return;
      }
      
      switch (data.type) {
        case 'voice_stream':
          // Handle voice streaming
          broadcastVoiceStream(ws, data);
          break;
        case 'voice_request':
          // Handle voice request
          handleVoiceRequest(ws, data);
          break;
        default:
          console.warn('[voice-service] Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('[voice-service] WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('[voice-service] WebSocket client disconnected');
  });
});

// REST API Routes
app.post('/api/v1/voice/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    
    const voiceData = {
      id: `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      url: `/api/v1/voice/file/${req.file.filename}`,
      durationSec: req.body.durationSec || 0,
      waveform: req.body.waveform ? JSON.parse(req.body.waveform) : []
    };
    
    // Move file to permanent storage
    const permanentPath = path.join(VOICE_STORAGE_DIR, req.file.filename);
    fs.renameSync(req.file.path, permanentPath);
    
    res.json({
      success: true,
      data: voiceData
    });
    
    console.log('[voice-service] Voice uploaded:', voiceData.id);
  } catch (error) {
    console.error('[voice-service] Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/v1/voice/file/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(VOICE_STORAGE_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Voice file not found' });
    }
    
    res.sendFile(filePath);
  } catch (error) {
    console.error('[voice-service] File serving error:', error);
    res.status(500).json({ error: 'File serving failed' });
  }
});

app.get('/api/v1/voice/list', (req, res) => {
  try {
    const files = fs.readdirSync(VOICE_STORAGE_DIR)
      .filter(file => file.endsWith('.webm'))
      .map(filename => {
        const filePath = path.join(VOICE_STORAGE_DIR, filename);
        const stats = fs.statSync(filePath);
        
        return {
          filename,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          url: `/api/v1/voice/file/${filename}`
        };
      });
    
    res.json({
      success: true,
      data: files
    });
  } catch (error) {
    console.error('[voice-service] List error:', error);
    res.status(500).json({ error: 'Failed to list voice files' });
  }
});

app.delete('/api/v1/voice/file/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(VOICE_STORAGE_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Voice file not found' });
    }
    
    fs.unlinkSync(filePath);
    
    res.json({
      success: true,
      message: 'Voice file deleted successfully'
    });
    
    console.log('[voice-service] Voice deleted:', filename);
  } catch (error) {
    console.error('[voice-service] Delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// WebSocket helper functions
function broadcastVoiceStream(sender, data) {
  const message = JSON.stringify({
    type: 'voice_stream',
    data: data,
    timestamp: new Date().toISOString()
  });
  
  wss.clients.forEach(client => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function handleVoiceRequest(ws, data) {
  // Handle voice-related requests
  const response = {
    type: 'voice_response',
    requestId: data.requestId,
    data: {
      status: 'processed',
      timestamp: new Date().toISOString()
    }
  };
  
  ws.send(JSON.stringify(response));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    service: 'voice-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: PORT,
    websocketPort: 8097
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[voice-service] Server running on port ${PORT}`);
  console.log(`[voice-service] WebSocket server running on port 8097`);
  console.log(`[voice-service] Voice storage: ${VOICE_STORAGE_DIR}`);
});

module.exports = app;
