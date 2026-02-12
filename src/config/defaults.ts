import { CDNConfig } from '../types';

export const defaultConfig: CDNConfig = {
  port: 8080,
  nodeId: 'node-1',
  region: 'us-east',
  cacheDir: './cache',
  maxCacheSize: 1024 * 1024 * 1024,
  ttl: 86400,
  compression: true,
  http2: false,
  apiKey: process.env.PCDN_API_KEY || 'default-api-key-change-in-production',
  watchDirs: ['./uploads'],
  nodes: [
    {
      id: 'node-1',
      host: 'localhost',
      port: 8080,
      region: 'us-east',
      weight: 100,
      healthy: true
    }
  ],
  rateLimit: {
    enabled: true,
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 1000, // 1000 requests per 15 minutes
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },
  redis: {
    enabled: false,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: 'pcdn:',
    ttl: 86400
  },
  imageTransform: {
    enabled: true,
    maxWidth: 4000,
    maxHeight: 4000,
    quality: 85,
    allowedFormats: ['jpeg', 'png', 'webp', 'avif', 'gif'],
    defaultFormat: 'jpeg',
    cacheTransformed: true
  }
};
