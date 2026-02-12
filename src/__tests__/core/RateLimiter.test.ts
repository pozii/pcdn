import { RateLimiter } from '../../core/RateLimiter';
import { Request, Response } from 'express';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      enabled: true,
      windowMs: 60000, // 1 minute
      maxRequests: 5
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled', () => {
      expect(rateLimiter.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const disabledLimiter = new RateLimiter({ enabled: false });
      expect(disabledLimiter.isEnabled()).toBe(false);
    });
  });

  describe('getMiddleware', () => {
    it('should return middleware function', () => {
      const middleware = rateLimiter.getMiddleware();
      expect(typeof middleware).toBe('function');
    });
  });

  describe('getStrictMiddleware', () => {
    it('should return middleware function', () => {
      const middleware = rateLimiter.getStrictMiddleware(0.5);
      expect(typeof middleware).toBe('function');
    });
  });
});
