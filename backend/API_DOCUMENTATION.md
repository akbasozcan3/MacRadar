# MacRadar Professional API Documentation

## Overview
MacRadar is a location-based social networking application with real-time sensor integration, built with a microservices architecture.

## Architecture

### Backend Services
- **Go Backend** (Port 8092): Main REST API + WebSocket server
- **Node.js Backend** (Port 8090): Supporting services and utilities
- **Rust Sensor Hub** (Port 8181): Real-time sensor data processing
- **PostgreSQL Database** (Port 5432): Primary data store

### Frontend
- **React Native** mobile application with TypeScript
- **Mapbox integration** for location services
- **Real-time WebSocket connections**

## API Endpoints

### Authentication Service
```
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
POST /api/v1/auth/password-reset
POST /api/v1/auth/password-reset/confirm
```

### Profile Service
```
GET /api/v1/profile/me
PUT /api/v1/profile/me
GET /api/v1/profile/{userId}
POST /api/v1/profile/{userId}/follow
DELETE /api/v1/profile/{userId}/follow
```

### Explore Service
```
GET /api/v1/explore/feed
GET /api/v1/explore/trending
GET /api/v1/explore/search/users
GET /api/v1/explore/search/posts
POST /api/v1/explore/posts/{postId}/react
POST /api/v1/explore/posts/{postId}/comments
```

### Messages Service
```
GET /api/v1/messages/conversations
GET /api/v1/messages/conversations/{conversationId}
POST /api/v1/messages/conversations/{conversationId}/messages
```

### Sensor Service (Rust)
```
GET /healthz
GET /api/v1/sensors
GET /api/v1/sensors/{id}
POST /api/v1/sensors/{id}/data
GET /api/v1/events
POST /api/v1/events
WS /ws/sensors
```

## WebSocket Connections

### Main WebSocket (Go Backend)
```
ws://localhost:8092/ws
```
Events: `message`, `typing`, `presence`, `notification`

### Sensor WebSocket (Rust)
```
ws://localhost:8181/ws/sensors
```
Events: `sensor.reading`, `sensor.status`

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    password_hash VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Posts Table
```sql
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    caption TEXT,
    media_url TEXT,
    media_type VARCHAR(20) NOT NULL,
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    location_name TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## Environment Configuration

### Required Environment Variables
```bash
# Database
DATABASE_URL=postgres://macradar:macradar@localhost:5432/macradar?sslmode=disable

# Security
JWT_SECRET=your-super-secret-jwt-key-here
BCRYPT_COST=12

# Server
PORT=8092
APP_ENV=development
APP_BASE_URL=http://localhost:8092

# CORS
ALLOWED_ORIGINS=http://localhost:8081,http://127.0.0.1:8081

# Email (Optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=MacRadar <your-email@gmail.com>

# Rust Sensor Bridge
RUST_SENSOR_BRIDGE_ENABLED=true
RUST_SENSOR_WS_URL=ws://127.0.0.1:8181/ws/sensors
RUST_SENSOR_HOST=127.0.0.1
RUST_SENSOR_PORT=8181
```

## Development Setup

### 1. Start Database
```bash
cd backend
docker-compose up -d postgres
```

### 2. Start Backend Services
```bash
npm run start:all
# Or individually:
npm run start:go      # Go backend (port 8092)
npm run start:node    # Node.js backend (port 8090)
npm run start:rust    # Rust sensor hub (port 8181)
```

### 3. Start Frontend
```bash
npm run android
# or
npm run ios
```

## Testing

### Backend Tests
```bash
npm run test:all              # All backend tests
npm run test:go              # Go backend tests
npm run test:node            # Node.js backend tests
npm run test:go:unit         # Go unit tests
npm run test:go:matrix       # Go integration matrix
```

### API Testing
```bash
npm run backend:test         # Full API test suite
npm run backend:test:profile # Profile API tests
npm run backend:test:auth    # Auth API tests
```

## Performance Monitoring

### Health Check Endpoints
- Go Backend: `GET /healthz`
- Node.js Backend: `GET /healthz`
- Rust Sensor Hub: `GET /healthz`

### Metrics
- Request rate limiting
- Database connection pooling
- WebSocket connection monitoring
- Sensor data processing metrics

## Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Rate limiting on sensitive endpoints
- CORS protection
- Input validation and sanitization
- SQL injection prevention
- XSS protection

## Deployment

### Docker Deployment
```bash
docker-compose up -d
```

### Production Considerations
- Use HTTPS in production
- Set strong JWT secrets
- Configure proper database credentials
- Enable database backups
- Set up monitoring and logging
- Configure CDN for media files

## Sensor Integration

The Rust sensor hub provides real-time processing of:
- Accelerometer data
- GPS location
- Device orientation
- Motion detection

Sensor data is normalized and broadcasted to connected clients via WebSocket.

## Real-time Features

- Live messaging
- Typing indicators
- Presence status
- Notification push
- Sensor data streaming
- Post reactions

## Error Handling

All API endpoints return consistent error responses:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {}
  }
}
```

## Rate Limiting

- Login: 5 attempts per 15 minutes
- Search: 90 requests per minute
- Password reset: 5 attempts per hour
- General API: 1000 requests per hour

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Use TypeScript for frontend
5. Follow Go conventions for backend
