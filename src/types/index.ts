export interface SSLConfigType {
  enabled: boolean;
  auto?: boolean;
  email?: string;
  domains?: string[];
  agreeTos?: boolean;
  certPath?: string;
  keyPath?: string;
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs?: number; // Time window in milliseconds (default: 15 minutes)
  maxRequests?: number; // Max requests per window (default: 100)
  skipSuccessfulRequests?: boolean; // Skip successful requests from count
  skipFailedRequests?: boolean; // Skip failed requests from count
}

export interface RedisConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  ttl?: number;
}

export interface ImageTransformConfig {
  enabled: boolean;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // JPEG/WebP quality (1-100)
  allowedFormats?: string[]; // ['jpeg', 'png', 'webp', 'avif']
  defaultFormat?: string;
  cacheTransformed?: boolean; // Cache transformed images
}

export interface ProtocolConfig {
  http2?: boolean;
  http3?: boolean; // QUIC support
  webSocket?: boolean;
  webSocketPath?: string;
  maxWebSocketConnections?: number;
  webSocketTimeout?: number;
  quicPort?: number;
}

export interface CDNConfig {
  port: number;
  nodeId: string;
  region: string;
  cacheDir: string;
  maxCacheSize: number;
  ttl: number;
  nodes: EdgeNode[];
  ssl?: SSLConfigType;
  compression: boolean;
  http2: boolean; // Deprecated: use protocols.http2 instead
  apiKey: string;
  watchDirs?: string[];
  origin?: OriginConfig;
  rateLimit?: RateLimitConfig;
  redis?: RedisConfig;
  imageTransform?: ImageTransformConfig;
  protocols?: ProtocolConfig;
}

export interface EdgeNode {
  id: string;
  host: string;
  port: number;
  region: string;
  weight: number;
  healthy: boolean;
}

export interface CacheEntry {
  key: string;
  path: string;
  size: number;
  contentType: string;
  etag: string;
  lastModified: Date;
  expiresAt: Date;
  accessCount: number;
  compressed: boolean;
  encodings: string[];
  isTransformed?: boolean;
  originalKey?: string;
}

export interface UploadResponse {
  success: boolean;
  url: string;
  cdnUrl: string;
  size: number;
  etag: string;
  cached: boolean;
  nodes: string[];
}

export interface Stats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  totalBandwidth: number;
  activeConnections: number;
  cacheSize: number;
  uptime: number;
}

export interface OriginConfig {
  enabled: boolean;
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  retryAttempts?: number;
  cacheOnPull?: boolean;
  followRedirects?: boolean;
  maxRedirectDepth?: number;
  allowedExtensions?: string[];
  deniedExtensions?: string[];
}

export interface OriginPullResult {
  success: boolean;
  key: string;
  url: string;
  cdnUrl: string;
  size: number;
  contentType: string;
  cached: boolean;
  source: 'origin' | 'cache';
  originUrl: string;
}

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'jpeg' | 'jpg' | 'png' | 'webp' | 'avif' | 'gif';
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  position?: 'top' | 'right top' | 'right' | 'right bottom' | 'bottom' | 'left bottom' | 'left' | 'left top' | 'center' | 'centre';
}

export interface TransformedImageResult {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  size: number;
}
