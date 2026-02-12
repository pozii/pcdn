# PCDN Grafana Dashboard Setup

## Quick Start

### 1. Start Prometheus

Create `prometheus.yml`:

```yaml
global:
  scrape_interval: 5s

scrape_configs:
  - job_name: 'pcdn'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/api/metrics'
    scheme: http
```

Start Prometheus:
```bash
docker run -d \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

### 2. Start Grafana

```bash
docker run -d \
  -p 3000:3000 \
  -e "GF_SECURITY_ADMIN_PASSWORD=admin" \
  grafana/grafana
```

### 3. Import Dashboard

1. Open http://localhost:3000 (admin/admin)
2. Go to Dashboards → Import
3. Upload `dashboard.json`
4. Select Prometheus datasource

## Available Metrics

| Metric | Description |
|--------|-------------|
| `pcdn_http_requests_total` | Total HTTP requests |
| `pcdn_http_request_duration_seconds` | Request duration histogram |
| `pcdn_cache_hits_total` | Cache hits |
| `pcdn_cache_misses_total` | Cache misses |
| `pcdn_cache_size_bytes` | Current cache size |
| `pcdn_bandwidth_total_bytes` | Total bandwidth |
| `pcdn_active_connections` | Active connections |

## Prometheus Queries

### Cache Hit Rate
```promql
rate(pcdn_cache_hits_total[5m]) / (rate(pcdn_cache_hits_total[5m]) + rate(pcdn_cache_misses_total[5m]))
```

### Requests Per Second
```promql
rate(pcdn_http_requests_total[1m])
```

### P95 Latency
```promql
histogram_quantile(0.95, rate(pcdn_http_request_duration_seconds_bucket[5m]))
```