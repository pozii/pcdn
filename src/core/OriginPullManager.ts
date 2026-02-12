import axios, { AxiosResponse, AxiosError } from 'axios';
import mime from 'mime-types';
import * as path from 'path';
import { CacheManager } from './CacheManager';
import { MetricsCollector } from './MetricsCollector';
import { OriginConfig, OriginPullResult } from '../types';

export class OriginPullManager {
  private config: OriginConfig;
  private cacheManager: CacheManager;
  private metrics?: MetricsCollector;

  constructor(config: OriginConfig, cacheManager: CacheManager, metrics?: MetricsCollector) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      cacheOnPull: true,
      followRedirects: true,
      maxRedirectDepth: 5,
      ...config
    };
    this.cacheManager = cacheManager;
    this.metrics = metrics;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getOriginUrl(): string {
    return this.config.url;
  }

  async pullFromOrigin(requestPath: string, baseUrl: string): Promise<OriginPullResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        key: '',
        url: '',
        cdnUrl: '',
        size: 0,
        contentType: '',
        cached: false,
        source: 'origin',
        originUrl: ''
      };
    }

    // Check file extension restrictions
    const ext = path.extname(requestPath).toLowerCase();
    if (this.config.deniedExtensions?.includes(ext)) {
      throw new Error(`File extension ${ext} is not allowed`);
    }
    if (this.config.allowedExtensions && !this.config.allowedExtensions.includes(ext)) {
      throw new Error(`File extension ${ext} is not in allowed list`);
    }

    // Construct origin URL
    const originUrl = this.buildOriginUrl(requestPath);
    const key = this.cacheManager.generateKey(requestPath);

    try {
      console.log(`🌐 Origin Pull: ${originUrl}`);
      
      const startTime = Date.now();
      const response = await this.fetchFromOrigin(originUrl);
      const duration = Date.now() - startTime;

      if (!response.data) {
        throw new Error('Empty response from origin');
      }

      const content = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
      const contentType = response.headers['content-type'] || mime.lookup(requestPath) || 'application/octet-stream';
      const size = content.length;

      // Cache the content if enabled
      let cached = false;
      if (this.config.cacheOnPull) {
        await this.cacheManager.set(key, content, contentType);
        cached = true;
        console.log(`✅ Cached from origin: ${requestPath} (${size} bytes)`);
      }

      // Record metrics
      if (this.metrics) {
        this.metrics.recordCacheMiss('origin_pull');
        this.metrics.recordBandwidth(size, contentType);
      }

      return {
        success: true,
        key,
        url: `/cdn/${key}`,
        cdnUrl: `${baseUrl}/cdn/${key}`,
        size,
        contentType,
        cached,
        source: 'origin',
        originUrl
      };

    } catch (error) {
      console.error(`❌ Origin pull failed for ${requestPath}:`, error);
      throw error;
    }
  }

  private buildOriginUrl(requestPath: string): string {
    // Remove leading slash if present
    const cleanPath = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath;
    
    // Ensure origin URL doesn't have trailing slash
    const baseOrigin = this.config.url.replace(/\/$/, '');
    
    return `${baseOrigin}/${cleanPath}`;
  }

  private async fetchFromOrigin(url: string, redirectCount: number = 0): Promise<AxiosResponse> {
    if (redirectCount > (this.config.maxRedirectDepth || 5)) {
      throw new Error('Maximum redirect depth exceeded');
    }

    const headers: Record<string, string> = {
      'User-Agent': 'PCDN-OriginPull/1.0',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      ...this.config.headers
    };

    try {
      const response = await axios.get(url, {
        headers,
        timeout: this.config.timeout,
        responseType: 'arraybuffer',
        maxRedirects: this.config.followRedirects ? this.config.maxRedirectDepth : 0,
        validateStatus: (status) => status === 200
      });

      return response;
    } catch (error) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        const status = axiosError.response.status;
        
        if (status === 404) {
          throw new Error(`Origin returned 404: ${url}`);
        } else if (status >= 500) {
          // Retry on server errors
          if (redirectCount < (this.config.retryAttempts || 3)) {
            console.log(`⚠️ Origin returned ${status}, retrying... (${redirectCount + 1}/${this.config.retryAttempts})`);
            await this.sleep(1000 * (redirectCount + 1)); // Exponential backoff
            return this.fetchFromOrigin(url, redirectCount + 1);
          }
        }
        
        throw new Error(`Origin returned ${status}: ${url}`);
      }
      
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async prefetch(urls: string[], baseUrl: string): Promise<OriginPullResult[]> {
    const results: OriginPullResult[] = [];
    
    console.log(`🚀 Prefetching ${urls.length} URLs from origin...`);
    
    for (const url of urls) {
      try {
        const result = await this.pullFromOrigin(url, baseUrl);
        results.push(result);
      } catch (error) {
        console.error(`❌ Prefetch failed for ${url}:`, error);
      }
    }
    
    console.log(`✅ Prefetch complete: ${results.filter(r => r.success).length}/${urls.length} successful`);
    
    return results;
  }

  getConfig(): OriginConfig {
    return { ...this.config };
  }
}