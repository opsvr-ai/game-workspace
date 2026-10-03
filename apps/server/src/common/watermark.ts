import { createHmac } from 'crypto';

/**
 * 客户微信号「隐形水印」（老板 2026-10-04：「万一……我能顺藤摸瓜找到」）。
 *
 * 做法：接口返回客户微信号时，在字符串**末尾**追加一段完全看不见的字符（Unicode Cf 格式字符），
 * 里面藏着「哪个账号看的 + 哪一天」。陪玩把微信号复制出去 / 转发出去，这段字符会跟着走；
 * 老板把可疑文本粘回「微信号溯源」页，就能查出是谁、哪天看过的。
 *
 * 三条硬约束：
 *  1. **不许落库**：任何请求体进来先被 InvisibleTextMiddleware 把这几个字符剥掉
 *     （客户端如果把带水印的值回传，存的还是干净值）。
 *  2. **不许串味**：只给「客户微信」打（`customerWechat`，以及客户对象上的 `wechatId`）；
 *     陪玩/客服自己的工作微信不打。
 *  3. **不许重复打**：同一段文本只打一次（幂等）。
 */

/** base-4 字母表：四个「零宽 / 格式」字符，正常文本里不会出现。 */
export const WM_ALPHABET = ['\u200B', '\u200C', '\u2060', '\uFEFF'] as const;

/** 水印帧头 / 帧尾：用来在一大段文本里定位水印（老板粘的可能是一整条聊天记录）。 */
const WM_FRAME_START = '\u2060\u200B\u2060\u200B';
const WM_FRAME_END = '\u200B\u2060\u200B\u2060';

const USER_CODE_LEN = 5; // base36 → 36^5 ≈ 6000 万，几十个账号不会撞
const DAY_CODE_LEN = 4; // base36 → 36^4 ≈ 168 万天，够用
const CN_OFFSET_MS = 8 * 60 * 60 * 1000; // 按北京时间算「哪一天」
const DAY0_MS = Date.UTC(2020, 0, 1);

/** 剥掉所有水印字符（请求体过滤 + 前端「复制干净值」共用同一套字符）。 */
export function stripWatermark(text: string): string {
  let out = '';
  for (const ch of text) {
    if ((WM_ALPHABET as readonly string[]).includes(ch)) continue;
    out += ch;
  }
  return out;
}

/** 这段文本里有没有水印。 */
export function containsWatermark(text: string): boolean {
  return typeof text === 'string' && text.includes(WM_FRAME_START);
}

function toBase36(n: number, len: number): string {
  return n.toString(36).toUpperCase().padStart(len, '0').slice(-len);
}

/** 账号短码：HMAC(密钥, userId) 取模 base36 —— 不可反推，只能靠遍历账号比对。 */
export function userWatermarkCode(userId: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(String(userId)).digest();
  const mod = 36n ** BigInt(USER_CODE_LEN);
  let acc = 0n;
  for (const b of mac) acc = (acc * 256n + BigInt(b)) % mod;
  return toBase36(Number(acc), USER_CODE_LEN);
}

/** 日期短码（按北京时间算的自然日）。 */
export function dayWatermarkCode(at: Date = new Date()): string {
  const days = Math.floor((at.getTime() + CN_OFFSET_MS - DAY0_MS) / 86400000);
  return toBase36(Math.max(0, days), DAY_CODE_LEN);
}

/** 日期短码 → YYYY-MM-DD（北京时间的自然日）。 */
export function dayWatermarkCodeToDate(code: string): string | null {
  const days = parseInt(String(code || ''), 36);
  if (!Number.isFinite(days) || days < 0) return null;
  const d = new Date(DAY0_MS + days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 给一段文本打水印（幂等：已经打过就原样返回）。 */
export function encodeWatermark(
  text: string,
  opts: { userId: string; secret: string; at?: Date },
): string {
  if (!text || !opts?.userId || !opts?.secret) return text;
  if (containsWatermark(text)) return text;
  const payload = userWatermarkCode(opts.userId, opts.secret) + dayWatermarkCode(opts.at);
  const digits: number[] = [];
  for (const b of Buffer.from(payload, 'ascii')) {
    digits.push((b >> 6) & 3, (b >> 4) & 3, (b >> 2) & 3, b & 3);
  }
  const body = digits.map((d) => WM_ALPHABET[d]).join('');
  return text + WM_FRAME_START + body + WM_FRAME_END;
}

/** 从文本里解出水印（谁 + 哪天）；没打 / 被打断 / 对不上账号 → null。 */
export function decodeWatermark(
  text: string,
  opts: { users: Array<{ id: string }>; secret: string },
): { userId: string; day: string } | null {
  if (typeof text !== 'string' || !text) return null;
  const start = text.indexOf(WM_FRAME_START);
  if (start < 0) return null;
  const end = text.lastIndexOf(WM_FRAME_END);
  if (end <= start + WM_FRAME_START.length) return null;

  const body = text.slice(start + WM_FRAME_START.length, end);
  const digits: number[] = [];
  for (const ch of body) {
    const idx = (WM_ALPHABET as readonly string[]).indexOf(ch);
    if (idx < 0) return null;
    digits.push(idx);
  }
  if (digits.length === 0 || digits.length % 4 !== 0) return null;

  const bytes: number[] = [];
  for (let i = 0; i < digits.length; i += 4) {
    bytes.push((digits[i] << 6) | (digits[i + 1] << 4) | (digits[i + 2] << 2) | digits[i + 3]);
  }
  const payload = Buffer.from(bytes).toString('ascii');
  if (payload.length !== USER_CODE_LEN + DAY_CODE_LEN) return null;

  const code = payload.slice(0, USER_CODE_LEN);
  const day = payload.slice(USER_CODE_LEN);
  const hit = (opts.users || []).find((u) => userWatermarkCode(u.id, opts.secret) === code);
  if (!hit) return null;
  return { userId: hit.id, day };
}

/** 打水印时要看的字段名：客户微信号（订单 customFields / 客户档案）。 */
const ALWAYS_WATERMARK_KEYS = new Set(['customerWechat']);
/** 只在「客户」对象上打的字段名 —— 陪玩 / 客服自己的工作微信也叫 wechatId，那个不打。 */
const CUSTOMER_ONLY_KEYS = new Set(['wechatId']);

/**
 * 深度遍历一个接口响应体：给客户微信号打水印。
 * 「客户对象」的判定：这一层带 `customerCode`（Customer 表才有，WorkWechat 没有）。
 */
export function watermarkPayload(
  payload: any,
  opts: { userId: string; secret: string; at?: Date },
): any {
  const walk = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    if (node instanceof Date || Buffer.isBuffer(node)) return node;
    if (Array.isArray(node)) return node.map((v) => walk(v));
    const looksLikeCustomer = typeof node.customerCode === 'string';
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) {
      if (
        typeof v === 'string' &&
        v.length > 0 &&
        (ALWAYS_WATERMARK_KEYS.has(k) || (looksLikeCustomer && CUSTOMER_ONLY_KEYS.has(k)))
      ) {
        out[k] = encodeWatermark(v, opts);
      } else {
        out[k] = walk(v);
      }
    }
    return out;
  };
  return walk(payload);
}