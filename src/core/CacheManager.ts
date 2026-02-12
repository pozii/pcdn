import { CacheEntry } from '../types';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import NodeCache from 'node-cache';
import { Logger } from '../utils/Logger';

interface CacheMetadata {
  version: string;
  lastSaved: string;
  entries: CacheEntry[];
  accessLog: Array<[string, number]>;
}

export class CacheManager {
  private cache: NodeCache;
  private cacheDir: string;
  private maxSize: number;
  private currentSize: number = 0;
  private accessLog: Map<string, number> = new Map();
  private metadataPath: string;
  private persistenceInterval: NodeJS.Timeout | null = null;
  private logger: Logger;
  private isShuttingDown: boolean = false;

  constructor(cacheDir: string, maxSize: number, ttl: number) {
    this.cacheDir = cacheDir;
    this.maxSize = maxSize;
    this.metadataPath = path.join(cacheDir, '.cache-metadata.json');
    this.logger = new Logger('CacheManager');
    
    this.cache = new NodeCache({ 
      stdTTL: ttl, 
      checkperiod: 600,
      useClones: false // Better performance for large files
    });

    // Listen for cache events
    this.cache.on('expired', (key: string) => {
      this.logger.debug('Cache entry expired', { key });
      this.handleCacheExpired(key);
    });

    this.cache.on('flush', () => {
      this.logger.info('Cache flushed');
      this.accessLog.clear();
      this.currentSize = 0;
    });
    
    fs.ensureDirSync(cacheDir);
    
    // Load persisted cache on startup
    this.loadPersistedCache().then(() => {
      this.startPersistence();
    });
  }

  private async loadPersistedCache(): Promise<void> {
    try {
      if (await fs.pathExists(this.metadataPath)) {
        this.logger.info('Loading persisted cache metadata...');
        const metadata: CacheMetadata = await fs.readJson(this.metadataPath);
        
        // Validate metadata version
        if (metadata.version !== '1.0') {
          this.logger.warn('Cache metadata version mismatch, starting fresh');
          return;
        }

        // Restore access log
        if (metadata.accessLog) {
          this.accessLog = new Map(metadata.accessLog);
        }

        // Verify and restore cache entries
        let restoredCount = 0;
        let failedCount = 0;

        for (const entry of metadata.entries) {
          try {
            // Verify file still exists
            if (await fs.pathExists(entry.path)) {
              const stats = await fs.stat(entry.path);
              
              // Verify file size matches
              if (stats.size === entry.size) {
                // Check if entry is still valid (not expired)
                if (new Date(entry.expiresAt) > new Date()) {
                  this.cache.set(entry.key, entry);
                  this.currentSize += entry.size;
                  restoredCount++;
                } else {
                  // Clean up expired file
                  await fs.remove(entry.path);
                  failedCount++;
                }
              } else {
                // File size mismatch, remove it
                await fs.remove(entry.path);
                failedCount++;
              }
            } else {
              failedCount++;
            }
          } catch (error) {
            this.logger.error('Error restoring cache entry', { key: entry.key, error });
            failedCount++;
          }
        }

        this.logger.info('Cache persistence loaded', {
          restored: restoredCount,
          failed: failedCount,
          currentSize: this.currentSize
        });
      } else {
        // No metadata, just scan existing files
        await this.loadExistingCache();
      }
    } catch (error) {
      this.logger.error('Error loading persisted cache', { error });
      await this.loadExistingCache();
    }
  }

  private async loadExistingCache(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        if (file === '.cache-metadata.json') continue;
        
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          this.currentSize += stats.size;
        }
      }
      
      this.logger.info('Existing cache scanned', { currentSize: this.currentSize });
    } catch (error) {
      this.logger.error('Error loading existing cache', { error });
    }
  }

  private startPersistence(): void {
    // Save metadata every 30 seconds
    this.persistenceInterval = setInterval(() => {
      this.saveMetadata().catch(err => {
        this.logger.error('Error saving cache metadata', { error: err });
      });
    }, 30000);

    this.logger.info('Cache persistence started');
  }

  private async saveMetadata(): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      const keys = this.cache.keys();
      const entries: CacheEntry[] = [];

      for (const key of keys) {
        const entry = this.cache.get<CacheEntry>(key);
        if (entry) {
          entries.push(entry);
        }
      }

      const metadata: CacheMetadata = {
        version: '1.0',
        lastSaved: new Date().toISOString(),
        entries,
        accessLog: Array.from(this.accessLog.entries())
      };

      await fs.writeJson(this.metadataPath, metadata, { spaces: 2 });
      this.logger.debug('Cache metadata saved', { entries: entries.length });
    } catch (error) {
      this.logger.error('Failed to save cache metadata', { error });
      throw error;
    }
  }

  private async handleCacheExpired(key: string): Promise<void> {
    const entry = this.cache.get<CacheEntry>(key);
    if (entry) {
      try {
        await fs.remove(entry.path);
        this.currentSize -= entry.size;
        this.accessLog.delete(key);
        this.logger.debug('Expired cache file removed', { key, path: entry.path });
      } catch (error) {
        this.logger.error('Error removing expired cache file', { key, error });
      }
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Shutting down cache manager...');

    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
    }

    // Final save
    await this.saveMetadata();
    
    this.logger.info('Cache manager shutdown complete');
  }

  generateKey(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  get(key: string): CacheEntry | undefined {
    if (this.isShuttingDown) return undefined;

    const entry = this.cache.get<CacheEntry>(key);
    if (entry) {
      const currentCount = this.accessLog.get(key) || 0;
      this.accessLog.set(key, currentCount + 1);
      
      // Update entry access count for LRU
      entry.accessCount = currentCount + 1;
      this.cache.set(key, entry);
    }
    return entry;
  }

  async set(key: string, data: Buffer, contentType: string, encodings: string[] = []): Promise<CacheEntry> {
    if (this.isShuttingDown) {
      throw new Error('Cache manager is shutting down');
    }

    const cachePath = path.join(this.cacheDir, key);
    
    if (data.length > this.maxSize * 0.1) {
      this.logger.warn('File too large for cache', { key, size: data.length, maxAllowed: this.maxSize * 0.1 });
      throw new Error('File too large for cache');
    }

    await this.ensureSpace(data.length);
    
    try {
      await fs.writeFile(cachePath, data);
    } catch (error) {
      this.logger.error('Failed to write cache file', { key, path: cachePath, error });
      throw new Error('Failed to write cache file');
    }

    const entry: CacheEntry = {
      key,
      path: cachePath,
      size: data.length,
      contentType,
      etag: crypto.createHash('md5').update(data).digest('hex'),
      lastModified: new Date(),
      expiresAt: new Date(Date.now() + (this.cache.options.stdTTL || 86400) * 1000),
      accessCount: 0,
      compressed: encodings.includes('gzip') || encodings.includes('br'),
      encodings
    };

    this.cache.set(key, entry);
    this.currentSize += data.length;
    this.accessLog.set(key, 0);

    this.logger.debug('Cache entry created', { key, size: data.length, contentType });

    return entry;
  }

  private async ensureSpace(requiredBytes: number): Promise<void> {
    while (this.currentSize + requiredBytes > this.maxSize && this.accessLog.size > 0) {
      await this.evictLRU();
    }
  }

  private async evictLRU(): Promise<void> {
    const keys = Array.from(this.accessLog.entries());
    keys.sort((a, b) => a[1] - b[1]);
    
    if (keys.length === 0) return;
    
    const [lruKey] = keys[0];
    const entry = this.cache.get<CacheEntry>(lruKey);
    
    if (entry) {
      this.logger.debug('Evicting LRU cache entry', { key: lruKey, accessCount: entry.accessCount });
      await this.delete(lruKey);
    }
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.cache.get<CacheEntry>(key);
    if (!entry) return false;

    try {
      await fs.remove(entry.path);
      this.currentSize -= entry.size;
      this.cache.del(key);
      this.accessLog.delete(key);
      
      this.logger.debug('Cache entry deleted', { key });
      return true;
    } catch (error) {
      this.logger.error('Error deleting cache entry', { key, error });
      return false;
    }
  }

  async purge(): Promise<number> {
    this.logger.info('Purging all cache entries');
    const keys = this.cache.keys();
    let count = 0;
    
    for (const key of keys) {
      if (await this.delete(key)) {
        count++;
      }
    }
    
    // Clear metadata file
    try {
      await fs.remove(this.metadataPath);
    } catch (error) {
      this.logger.error('Error removing metadata file', { error });
    }
    
    this.logger.info('Cache purge complete', { purged: count });
    return count;
  }

  async invalidatePattern(pattern: string): Promise<number> {
    this.logger.info('Invalidating cache by pattern', { pattern });
    const keys = this.cache.keys();
    let regex: RegExp;
    
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      this.logger.error('Invalid regex pattern', { pattern, error });
      throw new Error('Invalid regex pattern');
    }
    
    let count = 0;
    
    for (const key of keys) {
      if (regex.test(key)) {
        if (await this.delete(key)) {
          count++;
        }
      }
    }
    
    this.logger.info('Pattern invalidation complete', { pattern, invalidated: count });
    return count;
  }

  getStats(): { size: number; entries: number; currentSize: number; persisted: boolean } {
    return {
      size: this.maxSize,
      entries: this.cache.keys().length,
      currentSize: this.currentSize,
      persisted: !this.isShuttingDown
    };
  }

  getAllKeys(): string[] {
    return this.cache.keys() as string[];
  }
}
