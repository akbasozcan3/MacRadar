# Voice Service

Dedicated voice service for MacRadar backend handling voice messages, audio file uploads, and real-time voice communication.

## Features

- **Audio File Upload**: Support for various audio formats
- **Voice Storage**: Persistent storage with organized file management
- **Real-time Communication**: WebSocket support for live voice streaming
- **File Management**: List, serve, and delete voice files
- **Health Monitoring**: Built-in health check endpoint

## API Endpoints

### POST /api/v1/voice/upload
Upload audio files with metadata.

### GET /api/v1/voice/file/:filename
Serve uploaded voice files.

### GET /api/v1/voice/list
List all uploaded voice files.

### DELETE /api/v1/voice/file/:filename
Delete specific voice files.

### GET /health
Health check endpoint.

## WebSocket Events

- `voice_stream`: Real-time voice streaming
- `voice_request`: Voice processing requests
- `voice_response`: Voice processing responses

## Configuration

Environment variables:
- `VOICE_PORT`: Server port (default: 8096)
- WebSocket port: 8097

## Storage

Voice files are stored in: `backend/storage/voice/messages/`
Temporary uploads: `backend/voice-service/uploads/`
