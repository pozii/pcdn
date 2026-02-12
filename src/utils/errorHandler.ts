import { Request, Response, NextFunction } from 'express';
import { logger } from './Logger';
import { v4 as uuidv4 } from 'uuid';

export interface RequestWithId extends Request {
  requestId: string;
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = req.headers['x-request-id'] as string || uuidv4();
  (req as RequestWithId).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const requestId = (req as RequestWithId).requestId;

  logger.http('Request started', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    
    logger.log(level, 'Request completed', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      contentLength: res.get('content-length')
    });
  });

  next();
};

interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export class PCDNError extends Error {
  statusCode: number;
  isOperational: boolean;
  code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR', isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandlerMiddleware = (
  err: AppError | PCDNError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = (req as RequestWithId).requestId;
  
  let statusCode = 500;
  let message = 'Internal Server Error';
  let errorCode = 'INTERNAL_ERROR';

  if (err instanceof PCDNError) {
    statusCode = err.statusCode;
    message = err.message;
    errorCode = err.code;
  } else if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message;
  }

  // Log error
  logger.error('Request error', {
    requestId,
    error: err.message,
    stack: err.stack,
    statusCode,
    errorCode,
    url: req.url,
    method: req.method,
    isOperational: (err as PCDNError).isOperational || false
  });

  // Don't leak error details in production for 500 errors
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal Server Error';
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    code: errorCode,
    requestId,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};

// Async handler wrapper to catch errors in async route handlers
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Unhandled error handlers
export const setupUnhandledErrorHandlers = (): void => {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled Rejection', { reason });
    process.exit(1);
  });
};
