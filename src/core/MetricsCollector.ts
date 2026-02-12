import promClient from 'prom-client';

export class MetricsCollector {
  private register: promClient.Registry;
  
  // HTTP Metrics
  public httpRequestsTotal!: promClient.Counter<string>;
  public httpRequestDuration!: promClient.Histogram<string>;
  public httpResponseSize!: promClient.Histogram<string>;
  
  // Cache Metrics
  public cacheHits!: promClient.Counter<string>;
  public cacheMisses!: promClient.Counter<string>;
  public cacheSize!: promClient.Gauge<string>;
  public cacheEntries!: promClient.Gauge<string>;
  public cacheEvictions!: promClient.Counter<string>;
  
  // Bandwidth Metrics
  public bandwidthTotal!: promClient.Counter<string>;
  public bandwidthByContentType!: promClient.Counter<string>;
  
  // Connection Metrics
  public activeConnections!: promClient.Gauge<string>;
  public connectionsTotal!: promClient.Counter<string>;
  
  // Node Metrics
  public nodeHealth!: promClient.Gauge<string>;
  public nodeResponseTime!: promClient.Gauge<string>;

  constructor() {
    this.register = new promClient.Registry();
    
    // Add default metrics (memory, CPU, etc.)
    promClient.collectDefaultMetrics({ register: this.register });
    
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // HTTP Requests
    this.httpRequestsTotal = new promClient.Counter({
      name: 'pcdn_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.register]
    });

    // Request Duration
    this.httpRequestDuration = new promClient.Histogram({
      name: 'pcdn_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.register]
    });

    // Response Size
    this.httpResponseSize = new promClient.Histogram({
      name: 'pcdn_http_response_size_bytes',
      help: 'HTTP response size in bytes',
      labelNames: ['route', 'content_type'],
      buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
      registers: [this.register]
    });

    // Cache Hits
    this.cacheHits = new promClient.Counter({
      name: 'pcdn_cache_hits_total',
      help: 'Total cache hits',
      labelNames: ['cache_type'],
      registers: [this.register]
    });

    // Cache Misses
    this.cacheMisses = new promClient.Counter({
      name: 'pcdn_cache_misses_total',
      help: 'Total cache misses',
      labelNames: ['reason'],
      registers: [this.register]
    });

    // Cache Size
    this.cacheSize = new promClient.Gauge({
      name: 'pcdn_cache_size_bytes',
      help: 'Current cache size in bytes',
      registers: [this.register]
    });

    // Cache Entries
    this.cacheEntries = new promClient.Gauge({
      name: 'pcdn_cache_entries_total',
      help: 'Total number of cache entries',
      registers: [this.register]
    });

    // Cache Evictions
    this.cacheEvictions = new promClient.Counter({
      name: 'pcdn_cache_evictions_total',
      help: 'Total cache evictions',
      labelNames: ['reason'],
      registers: [this.register]
    });

    // Bandwidth Total
    this.bandwidthTotal = new promClient.Counter({
      name: 'pcdn_bandwidth_total_bytes',
      help: 'Total bandwidth served',
      registers: [this.register]
    });

    // Bandwidth by Content Type
    this.bandwidthByContentType = new promClient.Counter({
      name: 'pcdn_bandwidth_by_content_type_bytes',
      help: 'Bandwidth by content type',
      labelNames: ['content_type'],
      registers: [this.register]
    });

    // Active Connections
    this.activeConnections = new promClient.Gauge({
      name: 'pcdn_active_connections',
      help: 'Number of active connections',
      registers: [this.register]
    });

    // Total Connections
    this.connectionsTotal = new promClient.Counter({
      name: 'pcdn_connections_total',
      help: 'Total connections',
      registers: [this.register]
    });

    // Node Health
    this.nodeHealth = new promClient.Gauge({
      name: 'pcdn_node_health',
      help: 'Node health status (1=healthy, 0=unhealthy)',
      labelNames: ['node_id', 'region'],
      registers: [this.register]
    });

    // Node Response Time
    this.nodeResponseTime = new promClient.Gauge({
      name: 'pcdn_node_response_time_seconds',
      help: 'Node response time',
      labelNames: ['node_id'],
      registers: [this.register]
    });
  }

  async getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  getContentType(): string {
    return this.register.contentType;
  }

  // Helper methods
  recordRequest(method: string, route: string, statusCode: number, duration: number): void {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
    this.httpRequestDuration.observe({ method, route, status_code: statusCode.toString() }, duration);
  }

  recordCacheHit(type: string = 'memory'): void {
    this.cacheHits.inc({ cache_type: type });
  }

  recordCacheMiss(reason: string = 'not_found'): void {
    this.cacheMisses.inc({ reason });
  }

  recordBandwidth(bytes: number, contentType: string): void {
    this.bandwidthTotal.inc(bytes);
    this.bandwidthByContentType.inc({ content_type: contentType }, bytes);
  }

  updateCacheStats(size: number, entries: number): void {
    this.cacheSize.set(size);
    this.cacheEntries.set(entries);
  }

  recordEviction(reason: string = 'lru'): void {
    this.cacheEvictions.inc({ reason });
  }

  updateNodeHealth(nodeId: string, region: string, healthy: boolean): void {
    this.nodeHealth.set({ node_id: nodeId, region }, healthy ? 1 : 0);
  }

  updateNodeResponseTime(nodeId: string, responseTime: number): void {
    this.nodeResponseTime.set({ node_id: nodeId }, responseTime);
  }
}