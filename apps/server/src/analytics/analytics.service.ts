import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async customerAnalytics(studioId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { studioId },
      include: {
        profile: true,
        companion: { include: { user: { select: { username: true } } } },
        orders: { where: { status: 'DONE' } },
      },
    });

    return customers
      .map((c) => {
        const orders = c.orders || [];
        const total = c.totalSpent || 0;
        const gameCounts: Record<string, number> = {};
        const modeCounts: Record<string, number> = {};
        let durationSum = 0;
        let lastOrderAt: Date | null = null;
        for (const o of orders) {
          gameCounts[o.gameName] = (gameCounts[o.gameName] || 0) + 1;
          const mode = (o.customFields as any)?.gameMode || (o.customFields as any)?.serviceType || '未知';
          modeCounts[mode] = (modeCounts[mode] || 0) + 1;
          durationSum += o.duration || 1;
          if (!lastOrderAt || o.createdAt > lastOrderAt) lastOrderAt = o.createdAt;
        }
        const topGame = Object.entries(gameCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
        const topMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
        const avgDuration = orders.length ? durationSum / orders.length : 0;
        const daysSince = lastOrderAt ? Math.floor((Date.now() - lastOrderAt.getTime()) / 86400000) : 999;
        const activity = daysSince <= 3 ? '高活跃' : daysSince <= 7 ? '近期活跃' : daysSince <= 30 ? '待跟进' : '流失风险';
        const quality = total >= 500 ? '优质' : total >= 200 ? '潜力' : '普通';
        const tags = [quality, activity, topGame, topMode];
        if (c.profile?.likesTalkative) tags.push('喜欢话多');
        if (c.profile?.likesSkill) tags.push('重视技术');
        return {
          id: c.id,
          wechatId: c.wechatId,
          companionName: c.companion?.user?.username || '未分配',
          totalSpent: total,
          orderCount: orders.length,
          avgDuration: Number(avgDuration.toFixed(1)),
          topGame,
          topMode,
          preferredTime: c.profile?.preferredTime || '-',
          lastOrderAt,
          tags,
        };
      })
      .sort((a, b) => b.totalSpent - a.totalSpent);
  }

  async companionAnalytics(studioId: string) {
    const companions = await this.prisma.companion.findMany({
      where: { studioId },
      include: {
        user: { select: { username: true } },
        orders: { where: { status: 'DONE' } },
        workWechats: true,
      },
    });

    return companions
      .map((comp) => {
        const orders = comp.orders || [];
        const total = orders.reduce((s, o) => s + o.amount, 0);
        const typeCounts: Record<string, number> = {};
        const gameCounts: Record<string, number> = {};
        let durationSum = 0;
        for (const o of orders) {
          typeCounts[o.type] = (typeCounts[o.type] || 0) + 1;
          gameCounts[o.gameName] = (gameCounts[o.gameName] || 0) + 1;
          durationSum += o.duration || 1;
        }
        const totalCount = orders.length || 1;
        const renewRate = Math.round(((typeCounts.RENEW || 0) / totalCount) * 100);
        const repurchaseRate = Math.round(((typeCounts.REPURCHASE || 0) / totalCount) * 100);
        const topGame = Object.entries(gameCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
        const tags: string[] = [];
        if (renewRate >= 30) tags.push('续单强');
        if (repurchaseRate >= 30) tags.push('复购强');
        if (total >= 500) tags.push('高流水');
        if (orders.length >= 10) tags.push('努力型');
        return {
          id: comp.id,
          name: comp.user?.username || comp.id,
          totalRevenue: total,
          orderCount: orders.length,
          avgDuration: orders.length ? Number((durationSum / orders.length).toFixed(1)) : 0,
          renewRate,
          repurchaseRate,
          topGame,
          workWechatCount: comp.workWechats?.length || 0,
          tags,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }
}
