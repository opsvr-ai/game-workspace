/**
 * HTTP 层面的两个小工具：取 Bearer 令牌、判断局域网来源。
 *
 * 这两段逻辑原先在 ws / chat 两个网关和 logger / 限流守卫里各抄了一份，
 * 收敛到一处后，以后改规则只改这里。
 */

/** 取出 Authorization 头里的令牌（不验签，只用来给限流分账 / 记日志；真伪由各接口自己的守卫判定） */
export function bearerToken(header: unknown): string {
  const raw = typeof header === 'string' ? header : '';
  return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : '';
}

/** 局域网来源（192.168.x / 10.x / 172.16–31.x），CORS 放行用 */
export function isLanOrigin(origin: string): boolean {
  return /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)(\d{1,3}\.)?\d{1,3}(:\d+)?$/.test(origin);
}
