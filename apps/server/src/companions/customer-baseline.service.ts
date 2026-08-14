// craftsman-ignore: TS001
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 客户行为基线分析：
 * 基于客户近 30 天续单/复购历史（排除首单），检测本次 session 的异常：
 *  - 模式突变（平时绝密多，突然报机密）
 *  - 单价跌破历史区间
 *  - 时长异常
 */
@Injectable()
export class CustomerBaselineService {
  private readonly logger = new Logger('CustomerBaselineService');

  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
  ) {}

  /** 分析 session，返回标记：'red' | 'yellow' | null */
  async analyzeDetailed(sessionId: string): Promise<{ level: 'red' | 'yellow' | null; reason: string | null }> {
    const session = await this.prisma.orderSession.findUnique({
      where: { id: sessionId },
      include: {
        parentOrder: { select: { customerId: true, studioId: true } },
        companion: { include: { user: { select: { username: true, displayName: true } } } },
      },
    });
    if (!session || !session.parentOrder) return { level: null, reason: null };

    // 通用红标：DONE 但 0 截图由外部检查（需要文件系统）——这里只做基线分析
    const alerts: Array<{ type: string; level: 'red' | 'yellow' }> = [];

    // 只有续单/复购才做基线分析（首单价格固定，无需查）
    const customerId = session.parentOrder.customerId;
    const isRenew = await this.isRenewalOrder(customerId);

    if (isRenew && session.claimedMode && session.claimedPrice != null) {
      const baseline = await this.computeBaseline(customerId);

      // 1. 模式突变：本次模式历史占比 < 20% 且历史 ≥3 单
      if (baseline.orderCount >= 3) {
        const modeRatio = baseline.modeDistribution[session.claimedMode] || 0;
        if (modeRatio < 0.2) {
          alerts.push({
            type: `模式突变：该客户历史${session.claimedMode}占比仅${Math.round(modeRatio * 100)}%（平时${this.topModes(baseline.modeDistribution)}多）`,
            level: 'yellow',
          });
        }
      }

      // 2. 单价跌破历史区间
      if (baseline.priceMin != null && session.claimedPrice < baseline.priceMin * 0.9) {
        alerts.push({
          type: `单价跌破历史：本次${session.claimedPrice}元/小时，历史区间${baseline.priceMin}-${baseline.priceMax}元/小时`,
          level: 'red',
        });
      }

      // 3. 时长异常
      if (baseline.avgDuration > 0 && session.duration > baseline.avgDuration * 2) {
        alerts.push({
          type: `时长异常：本次${session.duration}小时，历史平均${baseline.avgDuration}小时`,
          level: 'yellow',
        });
      }
    }

    // 黑屏率检查（黑屏截图由 upload 时记录在文件名后缀，这里由 controller 统计后更新）
    if (alerts.length === 0) return { level: null, reason: null };

    const level = alerts.some((a) => a.level === 'red') ? 'red' : 'yellow';
    const reason = alerts.map((a) => a.type).join('；');

    // 写入标记
    await this.prisma.orderSession.update({
      where: { id: sessionId },
      data: { flagged: level },
    });

    // WS 推送管理端
    const companionName =
      session.companion?.user?.displayName || session.companion?.user?.username || '未知';
    this.wsGateway.broadcastToStudio(session.parentOrder.studioId, 'review:alert', {
      sessionId,
      companionName,
      reason,
      level,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Session ${sessionId} flagged ${level}: ${reason}`);
    return { level, reason };
  }

  /** 兼容旧调用：只返回标记级别。 */
  async analyze(sessionId: string): Promise<'red' | 'yellow' | null> {
    return (await this.analyzeDetailed(sessionId)).level;
  }

  /** 判断该客户此单是否为续单/复购（历史上已有 DONE 订单） */
  private async isRenewalOrder(customerId: string): Promise<boolean> {
    const count = await this.prisma.order.count({
      where: { customerId, status: 'DONE' },
    });
    return count > 0;
  }

  /** 计算客户近 30 天续单基线 */
  private async computeBaseline(customerId: string) {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { customerId, status: 'DONE', createdAt: { gte: since } },
      select: { customFields: true, amount: true, duration: true },
    });

    const modeDistribution: Record<string, number> = {};
    const prices: number[] = [];
    let totalDuration = 0;

    for (const o of orders) {
      const cf = (o.customFields as any) || {};
      const mode = cf.gameMode || cf.firstOrder?.gameMode || '未知';
      modeDistribution[mode] = (modeDistribution[mode] || 0) + 1;

      // 单价：customFields.firstOrder.price 或 amount/duration
      const dur = o.duration || 0;
      const price = cf.firstOrder?.price ?? (dur > 0 ? o.amount / dur : null);
      if (price) prices.push(price);
      totalDuration += dur;
    }

    return {
      orderCount: orders.length,
      modeDistribution,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      avgDuration: orders.length ? Math.round((totalDuration / orders.length) * 10) / 10 : 0,
    };
  }

  private topModes(dist: Record<string, number>): string {
    return Object.entries(dist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([m]) => m)
      .join('/');
  }
}
