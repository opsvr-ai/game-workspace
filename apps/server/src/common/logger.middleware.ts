import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger';
import { presence } from './presence';

/**
 * 只解不验：日志 / 在线状态只需要「这是谁」，签名由各个 Guard 严格校验。
 * 以前日志里只有 method/url/status，看不出「是谁在什么时候重登 / 掉线」，
 * 排查老板报的「又是谁掉线了」只能靠猜。
 */
function decodeJwtPayload(token: string): any {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function bearerToken(req: Request): string {
  const auth = req.get('authorization') || '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

function identityOf(token: string): { userId?: string; username?: string; role?: string } | null {
  const payload = decodeJwtPayload(token);
  if (!payload?.sub) return null;
  return { userId: payload.sub, username: payload.username, role: payload.role };
}

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const { method, originalUrl } = req;
    const userAgent = req.get('user-agent') || '';

    const token = bearerToken(req);
    const caller = token ? identityOf(token) : null;
    if (caller?.userId) presence.markSeen(caller.userId);

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      const extra: Record<string, unknown> = {};
      if (caller?.userId) {
        extra.userId = caller.userId;
        extra.username = caller.username;
        extra.role = caller.role;
      } else {
        // 登录 / 换令牌的请求没有 Bearer 头（或者头里的令牌已经坏掉），
        // 从请求体里把身份补出来：到底是哪台机器、哪个账号在重新登录。
        const body: any = (req as any).body;
        if (body && typeof body === 'object') {
          const fromRefresh =
            typeof body.refreshToken === 'string' ? identityOf(body.refreshToken) : null;
          if (fromRefresh?.userId) {
            extra.userId = fromRefresh.userId;
            extra.username = fromRefresh.username;
            extra.role = fromRefresh.role;
          } else if (typeof body.username === 'string' && /\/auth\/login/.test(originalUrl)) {
            extra.loginUsername = body.username;
          }
        }
      }
      logger.info('HTTP', {
        method,
        url: originalUrl,
        status: statusCode,
        duration: `${duration}ms`,
        userAgent,
        ...extra,
      });
    });

    next();
  }
}
