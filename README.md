# PCDN - Professional Content Delivery Network

A high-performance, enterprise-grade CDN solution with edge caching, real-time image optimization, distributed caching, and comprehensive monitoring capabilities.

## Overview

PCDN is a self-hosted Content Delivery Network built with TypeScript and Node.js, designed for organizations requiring full control over their content distribution infrastructure. It combines the performance characteristics of commercial CDNs with the flexibility of self-hosted solutions.

## Features

### Core Capabilities

- **Multi-Tier Caching** - LRU-based cache with memory, disk, and Redis layers
- **Edge Processing** - Real-time image transformation and optimization
- **Load Balancing** - Weighted round-robin with health checks
- **Origin Pull** - Automatic content fetching from upstream servers
- **File Watching** - Automatic cache warming from monitored directories
- **Compression** - Gzip and Brotli encoding support
- **SSL/TLS** - Automatic Let's Encrypt or manual certificate management

### Image Processing

- On-the-fly image transformation via URL parameters
- Format conversion (JPEG, PNG, WebP, AVIF)
- Responsive resizing with multiple fit modes
- Quality adjustment and progressive encoding
- Automatic browser format selection

### Performance & Monitoring

- **Prometheus Metrics** - 16+ custom metrics for observability
- **Structured Logging** - Winston-based logging with rotation
- **Request Tracing** - Unique request IDs for debugging
- **Bandwidth Tracking** - Per-content-type bandwidth metrics
- **Real-time Statistics** - Cache hit rates, active connections

### Security

- **Rate Limiting** - Configurable request throttling per IP/API key
- **API Key Authentication** - Secure administrative endpoints
- **Helmet.js Integration** - Security headers by default
- **CORS Support** - Cross-origin resource sharing configuration

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/pcdn.git
cd pcdn

# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start
```

### Configuration

Create `config/pcdn.json`:

```json
{
  "port": 8080,
  "nodeId": "node-1",
  "region": "us-east",
  "cacheDir": "./cache",
  "maxCacheSize": 1073741824,
  "ttl": 86400,
  "compression": true,
  "apiKey": "your-secure-api-key",
  "watchDirs": ["./uploads"],
  "rateLimit": {
    "enabled": true,
    "windowMs": 900000,
    "maxRequests": 1000
  },
  "redis": {
    "enabled": false,
    "host": "localhost",
    "port": 6379
  },
  "imageTransform": {
    "enabled": true,
    "maxWidth": 4000,
    "maxHeight": 4000,
    "quality": 85
  }
}
```

## Usage

### Content Delivery

Access cached content:
```
GET http://localhost:8080/cdn/<hash>
```

With image transformation:
```
GET http://localhost:8080/cdn/<hash>?w=800&h=600&q=80&f=webp
```

### CLI Commands

```bash
# Start server
npx pcdn serve -p 8080

# Upload files
npx pcdn upload ./image.jpg ./photo.png

# View statistics
npx pcdn stats

# Invalidate cache
npx pcdn invalidate ".*\\.jpg"

# Manage nodes
npx pcdn nodes
```

### API Endpoints

#### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check endpoint |
| GET | `/cdn/:key` | Retrieve cached content |

#### Administrative Endpoints (requires X-API-Key header)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/metrics` | Prometheus metrics |
| GET | `/api/stats` | Server statistics |
| POST | `/api/upload` | Upload base64 content |
| POST | `/api/upload-local` | Upload from local path |
| DELETE | `/api/cache/:key` | Delete cache entry |
| POST | `/api/cache/purge` | Purge all cache |
| POST | `/api/cache/invalidate` | Invalidate by pattern |
| GET | `/api/image/status` | Image transform config |

## Image Transformation

Transform images using query parameters:

| Parameter | Alias | Description | Example |
|-----------|-------|-------------|---------|
| `width` | `w` | Target width in pixels | `?w=800` |
| `height` | `h` | Target height in pixels | `?h=600` |
| `quality` | `q` | Compression quality (1-100) | `?q=85` |
| `format` | `f` | Output format | `?f=webp` |
| `fit` | - | Resize mode | `?fit=cover` |
| `position` | `pos` | Crop position | `?pos=center` |

**Supported formats:** jpeg, png, webp, avif, gif

**Fit modes:** cover, contain, fill, inside, outside

### Examples

```
# Resize to 800x600
/cdn/<hash>?w=800&h=600

# Create thumbnail
/cdn/<hash>?w=300&h=300&fit=cover&q=70

# Convert to WebP
/cdn/<hash>?f=webp&q=85

# Cover crop from top
/cdn/<hash>?w=1200&h=600&fit=cover&pos=top
```

## Monitoring

### Prometheus Metrics

Available at `http://localhost:8080/api/metrics`:

- `pcdn_http_requests_total` - Total HTTP requests
- `pcdn_http_request_duration_seconds` - Request latency histogram
- `pcdn_cache_hits_total` - Cache hit counter
- `pcdn_cache_misses_total` - Cache miss counter
- `pcdn_cache_size_bytes` - Current cache size
- `pcdn_bandwidth_total_bytes` - Total bandwidth served
- `pcdn_active_connections` - Active connection gauge

### Grafana Integration

1. Start Prometheus:
```bash
docker run -d -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

2. Start Grafana:
```bash
docker run -d -p 3000:3000 grafana/grafana
```

3. Import `grafana/dashboard.json`

## Architecture

```
Client Request
      |
      v
Load Balancer (Weighted Round-Robin)
      |
      v
Rate Limiter
      |
      v
HTTP Server (Express)
      |
      +---> Cache Manager (Memory/Disk)
      |         |
      |         +---> Redis Backend
      |
      +---> Image Transform (Sharp)
      |
      +---> Origin Pull Manager
      |
      +---> Metrics Collector (Prometheus)
      |
      v
   Response
```

### Cache Hierarchy

1. **In-Memory (NodeCache)** - Fastest, volatile
2. **Local Disk** - Persistent, survives restarts
3. **Redis Backend** - Distributed, multi-node sync

## Configuration Reference

### Complete Configuration Example

```json
{
  "port": 8080,
  "nodeId": "node-1",
  "region": "us-east",
  "cacheDir": "./cache",
  "maxCacheSize": 1073741824,
  "ttl": 86400,
  "compression": true,
  "http2": false,
  "apiKey": "your-secure-api-key",
  "watchDirs": ["./uploads", "./assets"],
  "rateLimit": {
    "enabled": true,
    "windowMs": 900000,
    "maxRequests": 1000,
    "skipSuccessfulRequests": false,
    "skipFailedRequests": false
  },
  "redis": {
    "enabled": false,
    "host": "localhost",
    "port": 6379,
    "password": null,
    "db": 0,
    "keyPrefix": "pcdn:",
    "ttl": 86400
  },
  "imageTransform": {
    "enabled": true,
    "maxWidth": 4000,
    "maxHeight": 4000,
    "quality": 85,
    "allowedFormats": ["jpeg", "png", "webp", "avif", "gif"],
    "defaultFormat": "jpeg",
    "cacheTransformed": true
  },
  "ssl": {
    "enabled": false,
    "auto": true,
    "email": "admin@yourdomain.com",
    "domains": ["cdn.yourdomain.com"],
    "agreeTos": true
  },
  "origin": {
    "enabled": false,
    "url": "https://example.com",
    "timeout": 30000,
    "retryAttempts": 3,
    "cacheOnPull": true,
    "followRedirects": true,
    "maxRedirectDepth": 5,
    "allowedExtensions": [".jpg", ".png", ".gif", ".css", ".js"],
    "deniedExtensions": [".php", ".exe"]
  },
  "nodes": [
    {
      "id": "node-1",
      "host": "localhost",
      "port": 8080,
      "region": "us-east",
      "weight": 100,
      "healthy": true
    }
  ]
}
```

## Development

```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Run CLI commands
npx pcdn --help
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PCDN_PORT` | Server port | 8080 |
| `PCDN_API_KEY` | Administrative API key | - |
| `PCDN_CONFIG` | Config file path | ./config/pcdn.json |
| `LOG_LEVEL` | Logging level | info |
| `LOG_DIR` | Log directory | ./logs |
| `REDIS_HOST` | Redis hostname | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `REDIS_PASSWORD` | Redis password | - |

## Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0
- Redis (optional, for distributed caching)

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome. Please read the contributing guidelines and submit pull requests to the repository.

## Support

For issues and feature requests, please use the GitHub issue tracker.

If you find this project helpful and would like to support its development, you can buy me a coffee:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow.svg)](https://buymeacoffee.com/pozii)

Your support helps maintain and improve this project.
