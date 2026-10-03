import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { watermarkPayload } from './watermark';

/** 标在控制器 / 方法上：这个接口的响应不打客户微信水印。 */
export const NO_WATERMARK_KEY = 'noWechatWatermark';
export const NoWatermark = () => SetMetadata(NO_WATERMARK_KEY, true);

/**
 * 客户微信号隐形水印（老板 2026-10-04）。
 *
 * 挂在**全局**：只要响应体里出现客户微信号（`customerWechat` / 客户对象上的 `wechatId`），
 * 就按「当前登录账号 + 今天」追加一段看不见的字符。
 * 老板拿可疑文本到「微信号溯源」页一粘，就知道是谁、哪天看过的。
 *
 * 全局挂的原因（也是老板的要求）：显示客户微信的地方散在几十个页面 / 接口，
 * 一个个改必然漏；挂在出口一处，以后新加的接口也自动覆盖。
 * 需要豁免的接口用 `@NoWatermark()`。
 */
@Injectable()
export class WechatWatermarkInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const cls = context.getClass();
    if (this.reflector.getAllAndOverride<boolean>(NO_WATERMARK_KEY, [handler, cls])) {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    const secret = process.env.JWT_SECRET || '';
    if (!user?.id || !secret) return next.handle();
    const at = new Date();
    return next
      .handle()
      .pipe(map((payload) => watermarkPayload(payload, { userId: user.id, secret, at })));
  }
}