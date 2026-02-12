# PCDN Deployment Guide

## Docker Deployment

### Quick Start

```bash
# Build the image
docker build -t pcdn:latest .

# Run with docker-compose
docker-compose up -d

# Or run manually
docker run -d \
  --name pcdn-server \
  -p 8080:8080 \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/config/pcdn.json:/app/config/pcdn.json:ro \
  -e PCDN_API_KEY=your-secure-key \
  pcdn:latest
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PCDN_PORT` | Server port | 8080 |
| `PCDN_API_KEY` | Administrative API key | - |
| `PCDN_CONFIG` | Config file path | ./config/pcdn.json |
| `LOG_LEVEL` | Logging level | info |
| `REDIS_HOST` | Redis hostname | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `REDIS_PASSWORD` | Redis password | - |

### Docker Compose with Monitoring

```bash
# Start with Prometheus & Grafana
docker-compose --profile monitoring up -d
```

Access:
- PCDN: http://localhost:8080
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (admin/admin)

---

## Kubernetes Deployment

### Prerequisites

- Kubernetes 1.20+
- kubectl configured
- Helm 3 (optional)

### Quick Deploy

```bash
# Create namespace
kubectl create namespace pcdn

# Apply configurations
kubectl apply -f k8s/config.yaml
kubectl apply -f k8s/config-files.yaml
kubectl apply -f k8s/storage.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml

# Check status
kubectl get pods -n pcdn
kubectl get svc -n pcdn
```

### Helm Deployment (Optional)

```bash
# Create Helm chart
helm create pcdn-chart

# Deploy
helm install pcdn ./pcdn-chart -n pcdn --create-namespace
```

### Production Considerations

1. **SSL/TLS**: Configure cert-manager for automatic certificates
2. **Ingress**: Update ingress.yaml with your domain
3. **Resources**: Adjust resource limits based on expected load
4. **Scaling**: HPA is configured for automatic scaling
5. **Monitoring**: Already configured with Prometheus metrics

---

## Protocol Support

### HTTP/2

Enable in configuration:

```json
{
  "protocols": {
    "http2": true
  }
}
```

Note: HTTP/2 requires SSL certificates.

### WebSocket

Enable in configuration:

```json
{
  "protocols": {
    "webSocket": true,
    "webSocketPath": "/ws",
    "maxWebSocketConnections": 1000
  }
}
```

WebSocket endpoints:
- Connect: `ws://host:8080/ws`
- Events: `stats`, `cache_updates`, `metrics`

### HTTP/3 (Experimental)

```json
{
  "protocols": {
    "http3": true,
    "quicPort": 8443
  }
}
```

Note: HTTP/3 requires specific Node.js builds with QUIC support.

---

## Testing

### Local Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Docker Testing

```bash
# Build test image
docker build -t pcdn:test --target development .

# Run tests in container
docker run --rm pcdn:test npm test
```

### CI/CD

GitHub Actions automatically:
1. Runs tests on Node.js 18, 20, 22
2. Builds Docker image
3. Pushes to container registry (main branch)
4. Deploys to Kubernetes (main branch)

---

## Troubleshooting

### Pod won't start

```bash
kubectl describe pod -n pcdn <pod-name>
kubectl logs -n pcdn <pod-name>
```

### Health check failing

```bash
kubectl exec -n pcdn <pod-name> -- curl http://localhost:8080/health
```

### Clear cache

```bash
kubectl exec -n pcdn <pod-name> -- curl -X POST http://localhost:8080/api/cache/purge \
  -H "X-API-Key: your-api-key"
```

### Scale deployment

```bash
kubectl scale deployment pcdn -n pcdn --replicas=5
```
