import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { containsWatermark, dayWatermarkCodeToDate, decodeWatermark } from '../common/watermark';

export interface WatermarkDecodeResult {
  /** 有没有解出水印。 */
  matched: boolean;
  /** 解出来了：谁看的、哪天看的、怎么称呼。 */
  userId?: string;
  username?: string | null;
  displayName?: string | null;
  role?: string | null;
  studioName?: string | null;
  /** 水印里的「哪天」（北京时间 YYYY-MM-DD）。 */
  day?: string;
  /** 方便老板一眼看懂的一句话。 */
  summary?: string;
  /** 没解出来时的原因提示。 */
  reason?: string;
}

@Injectable()
export class WatermarkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 解码老板粘过来的文本。
   * 水印是 HMAC(密钥, userId) 的短码，不可反推 —— 只能拿系统里的账号逐个比对，
   * 所以这里把账号列表（几十条）拉出来遍历一次即可。
   */
  async decode(text: string): Promise<WatermarkDecodeResult> {
    const raw = String(text || '');
    if (!raw.trim()) return { matched: false, reason: '没收到内容，把可疑的微信号 / 聊天记录粘进来' };
    if (!containsWatermark(raw)) {
      return {
        matched: false,
        reason:
          '这段文本里没有水印字符。常见原因：① 是截图 / 手打的（水印是看不见的字符，只有「复制粘贴」才会带出来）；' +
          '② 对方把微信复制出来后又删改过。截图这种情况请看画面上的淡色水印。',
      };
    }

    const secret = process.env.JWT_SECRET || '';
    if (!secret) return { matched: false, reason: '服务端未配置密钥，无法解码' };

    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        studio: { select: { name: true } },
      },
    });
    const hit = decodeWatermark(raw, { users, secret });
    if (!hit) {
      return { matched: false, reason: '水印在，但没对上本系统的账号（可能是外部文本碰巧带零宽字符）' };
    }

    const u = users.find((x) => x.id === hit.userId);
    const day = dayWatermarkCodeToDate(hit.day) || hit.day;
    const who = u?.displayName || u?.username || hit.userId;
    const roleLabel =
      u?.role === 'OWNER' ? '老板' : u?.role === 'ADMIN' ? '店长' : u?.role === 'CS' ? '客服' : u?.role === 'COMPANION' ? '陪玩' : (u?.role || '');
    const studioName = u?.studio?.name || null;
    return {
      matched: true,
      userId: hit.userId,
      username: u?.username,
      displayName: u?.displayName,
      role: u?.role,
      studioName,
      day,
      summary: `${who}（${roleLabel}${studioName ? ' · ' + studioName : ''}）在 ${day} 看到的这段客户微信号`,
    };
  }
}