// craftsman-ignore: TS001
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
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

  /** 延迟加载 sharp，避免该可选依赖缺失时阻断服务端启动。 */
  private loadSharp(): any {
    try {
      return require('sharp');
    } catch {
      this.logger.warn('sharp 未安装，长图合成功能不可用');
      return null;
    }
  }

  /** 口供信息表 → SVG 渲染成图 */
  private async renderClaimCard(session: any, companionName: string, customerCode: string): Promise<Buffer> {
    const sharp = this.loadSharp();
    if (!sharp) throw new Error('sharp not available');
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

  /** 财务核对卡：审核金额 / 实际转账 / 审核状态 */
  private async renderFinanceCard(parentOrder: any): Promise<Buffer> {
    const sharp = this.loadSharp();
    if (!sharp) throw new Error('sharp not available');
    const auditCents = parentOrder?.auditAmountCents;
    const transferCents = parentOrder?.transferTotalCents;
    const auditStatus = parentOrder?.auditStatus;
    const auditText = auditCents != null ? `¥${(auditCents / 100).toFixed(2)}` : '—';
    const transferText = transferCents != null ? `¥${(transferCents / 100).toFixed(2)}` : '—';
    let statusText = '待核对';
    let color = '#fbbf24';
    if (auditStatus === 'OK') { statusText = '✅ 转账金额 >= 审核金额'; color = '#22c55e'; }
    else if (auditStatus === 'FLAGGED') { statusText = '⚠ 转账金额低于审核金额'; color = '#ef4444'; }
    else if (auditStatus === 'PENDING') { statusText = '⏳ 待核对（未填写转账合计）'; color = '#fbbf24'; }
    const svg = `
    <svg width="1280" height="220" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <rect x="0" y="0" width="1280" height="6" fill="${color}"/>
      <text x="40" y="55" font-size="30" fill="#00D4FF" font-weight="bold">财务核对</text>
      <text x="40" y="110" font-size="26" fill="#e2e8f0">审核金额（填写时长 x 单价）：${auditText}</text>
      <text x="40" y="155" font-size="26" fill="#e2e8f0">客户实际转账合计：${transferText}</text>
      <text x="40" y="200" font-size="26" fill="${color}" font-weight="bold">状态：${statusText}</text>
    </svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  }

  /** AI 异常分析卡（放在长图最后一张） */
  private async renderAnalysisCard(reason: string | null, level?: string | null): Promise<Buffer> {
    const sharp = this.loadSharp();
    if (!sharp) throw new Error('sharp not available');
    const color = level === 'red' ? '#ef4444' : level === 'yellow' ? '#fbbf24' : '#22c55e';
    const lines = (reason || '暂无异常').split('；').filter(Boolean);
    const lineSvg = lines
      .map((line, i) => `<text x="40" y="${120 + i * 42}" font-size="24" fill="#e2e8f0">• ${line}</text>`)
      .join('');
    const height = Math.max(220, 120 + lines.length * 42 + 30);
    const svg = `
    <svg width="1280" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <rect x="0" y="0" width="1280" height="6" fill="${color}"/>
      <text x="40" y="55" font-size="30" fill="${color}" font-weight="bold">AI 异常分析</text>
      ${lineSvg}
    </svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  }

  /** 每张小图顶部加标签条（黑底白字） */
  private async addLabel(input: Buffer, label: string): Promise<Buffer> {
    const sharp = this.loadSharp();
    if (!sharp) throw new Error('sharp not available');
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
  async buildComposite(sessionId: string, flaggedReason?: string | null, flaggedLevel?: string | null): Promise<string | null> {
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

      if (session.parentOrder?.auditStatus || session.parentOrder?.auditAmountCents != null) {
        parts.push(await this.renderFinanceCard(session.parentOrder));
      }

      if (flaggedReason) {
        parts.push(await this.renderAnalysisCard(flaggedReason, flaggedLevel));
      }

      if (parts.length <= 1) return null; // 只有口供表，没有截图

      // 纵向拼接
      const sharp = this.loadSharp();
      if (!sharp) throw new Error('sharp not available');
      const metas = await Promise.all(parts.map((p) => sharp(p).metadata()));
      const width = 1280;
      const height = metas.reduce((s: number, m: any) => s + (m.height || 0), 0);

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

  /** 统计黑屏截图数量（文件名带 _black 后缀） */
  countBlackShots(sessionId: string): number {
    const dir = path.join(UPLOAD_DIR, sessionId);
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_black\.jpg$/.test(f)).length;
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
