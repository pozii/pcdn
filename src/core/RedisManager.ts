import Redis from 'ioredis';
import { RedisConfig, CacheEntry } from '../types';
import { Logger } from '../utils/Logger';

export class RedisManager {
  private client: Redis | null = null;
  private config: RedisConfig;
  private logger: Logger;
  private isConnected: boolean = false;

  constructor(config: RedisConfig) {
    this.config = {
      host: 'localhost',
      port: 6379,
      db: 0,
      keyPrefix: 'pcdn:',
      ttl: 86400, // 24 hours
      ...config
    };
    this.logger = new Logger('RedisManager');
  }

  async connect(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Redis is disabled');
      return;
    }

    try {
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        keyPrefix: this.config.keyPrefix,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      this.client.on('connect', () => {
        this.logger.info('Redis connected', {
          host: this.config.host,
          port: this.config.port
        });
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        this.logger.error('Redis error', { error: err.message });
        this.isConnected = false;
      });

      this.client.on('close', () => {
        this.logger.warn('Redis connection closed');
        this.isConnected = false;
      });

      // Test connection
      await this.client.connect();
      await this.client.ping();
      
    } catch (error) {
      this.logger.error('Failed to connect to Redis', { error });
      this.client = null;
      this.isConnected = false;
      // Don't throw - allow app to work without Redis
    }
  }

  isEnabled(): boolean {
    return this.config.enabled && this.isConnected;
  }

  async get(key: string): Promise<CacheEntry | null> {
    if (!this.isEnabled() || !this.client) return null;

    try {
      const data = await this.client.get(key);
      if (data) {
        return JSON.parse(data) as CacheEntry;
      }
      return null;
    } catch (error) {
      this.logger.error('Redis get error', { key, error });
      return null;
    }
  }

  async set(key: string, entry: CacheEntry, ttl?: number): Promise<void> {
    if (!this.isEnabled() || !this.client) return;

    try {
      const effectiveTtl = ttl || this.config.ttl || 86400;
      await this.client.setex(key, effectiveTtl, JSON.stringify(entry));
    } catch (error) {
      this.logger.error('Redis set error', { key, error });
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isEnabled() || !this.client) return;

    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.error('Redis delete error', { key, error });
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isEnabled() || !this.client) return false;

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error('Redis exists error', { key, error });
      return false;
    }
  }

  async getStats(): Promise<{ keys: number; memory: string } | null> {
    if (!this.isEnabled() || !this.client) return null;

    try {
      const info = await this.client.info('memory');
      const dbsize = await this.client.dbsize();
      
      // Parse used_memory from info
      const memoryMatch = info.match(/used_memory_human:(.+?)\r/);
      const memory = memoryMatch ? memoryMatch[1].trim() : 'unknown';

      return {
        keys: dbsize,
        memory
      };
    } catch (error) {
      this.logger.error('Redis stats error', { error });
      return null;
    }
  }

  async flush(): Promise<void> {
    if (!this.isEnabled() || !this.client) return;

    try {
      // Only flush keys with our prefix
      const keys = await this.client.keys(`${this.config.keyPrefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
        this.logger.info('Redis cache flushed', { keysDeleted: keys.length });
      }
    } catch (error) {
      this.logger.error('Redis flush error', { error });
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      this.logger.info('Redis disconnected');
    }
  }

  // Distributed lock for cache invalidation
  async acquireLock(lockKey: string, ttlSeconds: number = 30): Promise<boolean> {
    if (!this.isEnabled() || !this.client) return true;

    try {
      const result = await this.client.set(
        `lock:${lockKey}`,
        Date.now().toString(),
        'EX',
        ttlSeconds,
        'NX'
      );
      return result === 'OK';
    } catch (error) {
      this.logger.error('Redis lock error', { lockKey, error });
      return false;
    }
  }

  async releaseLock(lockKey: string): Promise<void> {
    if (!this.isEnabled() || !this.client) return;

    try {
      await this.client.del(`lock:${lockKey}`);
    } catch (error) {
      this.logger.error('Redis unlock error', { lockKey, error });
    }
  }
}
