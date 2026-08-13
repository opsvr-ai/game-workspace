// craftsman-ignore: TS001
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

const UPLOAD_DIR = path.join(process.cwd(), '..', '..', 'uploads', 'session-shots');
const LABEL_H = 36; // 每张图顶部标签条高度

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

@Injectable()
export class CompositeService {
  private readonly logger = new Logger('CompositeService');

  constructor(private prisma: PrismaService) {}

  /** 口供信息表 → SVG 渲染成图 */
  private async renderClaimCard(session: any, companionName: string, customerCode: string): Promise<Buffer> {
    const svg = `
    <svg width="1280" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#0F172A"/>
      <text x="40" y="55" font-size="30" fill="#00D4FF" font-weight="bold">服务信息表（陪玩填写）</text>
      <text x="40" y="110" font-size="24" fill="#e2e8f0">陪玩：${companionName}</text>
      <text x="40" y="150" font-size="24" fill="#e2e8f0">客户：${customerCode}</text>
      <text x="700" y="110" font-size="24" fill="#fbbf24">模式：${session.claimedMode || '—'}</text>
      <text x="700" y="150" font-size="24" fill="#fbbf24">单价：${session.claimedPrice != null ? session.claimedPrice + ' 元/小时' : '—'}</text>
      <text x="1000" y="150" font-size="24" fill="#e2e8f0">时长：${session.duration} 小时</text>
    </svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  }

  /** 每张小图顶部加标签条（黑底白字） */
  private async addLabel(input: Buffer, label: string): Promise<Buffer> {
    const meta = await sharp(input).metadata();
    const width = meta.width || 1280;
    const labelSvg = `
    <svg width="${width}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#000000"/>
      <text x="12" y="25" font-size="20" fill="#ffffff" font-weight="bold">${label}</text>
    </svg>`;
    const labelBuf = await sharp(Buffer.from(labelSvg)).png().toBuffer();
    const resized = await sharp(input).resize({ width }).jpeg({ quality: 70 }).toBuffer();
    return sharp({ create: { width, height: (meta.height || 0) + LABEL_H, channels: 3, background: '#000' } })
      .composite([
        { input: labelBuf, top: 0, left: 0 },
        { input: resized, top: LABEL_H, left: 0 },
      ])
      .jpeg({ quality: 70 })
      .toBuffer();
  }

  /**
   * 合并长图：①口供信息表 ②转账截图 ③-⑥ 游戏截图（每张左上角实际截图时间）
   * 文件名格式 {YYYY-MM-DD_HH-mm-ss}.jpg，文件名即实际截屏时间
   */
  async buildComposite(sessionId: string): Promise<string | null> {
    try {
      const session = await this.prisma.orderSession.findUnique({
        where: { id: sessionId },
        include: {
          companion: { include: { user: { select: { username: true, displayName: true } } } },
          parentOrder: { include: { customer: true } },
        },
      });
      if (!session) return null;

      const dir = path.join(UPLOAD_DIR, sessionId);
      if (!fs.existsSync(dir)) return null;

      const parts: Buffer[] = [];

      // ① 口供信息表
      const companionName =
        session.companion?.user?.displayName || session.companion?.user?.username || '未知';
      const customerCode = session.parentOrder?.customer?.customerCode || '未知';
      parts.push(await this.renderClaimCard(session, companionName, customerCode));

      // ② 转账截图
      if (session.transferScreenshotUrl) {
        const transferPath = session.transferScreenshotUrl.replace('/uploads/', '');
        const absTransfer = path.join(process.cwd(), '..', '..', 'uploads', transferPath);
        if (fs.existsSync(absTransfer)) {
          parts.push(await this.addLabel(fs.readFileSync(absTransfer), '转账截图'));
        }
      }

      // ③+ 游戏截图（文件名即实际时间；_black 为黑屏标记；不限制张数）
      const shots = fs
        .readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_black)?\.jpg$/.test(f))
        .sort();

      for (const f of shots) {
        const base = f.replace(/_black\.jpg$/, '').replace(/\.jpg$/, '');
        const timeLabel = base.replace('_', ' ') + (f.includes('_black') ? ' ⚠黑屏' : '');
        const buf = fs.readFileSync(path.join(dir, f));
        parts.push(await this.addLabel(buf, timeLabel));
      }

      if (parts.length <= 1) return null; // 只有口供表，没有截图

      // 纵向拼接
      const metas = await Promise.all(parts.map((p) => sharp(p).metadata()));
      const width = 1280;
      const height = metas.reduce((s, m) => s + (m.height || 0), 0);

      let composite = sharp({ create: { width, height, channels: 3, background: '#000' } });
      const layers: any[] = [];
      let y = 0;
      for (const p of parts) {
        const m = await sharp(p).metadata();
        layers.push({ input: p, top: y, left: 0 });
        y += m.height || 0;
      }
      const outBuf = await composite.composite(layers).jpeg({ quality: 75 }).toBuffer();

      const outName = `composite.jpg`;
      fs.writeFileSync(path.join(dir, outName), outBuf);
      return `/uploads/session-shots/${sessionId}/${outName}`;
    } catch (err: any) {
      this.logger.warn(`buildComposite failed: ${err.message}`);
      return null;
    }
  }

  /** 会话目录下游戏截图数量（非黑屏检测由客户端上报标记，这里只统计文件数） */
  countShots(sessionId: string): number {
    const dir = path.join(UPLOAD_DIR, sessionId);
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_black)?\.jpg$/.test(f)).length;
  }

  /** 惰性清理 30 天前的会话目录 */
  cleanupOldDirs(): void {
    try {
      ensureDir(UPLOAD_DIR);
      const now = Date.now();
      for (const d of fs.readdirSync(UPLOAD_DIR)) {
        const p = path.join(UPLOAD_DIR, d);
        const st = fs.statSync(p);
        if (st.isDirectory() && now - st.mtimeMs > 30 * 24 * 3600 * 1000) {
          fs.rmSync(p, { recursive: true, force: true });
        }
      }
    } catch { /* ignore */ }
  }
}
