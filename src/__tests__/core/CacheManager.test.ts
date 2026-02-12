import { CacheManager } from '../../core/CacheManager';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = path.join(os.tmpdir(), `pcdn-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
    
    cacheManager = new CacheManager(tempDir, 100 * 1024 * 1024, 3600); // 100MB cache
  });

  afterEach(async () => {
    // Cleanup
    if (cacheManager) {
      await cacheManager.shutdown();
    }
    await fs.remove(tempDir);
  });

  describe('generateKey', () => {
    it('should generate a consistent key for the same filename', () => {
      const key1 = cacheManager.generateKey('test.jpg');
      const key2 = cacheManager.generateKey('test.jpg');
      
      expect(key1).toBe(key2);
      expect(typeof key1).toBe('string');
      expect(key1.length).toBeGreaterThan(0);
    });

    it('should generate different keys for different filenames', () => {
      const key1 = cacheManager.generateKey('test1.jpg');
      const key2 = cacheManager.generateKey('test2.jpg');
      
      expect(key1).not.toBe(key2);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve content', async () => {
      const content = Buffer.from('Hello, World!');
      const entry = await cacheManager.set('test-file', content, 'text/plain');
      
      const retrieved = cacheManager.get(entry.key);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe(entry.key);
      expect(retrieved?.contentType).toBe('text/plain');
      expect(retrieved?.size).toBe(content.length);
    });

    it('should return undefined for non-existent keys', () => {
      const entry = cacheManager.get('non-existent-key');
      
      expect(entry).toBeUndefined();
    });

    it('should update access count on get', async () => {
      const content = Buffer.from('Test content');
      const entry = await cacheManager.set('access-test', content, 'text/plain');
      
      const entry1 = cacheManager.get(entry.key);
      expect(entry1?.accessCount).toBe(1);
      
      const entry2 = cacheManager.get(entry.key);
      expect(entry2?.accessCount).toBe(2);
    });
  });

  describe('delete', () => {
    it('should delete existing entries', async () => {
      const content = Buffer.from('To be deleted');
      const entry = await cacheManager.set('delete-test', content, 'text/plain');
      
      const deleted = await cacheManager.delete(entry.key);
      
      expect(deleted).toBe(true);
      expect(cacheManager.get(entry.key)).toBeUndefined();
    });

    it('should return false for non-existent keys', async () => {
      const deleted = await cacheManager.delete('non-existent');
      
      expect(deleted).toBe(false);
    });
  });

  describe('purge', () => {
    it('should clear all cache entries', async () => {
      await cacheManager.set('file1', Buffer.from('content1'), 'text/plain');
      await cacheManager.set('file2', Buffer.from('content2'), 'text/plain');
      
      const count = await cacheManager.purge();
      
      expect(count).toBe(2);
      expect(cacheManager.getAllKeys()).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      const content = Buffer.from('Stats test');
      await cacheManager.set('stats-test', content, 'text/plain');
      
      const stats = cacheManager.getStats();
      
      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('currentSize');
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('persisted');
      expect(stats.entries).toBe(1);
    });
  });
});
