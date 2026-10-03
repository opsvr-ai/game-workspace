import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { stripWatermark } from './watermark';

/**
 * 进站文本「消毒」：把客户微信隐形水印的那几个零宽字符从请求体 / 查询参数里剥掉。
 *
 * 为什么必须有：客户端拿到的是**打过水印**的值（`abc123\u200B...`），
 * 如果陪玩在客户管理里改个备注再保存，整条记录会带着水印写回数据库 ——
 * 那以后这个微信号就永远是脏的（复制到微信加好友会对不上）。
 * 所以入口统一剥掉，存的永远是干净值。
 *
 * 例外：`/api/watermark/decode`（老板粘可疑文本过来解码），那里的水印字符正是要读的。
 */
@Injectable()
export class InvisibleTextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    // 别用 `req.path` 单打独斗：Nest 挂载中间件时会把挂载前缀从 url 里摘掉，
    // 实测 `/api/watermark/decode` 进到这里时 req.path 只剩 `/`（baseUrl 才带全路径），
    // 结果「解码接口豁免」失效、老板粘过来的水印字符被剥光（2026-10-04 线上踩到）。
    const urls = [(req as any).originalUrl, (req as any).baseUrl, (req as any).url, (req as any).path]
      .filter((v) => typeof v === 'string')
      .join(' ');
    if (urls.includes('/watermark/decode')) return next();

    const scrub = (node: any, depth = 0): any => {
      if (depth > 12 || node == null) return node;
      if (typeof node === 'string') return stripWatermark(node);
      if (typeof node !== 'object') return node;
      if (node instanceof Date || Buffer.isBuffer(node)) return node;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) node[i] = scrub(node[i], depth + 1);
        return node;
      }
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (typeof v === 'string') node[key] = stripWatermark(v);
        else if (v && typeof v === 'object') node[key] = scrub(v, depth + 1);
      }
      return node;
    };

    // 只处理 body / query：Express 的 req.params 在中间件阶段还是空的（要等路由匹配才填），
    // 在这里 scrub 是空转；而路径参数只会是 id（永远不带水印），所以也不需要。
    if (req.body && typeof req.body === 'object') scrub(req.body);
    if (req.query && typeof req.query === 'object') scrub(req.query);
    next();
  }
}