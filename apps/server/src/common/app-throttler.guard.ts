import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { bearerToken } from './http-auth';

/**
 * 限流按谁记账（老板 2026-09-21 报「秦伟杰登录不上，提示 too many request」）。
 *
 * 以前一律按来访 IP 记账，但工作室/宿舍是几十台机器共用一个公网出口
 * （实测办公室出口还在两条宽带间跳），于是：
 *   ① 一个人连输 4 次密码，就把整个工作室 5 次/分钟的登录额度占满，别人跟着登不上；
 *   ② 每个客户端的订单池轮询互相挤爆配额 —— 线上日志里 /api/orders/pool 被限流 1365 次、
 *      /api/orders/pool/status 1055 次、/api/auth/login 224 次，陪玩看到的是空订单池。
 *
 * 现在改成按「人」记账：
 *   ① 登录 / 注册 / 找回密码 → 账号 + 来访 IP（同一个人失败不影响别人，跨账号撞库仍受配额限制）；
 *   ② 带令牌的请求 → 用户 id（同一个公网出口下每个陪玩各算各的）；
 *   ③ 没带令牌 → 仍按 IP。
 */

/** 解出 JWT 里的 sub（用户 id）；解不出来返回空字符串 */
export function jwtSubject(token: string): string {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    return typeof payload?.sub === 'string' ? payload.sub : '';
  } catch {
    return '';
  }
}

/** 需要按「账号」记账的接口：这里一个人反复失败不该连累同办公室的其他人 */
const ACCOUNT_SCOPED_URL = /\/auth\/(login|register|forgot-password)/;

export function throttleKey(input: {
  url: string;
  ip: string;
  username?: string | null;
  authorization?: unknown;
}): string {
  const url = input.url || '';
  const ip = input.ip || 'unknown';

  if (ACCOUNT_SCOPED_URL.test(url)) {
    const username = (input.username || '').trim().toLowerCase();
    if (username) return `login:${ip}:${username}`;
  }

  const subject = jwtSubject(bearerToken(input.authorization));
  return subject ? `user:${subject}` : `ip:${ip}`;
}

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = (await super.getTracker(req)) || 'unknown';
    const body = (req?.body || {}) as Record<string, unknown>;
    return throttleKey({
      url: String(req?.originalUrl || req?.url || ''),
      ip,
      username: typeof body.username === 'string' ? body.username : '',
      authorization: req?.headers?.authorization,
    });
  }

  /** 被限流时给一句人话，别再让前端显示 “ThrottlerException: Too Many Requests” */
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(1, Math.ceil(Number(detail?.timeToExpire) || 1));
    try {
      const res = context.switchToHttp().getResponse();
      if (res?.setHeader) res.setHeader('Retry-After', String(seconds));
    } catch {
      /* 拿不到响应对象也不影响提示 */
    }
    throw new ThrottlerException(`操作太频繁，请等 ${seconds} 秒再试`);
  }
}
