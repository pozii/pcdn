import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import mime from 'mime-types';
import responseTime from 'response-time';
import * as fs from 'fs-extra';
import * as path from 'path';
import { createReadStream, watch } from 'fs';
import http from 'http';
import https from 'https';
import { CacheManager } from './CacheManager';
import { LoadBalancer } from './LoadBalancer';
import { MetricsCollector } from './MetricsCollector';
import { SSLManager } from './SSLManager';
import { OriginPullManager } from './OriginPullManager';
import { RateLimiter } from './RateLimiter';
import { RedisManager } from './RedisManager';
import { ImageTransformManager } from './ImageTransformManager';
import { CDNConfig, Stats, CacheEntry } from '../types';
import { Logger } from '../utils/Logger';
import { 
  requestIdMiddleware, 
  requestLoggerMiddleware, 
  errorHandlerMiddleware, 
  asyncHandler,
  PCDNError 
} from '../utils/errorHandler';

export class CDNServer {
  private app: express.Application;
  private config: CDNConfig;
  private cacheManager: CacheManager;
  private loadBalancer: LoadBalancer;
  private metrics: MetricsCollector;
  private sslManager: SSLManager;
  private originPullManager: OriginPullManager;
  private rateLimiter: RateLimiter;
  private redisManager: RedisManager;
  private imageTransformManager: ImageTransformManager;
  private stats: Stats;
  private startTime: number;
  private watchers: Map<string, any> = new Map();
  private logger: Logger;
  private server: http.Server | https.Server | null = null;
  private isShuttingDown: boolean = false;

  constructor(config: CDNConfig) {
    this.config = config;
    this.app = express();
    this.logger = new Logger('CDNServer');
    this.cacheManager = new CacheManager(config.cacheDir, config.maxCacheSize, config.ttl);
    this.loadBalancer = new LoadBalancer(config.nodes);
    this.metrics = new MetricsCollector();
    this.sslManager = new SSLManager(config.ssl || { enabled: false });
    this.originPullManager = new OriginPullManager(config.origin || { enabled: false, url: '' }, this.cacheManager, this.metrics);
    this.rateLimiter = new RateLimiter(config.rateLimit || { enabled: false });
    this.redisManager = new RedisManager(config.redis || { enabled: false });
    this.imageTransformManager = new ImageTransformManager(config.imageTransform || { enabled: false });
    this.startTime = Date.now();
    
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hitRate: 0,
      totalBandwidth: 0,
      activeConnections: 0,
      cacheSize: 0,
      uptime: 0
    };

    this.setupMiddleware();
    this.setupRoutes();
    this.setupFileWatcher();
    this.startMetricsUpdater();
    this.setupGracefulShutdown();
  }

  private setupMiddleware(): void {
    // Request ID middleware (first)
    this.app.use(requestIdMiddleware);
    
    // Request logging
    this.app.use(requestLoggerMiddleware);

    // Rate limiting (before other middleware)
    this.app.use(this.rateLimiter.getMiddleware());
    
    this.app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }));
    
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'HEAD', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Prometheus metrics middleware
    this.app.use(responseTime((req: Request, res: Response, time: number) => {
      const route = req.route?.path || req.path;
      const method = req.method;
      const statusCode = res.statusCode;
      
      this.metrics.recordRequest(method, route, statusCode, time / 1000);
      
      if (res.get('Content-Type')) {
        this.metrics.httpResponseSize.observe(
          { route, content_type: res.get('Content-Type')! },
          parseInt(res.get('Content-Length') || '0')
        );
      }
    }));

    if (this.config.compression) {
      this.app.use(compression({
        filter: (req: Request, res: Response) => {
          if (req.headers['x-no-compression']) {
            return false;
          }
          return compression.filter(req, res);
        },
        level: 6
      }));
    }

    this.app.use(express.json({ limit: '100mb' }));
    this.app.use(express.static(this.config.cacheDir, { maxAge: '1y' }));

    // Error handling middleware (last)
    this.app.use(errorHandlerMiddleware);
  }

  private setupFileWatcher(): void {
    const watchDirs = this.config.watchDirs || ['./uploads'];
    
    watchDirs.forEach(dir => {
      fs.ensureDirSync(dir);
      
      const watcher = watch(dir, { recursive: true }, async (eventType, filename) => {
        if (!filename) return;
        
        const filePath = path.join(dir, filename);
        
        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile() && eventType === 'rename') {
            this.logger.info('File detected', { filename, directory: dir });
            await this.autoCacheFile(filePath, filename);
          }
        } catch (error) {
          // File might have been deleted
          this.logger.debug('File not accessible', { filePath, error });
        }
      });
      
      this.watchers.set(dir, watcher);
      this.logger.info('Watching directory', { directory: path.resolve(dir) });
    });

    this.scanExistingFiles(watchDirs);
  }

  private async scanExistingFiles(dirs: string[]): Promise<void> {
    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir, { recursive: true });
        for (const file of files) {
          const filePath = path.join(dir, file as string);
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            await this.autoCacheFile(filePath, file as string);
          }
        }
      } catch (error) {
        this.logger.error('Error scanning directory', { directory: dir, error });
      }
    }
  }

  private async autoCacheFile(filePath: string, relativePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath);
      const key = this.cacheManager.generateKey(relativePath);
      const contentType = mime.lookup(filePath) || 'application/octet-stream';
      
      await this.cacheManager.set(key, content, contentType);
      this.logger.info('File cached', { path: relativePath, key, size: content.length });
    } catch (error) {
      this.logger.error('Failed to cache file', { path: relativePath, error });
    }
  }

  private startMetricsUpdater(): void {
    // Update cache metrics every 5 seconds
    setInterval(() => {
      const cacheStats = this.cacheManager.getStats();
      this.metrics.updateCacheStats(cacheStats.currentSize, cacheStats.entries);
      this.metrics.activeConnections.set(this.stats.activeConnections);
    }, 5000);
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, starting graceful shutdown...`);
      this.isShuttingDown = true;

      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          this.logger.info('HTTP server closed');
        });
      }

      // Close file watchers
      for (const [dir, watcher] of this.watchers) {
        watcher.close();
        this.logger.debug('File watcher closed', { directory: dir });
      }

      // Shutdown cache manager
      try {
        await this.cacheManager.shutdown();
      } catch (error) {
        this.logger.error('Error during cache shutdown', { error });
      }

      // Disconnect Redis
      try {
        await this.redisManager.disconnect();
      } catch (error) {
        this.logger.error('Error during Redis disconnect', { error });
      }

      this.logger.info('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  private setupRoutes(): void {
    this.app.use('/api', this.createAPIRouter());
    this.app.use('/', this.createCDNRouter());
  }

  private createAPIRouter(): express.Router {
    const router = express.Router();

    // Apply stricter rate limiting to API routes
    router.use(this.rateLimiter.getStrictMiddleware(0.5));

    router.use((req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.headers['x-api-key'];
      if (apiKey !== this.config.apiKey) {
        throw new PCDNError('Unauthorized', 401, 'UNAUTHORIZED');
      }
      next();
    });

    // Prometheus metrics endpoint
    router.get('/metrics', asyncHandler(async (req: Request, res: Response) => {
      res.set('Content-Type', this.metrics.getContentType());
      res.send(await this.metrics.getMetrics());
    }));

    router.post('/upload', asyncHandler(async (req: Request, res: Response) => {
      const { filename, content, contentType } = req.body;
      
      if (!filename || !content) {
        throw new PCDNError('Missing filename or content', 400, 'MISSING_FIELDS');
      }

      const buffer = Buffer.from(content, 'base64');
      const key = this.cacheManager.generateKey(filename);
      
      const entry = await this.cacheManager.set(key, buffer, contentType || mime.lookup(filename) || 'application/octet-stream');
      
      // Also store in Redis if enabled
      if (this.redisManager.isEnabled()) {
        await this.redisManager.set(key, entry);
      }
      
      res.json({
        success: true,
        url: `/cdn/${key}`,
        cdnUrl: `${this.getProtocol()}://localhost:${this.config.port}/cdn/${key}`,
        size: buffer.length,
        etag: entry.etag,
        cached: true,
        nodes: this.loadBalancer.getHealthyNodes().map(n => n.id)
      });
    }));

    router.post('/upload-local', asyncHandler(async (req: Request, res: Response) => {
      const { filePath } = req.body;
      
      if (!filePath || !(await fs.pathExists(filePath))) {
        throw new PCDNError('File not found', 400, 'FILE_NOT_FOUND');
      }

      const content = await fs.readFile(filePath);
      const filename = path.basename(filePath);
      const key = this.cacheManager.generateKey(filename);
      const contentType = mime.lookup(filePath) || 'application/octet-stream';
      
      const entry = await this.cacheManager.set(key, content, contentType);
      
      // Also store in Redis if enabled
      if (this.redisManager.isEnabled()) {
        await this.redisManager.set(key, entry);
      }
      
      res.json({
        success: true,
        url: `/cdn/${key}`,
        cdnUrl: `${this.getProtocol()}://localhost:${this.config.port}/cdn/${key}`,
        size: content.length,
        etag: entry.etag,
        cached: true
      });
    }));

    router.delete('/cache/:key', asyncHandler(async (req: Request, res: Response) => {
      const { key } = req.params;
      const success = await this.cacheManager.delete(key);
      
      // Also delete from Redis
      if (success && this.redisManager.isEnabled()) {
        await this.redisManager.delete(key);
      }
      
      if (success) {
        this.metrics.recordEviction('manual');
        res.json({ success: true, message: 'Cache entry deleted' });
      } else {
        throw new PCDNError('Cache entry not found', 404, 'NOT_FOUND');
      }
    }));

    router.post('/cache/purge', asyncHandler(async (req: Request, res: Response) => {
      const count = await this.cacheManager.purge();
      
      // Also flush Redis
      if (this.redisManager.isEnabled()) {
        await this.redisManager.flush();
      }
      
      this.metrics.recordEviction('purge');
      res.json({ success: true, purged: count });
    }));

    router.post('/cache/invalidate', asyncHandler(async (req: Request, res: Response) => {
      const { pattern } = req.body;
      if (!pattern) {
        throw new PCDNError('Pattern required', 400, 'MISSING_PATTERN');
      }
      
      const count = await this.cacheManager.invalidatePattern(pattern);
      this.metrics.recordEviction('pattern');
      res.json({ success: true, invalidated: count });
    }));

    router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
      const cacheStats = this.cacheManager.getStats();
      const redisStats = this.redisManager.isEnabled() ? await this.redisManager.getStats() : null;
      
      res.json({
        ...this.stats,
        uptime: Date.now() - this.startTime,
        cache: cacheStats,
        redis: redisStats,
        nodes: this.loadBalancer.getAllNodes(),
        watchDirs: this.config.watchDirs || ['./uploads'],
        ssl: this.sslManager.isEnabled(),
        sslAuto: this.sslManager.isAuto(),
        rateLimit: {
          enabled: this.rateLimiter.isEnabled()
        },
        imageTransform: {
          enabled: this.imageTransformManager.isEnabled(),
          config: this.imageTransformManager.getConfig()
        },
        origin: {
          enabled: this.originPullManager.isEnabled(),
          url: this.originPullManager.getOriginUrl()
        }
      });
    }));

    router.get('/nodes', (req: Request, res: Response) => {
      res.json({
        nodes: this.loadBalancer.getAllNodes(),
        healthy: this.loadBalancer.getHealthyNodes().length
      });
    });

    router.get('/cached-files', (req: Request, res: Response) => {
      const keys = this.cacheManager.getAllKeys();
      res.json({
        files: keys.map(key => ({
          key,
          url: `/cdn/${key}`,
          cdnUrl: `${this.getProtocol()}://localhost:${this.config.port}/cdn/${key}`
        }))
      });
    });

    // Origin Pull endpoints
    router.get('/origin/status', (req: Request, res: Response) => {
      res.json({
        enabled: this.originPullManager.isEnabled(),
        originUrl: this.originPullManager.getOriginUrl(),
        config: this.originPullManager.getConfig()
      });
    });

    router.post('/origin/pull', asyncHandler(async (req: Request, res: Response) => {
      const { path } = req.body;
      
      if (!path) {
        throw new PCDNError('Path is required', 400, 'MISSING_PATH');
      }

      if (!this.originPullManager.isEnabled()) {
        throw new PCDNError('Origin pull is not enabled', 400, 'ORIGIN_NOT_ENABLED');
      }

      const baseUrl = `${this.getProtocol()}://localhost:${this.config.port}`;
      const result = await this.originPullManager.pullFromOrigin(path, baseUrl);
      
      res.json(result);
    }));

    router.post('/origin/prefetch', asyncHandler(async (req: Request, res: Response) => {
      const { urls } = req.body;
      
      if (!urls || !Array.isArray(urls)) {
        throw new PCDNError('URLs array is required', 400, 'MISSING_URLS');
      }

      if (!this.originPullManager.isEnabled()) {
        throw new PCDNError('Origin pull is not enabled', 400, 'ORIGIN_NOT_ENABLED');
      }

      const baseUrl = `${this.getProtocol()}://localhost:${this.config.port}`;
      const results = await this.originPullManager.prefetch(urls, baseUrl);
      
      res.json({
        success: true,
        total: urls.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      });
    }));

    // Image transform status endpoint
    router.get('/image/status', (req: Request, res: Response) => {
      res.json({
        enabled: this.imageTransformManager.isEnabled(),
        config: this.imageTransformManager.getConfig()
      });
    });

    return router;
  }

  private createCDNRouter(): express.Router {
    const router = express.Router();

    router.use(async (req: Request, res: Response, next: NextFunction) => {
      this.stats.totalRequests++;
      this.stats.activeConnections++;
      this.metrics.connectionsTotal.inc();
      this.metrics.activeConnections.set(this.stats.activeConnections);
      
      res.on('finish', () => {
        this.stats.activeConnections--;
        this.metrics.activeConnections.set(this.stats.activeConnections);
      });
      
      next();
    });

    router.get('/cdn/:key', asyncHandler(async (req: Request, res: Response) => {
      const { key } = req.params;
      const transformOptions = this.imageTransformManager.parseTransformOptions(req.query);
      
      // Check if this is a transformed image request
      let cacheKey = key;
      let isTransformed = false;
      
      if (transformOptions && this.imageTransformManager.isImageFile(key)) {
        cacheKey = this.imageTransformManager.generateTransformKey(key, transformOptions);
        isTransformed = true;
      }
      
      // Try to get from cache (memory first, then disk)
      let cached: CacheEntry | undefined;
      
      // Check Redis first if enabled
      if (this.redisManager.isEnabled()) {
        const redisEntry = await this.redisManager.get(cacheKey);
        if (redisEntry) {
          cached = redisEntry;
        }
      }
      
      // Then check local cache
      if (!cached) {
        cached = this.cacheManager.get(cacheKey);
      }
      
      if (cached) {
        this.stats.cacheHits++;
        this.stats.hitRate = (this.stats.cacheHits / this.stats.totalRequests) * 100;
        this.metrics.recordCacheHit(isTransformed ? 'transformed' : 'disk');
        
        // If transformation is requested but we have cached version
        if (isTransformed && !cached.isTransformed) {
          // We have the original, but need to transform
          const originalBuffer = await fs.readFile(cached.path);
          const transformed = await this.imageTransformManager.transform(originalBuffer, transformOptions!);
          
          // Cache the transformed version
          const transformedKey = cacheKey;
          const transformedEntry = await this.cacheManager.set(
            transformedKey,
            transformed.buffer,
            transformed.contentType
          );
          transformedEntry.isTransformed = true;
          transformedEntry.originalKey = key;
          
          // Update local cache entry
          this.cacheManager.getAllKeys(); // Refresh
          
          // Also store in Redis
          if (this.redisManager.isEnabled()) {
            await this.redisManager.set(transformedKey, transformedEntry);
          }
          
          // Serve transformed image
          res.setHeader('Content-Type', transformed.contentType);
          res.setHeader('ETag', transformedEntry.etag);
          res.setHeader('Cache-Control', 'public, max-age=31536000');
          res.setHeader('X-Cache', 'TRANSFORMED');
          res.setHeader('X-CDN-Node', this.config.nodeId);
          res.setHeader('X-Image-Width', transformed.width.toString());
          res.setHeader('X-Image-Height', transformed.height.toString());
          
          this.stats.totalBandwidth += transformed.size;
          this.metrics.recordBandwidth(transformed.size, transformed.contentType);
          
          res.send(transformed.buffer);
          return;
        }
        
        // Serve cached content
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('ETag', cached.etag);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.setHeader('X-Cache', isTransformed ? 'TRANSFORMED_HIT' : 'HIT');
        res.setHeader('X-CDN-Node', this.config.nodeId);
        
        const acceptEncoding = req.headers['accept-encoding'] as string || '';
        
        if (cached.compressed && acceptEncoding.includes('br') && cached.encodings.includes('br')) {
          res.setHeader('Content-Encoding', 'br');
        } else if (cached.compressed && acceptEncoding.includes('gzip') && cached.encodings.includes('gzip')) {
          res.setHeader('Content-Encoding', 'gzip');
        }
        
        const stream = createReadStream(cached.path);
        
        stream.on('data', (chunk) => {
          this.stats.totalBandwidth += chunk.length;
          this.metrics.recordBandwidth(chunk.length, cached!.contentType);
        });
        
        stream.on('error', (error) => {
          this.logger.error('Stream error', { key: cacheKey, error });
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to stream content' });
          }
        });
        
        stream.pipe(res);
        
        return;
      }
      
      this.stats.cacheMisses++;
      this.stats.hitRate = (this.stats.cacheHits / this.stats.totalRequests) * 100;
      
      // Try origin pull if enabled
      if (this.originPullManager.isEnabled()) {
        try {
          const baseUrl = `${this.getProtocol()}://localhost:${this.config.port}`;
          const result = await this.originPullManager.pullFromOrigin(key, baseUrl);
          
          if (result.success) {
            // Get the cached entry
            const originalEntry = this.cacheManager.get(result.key);
            
            if (originalEntry) {
              // If transformation requested, apply it
              if (isTransformed && transformOptions) {
                const originalBuffer = await fs.readFile(originalEntry.path);
                const transformed = await this.imageTransformManager.transform(originalBuffer, transformOptions);
                
                // Cache the transformed version
                const transformedEntry = await this.cacheManager.set(
                  cacheKey,
                  transformed.buffer,
                  transformed.contentType
                );
                transformedEntry.isTransformed = true;
                transformedEntry.originalKey = key;
                
                // Also store in Redis
                if (this.redisManager.isEnabled()) {
                  await this.redisManager.set(cacheKey, transformedEntry);
                }
                
                // Serve transformed image
                res.setHeader('Content-Type', transformed.contentType);
                res.setHeader('ETag', transformedEntry.etag);
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                res.setHeader('X-Cache', 'TRANSFORMED');
                res.setHeader('X-Origin-Pull', 'true');
                res.setHeader('X-Origin-Url', result.originUrl);
                res.setHeader('X-CDN-Node', this.config.nodeId);
                res.setHeader('X-Image-Width', transformed.width.toString());
                res.setHeader('X-Image-Height', transformed.height.toString());
                
                this.stats.totalBandwidth += transformed.size;
                this.metrics.recordBandwidth(transformed.size, transformed.contentType);
                
                res.send(transformed.buffer);
                return;
              }
              
              // Serve original from origin
              res.setHeader('Content-Type', originalEntry.contentType);
              res.setHeader('ETag', originalEntry.etag);
              res.setHeader('Cache-Control', 'public, max-age=31536000');
              res.setHeader('X-Cache', 'MISS');
              res.setHeader('X-Origin-Pull', 'true');
              res.setHeader('X-Origin-Url', result.originUrl);
              res.setHeader('X-CDN-Node', this.config.nodeId);
              
              const stream = createReadStream(originalEntry.path);
              
              stream.on('data', (chunk) => {
                this.stats.totalBandwidth += chunk.length;
                this.metrics.recordBandwidth(chunk.length, originalEntry.contentType);
              });
              
              stream.pipe(res);
              return;
            }
          }
        } catch (originError) {
          this.logger.error('Origin pull failed', { key, error: originError });
          this.metrics.recordCacheMiss('origin_failed');
        }
      }
      
      this.metrics.recordCacheMiss('not_found');
      throw new PCDNError('Content not found', 404, 'NOT_FOUND');
    }));

    router.get('/health', (req: Request, res: Response) => {
      res.json({
        status: this.isShuttingDown ? 'shutting_down' : 'healthy',
        node: this.config.nodeId,
        region: this.config.region,
        uptime: Date.now() - this.startTime,
        features: {
          rateLimit: this.rateLimiter.isEnabled(),
          redis: this.redisManager.isEnabled(),
          imageTransform: this.imageTransformManager.isEnabled()
        }
      });
    });

    return router;
  }

  private getProtocol(): string {
    return this.sslManager.isEnabled() ? 'https' : 'http';
  }

  async start(): Promise<void> {
    // Connect to Redis if enabled
    if (this.redisManager.isEnabled()) {
      await this.redisManager.connect();
    }
    
    const sslEnabled = this.sslManager.isEnabled();
    const port = this.config.port;
    
    if (sslEnabled) {
      // HTTPS
      const sslOptions = await this.sslManager.initialize();
      
      if (sslOptions.cert && sslOptions.key) {
        this.server = https.createServer({
          cert: sslOptions.cert,
          key: sslOptions.key
        }, this.app).listen(port, () => {
          this.printStartupInfo(port, true);
        });
      } else {
        this.logger.warn('SSL enabled but certificates not found. Falling back to HTTP.');
        this.server = http.createServer(this.app).listen(port, () => {
          this.printStartupInfo(port, false);
        });
      }
    } else {
      // HTTP only
      this.server = http.createServer(this.app).listen(port, () => {
        this.printStartupInfo(port, false);
      });
    }
  }

  private printStartupInfo(port: number, ssl: boolean): void {
    const protocol = ssl ? 'https' : 'http';
    const url = `${protocol}://localhost:${port}`;
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║              🚀 PCDN Server Started                     ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📦 Node: ${this.config.nodeId} (${this.config.region})`);
    console.log(`🔒 Protocol: ${protocol}`);
    console.log(`🌐 URL: ${url}`);
    console.log(`💾 Cache: ${this.config.cacheDir}`);
    console.log(`👁️  Watch Dirs: ${(this.config.watchDirs || ['./uploads']).join(', ')}`);
    
    if (this.rateLimiter.isEnabled()) {
      console.log(`🛡️  Rate Limiting: Enabled`);
    }
    
    if (this.redisManager.isEnabled()) {
      console.log(`📦 Redis: Connected`);
    }
    
    if (this.imageTransformManager.isEnabled()) {
      console.log(`🖼️  Image Transform: Enabled`);
    }
    
    if (this.originPullManager.isEnabled()) {
      console.log(`🌐 Origin Pull: ${this.originPullManager.getOriginUrl()}`);
    }
    
    console.log('');
    console.log('📊 Monitoring:');
    console.log(`   Prometheus: ${url}/api/metrics`);
    console.log(`   Health: ${url}/health`);
    console.log('');
    console.log('📋 API Endpoints:');
    console.log(`   Upload: POST ${url}/api/upload`);
    console.log(`   Stats: GET ${url}/api/stats`);
    console.log(`   Origin Pull: POST ${url}/api/origin/pull`);
    console.log(`   Files: GET ${url}/api/cached-files`);
    console.log('');
    console.log('🖼️  Image Transformation:');
    console.log(`   ${url}/cdn/<key>?w=800&h=600&q=80&f=webp`);
    console.log(`   Parameters: w/width, h/height, q/quality, f/format`);
    console.log('');
    console.log('✨ Drop files into watched directories to auto-cache!');
    console.log('');
  }
}
