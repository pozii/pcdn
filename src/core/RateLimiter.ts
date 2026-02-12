import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { RateLimitConfig } from '../types';
import { Logger } from '../utils/Logger';

export class RateLimiter {
  private config: RateLimitConfig;
  private logger: Logger;

  constructor(config: RateLimitConfig) {
    this.config = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 100,
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      ...config
    };
    this.logger = new Logger('RateLimiter');
    
    if (this.config.enabled) {
      this.logger.info('Rate limiting enabled', {
        windowMs: this.config.windowMs,
        maxRequests: this.config.maxRequests
      });
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getMiddleware() {
    if (!this.config.enabled) {
      return (req: Request, res: Response, next: Function) => next();
    }

    return rateLimit({
      windowMs: this.config.windowMs,
      max: this.config.maxRequests,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: this.config.skipSuccessfulRequests,
      skipFailedRequests: this.config.skipFailedRequests,
      keyGenerator: (req: Request) => {
        // Use API key if available, otherwise use IP
        return (req.headers['x-api-key'] as string) || req.ip || 'unknown';
      },
      handler: (req: Request, res: Response) => {
        this.logger.warn('Rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          apiKey: req.headers['x-api-key'] ? 'present' : 'none'
        });
        
        res.status(429).json({
          success: false,
          error: 'Too many requests, please try again later',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((this.config.windowMs || 900000) / 1000)
        });
      },
      onLimitReached: (req: Request, res: Response, optionsUsed: any) => {
        this.logger.warn('Rate limit reached for client', {
          ip: req.ip,
          path: req.path
        });
      }
    });
  }

  // Create a stricter middleware for specific routes
  getStrictMiddleware(multiplier: number = 0.5) {
    if (!this.config.enabled) {
      return (req: Request, res: Response, next: Function) => next();
    }

    const strictMax = Math.floor((this.config.maxRequests || 100) * multiplier);

    return rateLimit({
      windowMs: this.config.windowMs,
      max: strictMax,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => {
        return (req.headers['x-api-key'] as string) || req.ip || 'unknown';
      },
      handler: (req: Request, res: Response) => {
        this.logger.warn('Strict rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          limit: strictMax
        });
        
        res.status(429).json({
          success: false,
          error: 'Too many requests for this endpoint',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((this.config.windowMs || 900000) / 1000)
        });
      }
    });
  }
}
