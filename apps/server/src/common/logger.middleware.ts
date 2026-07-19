import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const { method, originalUrl } = req;
    const userAgent = req.get('user-agent') || '';

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      logger.info('HTTP', { method, url: originalUrl, status: statusCode, duration: `${duration}ms`, userAgent });
    });

    next();
  }
}
