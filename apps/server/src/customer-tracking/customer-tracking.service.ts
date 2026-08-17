// craftsman-ignore: TS001,TS002,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessDayOf } from '../common/business-day';
import { UserRole } from '@chunlv/shared';

interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  studioId: string | null;
  companionId?: string;
}

const CONTACT_RESULTS = ['NOW', 'RESCHEDULE', 'REJECT', 'NO_REPLY', 'DELETED', 'DONGGU', 'REFUND'];
const TRACK_TYPES = ['TEXT', 'IMAGE', 'TEXT_IMAGE'];

@Injectable()
export class CustomerTrackingService {
  constructor(private prisma: PrismaService) {}

  async registerContact(user: AuthUser, dto: any) {
    const companionId = user.companionId ?? dto.companionId;
    if (!companionId) throw new ForbiddenException('缺少陪玩标识');
    if (!CONTACT_RESULTS.includes(dto.result)) throw new ForbiddenException('无效联系结果');

    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('客户不存在');

    return this.prisma.customerContact.create({
      data: {
        studioId: customer.studioId,
        companionId,
        customerId: dto.customerId,
        orderId: dto.orderId ?? null,
        result: dto.result,
        evidenceUrl: dto.evidenceUrl ?? null,
        note: dto.note ?? null,
      },
    });
  }

  async getStatus(user: AuthUser) {
    const companionId = user.companionId;
    if (!companionId) throw new ForbiddenException('仅陪玩可查看抢单状态');

    const keys = [
      'pool.unlock_revenue_enabled',
      'pool.unlock_revenue_threshold',
      'pool.daily_customer_quota_enabled',
      'pool.daily_customer_quota',
      'pool.success_rate_gate_enabled',
      'pool.success_rate_gate_threshold',
    ];
    const records = await this.prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const cfg: Record<string, any> = {};
    for (const r of records) cfg[r.key] = r.value;

    const bool = (k: string, def: boolean) => (cfg[k] === undefined ? def : cfg[k] === true || cfg[k] === 'true');
    const num = (k: string, def: number) => {
      const v = cfg[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : def;
    };

    const day = businessDayOf(new Date());
    const next = new Date(day);
    next.setDate(next.getDate() + 1);

    const todayValid = await this.prisma.customerContact.count({
      where: { companionId, result: 'NOW', createdAt: { gte: day, lt: next } },
    });

    const revenueAgg = await this.prisma.transaction.aggregate({
      where: { companionId, status: 'APPROVED', createdAt: { gte: day, lt: next } },
      _sum: { amount: true },
    });
    const todayRevenue = revenueAgg._sum.amount || 0;

    const success = await this.computeSuccess(companionId);

    const revenueEnabled = bool('pool.unlock_revenue_enabled', true);
    const quotaEnabled = bool('pool.daily_customer_quota_enabled', true);
    const successEnabled = bool('pool.success_rate_gate_enabled', true);
    const revenueThreshold = num('pool.unlock_revenue_threshold', 200);
    const quota = num('pool.daily_customer_quota', 3);
    const successThreshold = num('pool.success_rate_gate_threshold', 90);

    const reasons: string[] = [];
    if (revenueEnabled && todayRevenue < revenueThreshold) {
      reasons.push(`今日流水未达到 ¥${revenueThreshold}`);
    }
    if (quotaEnabled && todayValid >= quota) {
      reasons.push(`今日有效客户名额已用完（${todayValid}/${quota}）`);
    }
    if (successEnabled && success.sum < successThreshold) {
      reasons.push(`综合成功率 ${success.sum}% 低于 ${successThreshold}%`);
    }

    return {
      config: {
        revenueEnabled,
        revenueThreshold,
        quotaEnabled,
        quota,
        successEnabled,
        successThreshold,
      },
      todayRevenue,
      todayValidCustomers: todayValid,
      success,
      allowed: reasons.length === 0,
      reasons,
    };
  }

  async computeSuccess(companionId: string) {
    const orders = await this.prisma.order.findMany({
      where: { companionId, status: { not: 'CANCELLED' } },
      select: { type: true, status: true },
    });
    const total = orders.length;
    const renew = orders.filter((o) => o.type === 'RENEW').length;
    const repurchase = orders.filter((o) => o.type === 'REPURCHASE').length;
    const newOrders = orders.filter((o) => o.type === 'NEW');
    const newDone = newOrders.filter((o) => o.status === 'DONE').length;
    const renewRate = total > 0 ? Math.round((renew / total) * 100) : 0;
    const repurchaseRate = total > 0 ? Math.round((repurchase / total) * 100) : 0;
    const firstSuccessRate = newOrders.length > 0 ? Math.round((newDone / newOrders.length) * 100) : 0;
    return { renewRate, repurchaseRate, firstSuccessRate, sum: renewRate + repurchaseRate + firstSuccessRate };
  }

  async addTrack(user: AuthUser, dto: any) {
    const companionId = user.companionId ?? dto.companionId;
    if (!companionId) throw new ForbiddenException('缺少陪玩标识');
    if (!TRACK_TYPES.includes(dto.type)) throw new ForbiddenException('无效追踪类型');

    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('客户不存在');

    return this.prisma.customerTrack.create({
      data: {
        studioId: customer.studioId,
        companionId,
        customerId: dto.customerId,
        type: dto.type,
        content: dto.content ?? null,
        images: dto.images ?? [],
      },
    });
  }

  async listTracks(user: AuthUser, customerId?: string) {
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (user.companionId) {
      where.companionId = user.companionId;
    } else if (user.studioId) {
      where.studioId = user.studioId;
    }
    return this.prisma.customerTrack.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        companion: { include: { user: { select: { username: true, displayName: true } } } },
        customer: { select: { id: true, wechatId: true } },
      },
    });
  }

  async listReminders(user: AuthUser) {
    const where: any = { isDeletedByCustomer: false, totalSpent: { lte: 0 } };
    if (user.companionId) {
      where.companionId = user.companionId;
    } else if (user.studioId) {
      where.studioId = user.studioId;
    }
    return this.prisma.customer.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        companion: { include: { user: { select: { username: true, displayName: true } } } },
        contacts: { orderBy: { createdAt: 'desc' }, take: 1 },
        tracks: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  async submitDeleteRequest(user: AuthUser, dto: any) {
    const companionId = user.companionId ?? dto.companionId;
    if (!companionId) throw new ForbiddenException('缺少陪玩标识');
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('客户不存在');

    const existing = await this.prisma.customerDeleteRequest.findFirst({
      where: { companionId, customerId: dto.customerId, status: 'PENDING' },
    });
    if (existing) return existing;

      return this.prisma.customerDeleteRequest.create({
        data: {
          studioId: customer.studioId,
          companionId,
          customerId: dto.customerId,
          reason: dto.reason ?? null,
          evidenceUrl: dto.evidenceUrl ?? null,
        },
      });
  }

  async listDeleteRequests(user: AuthUser, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (user.companionId) {
      where.companionId = user.companionId;
    } else if (user.studioId) {
      where.studioId = user.studioId;
    }
    return this.prisma.customerDeleteRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        companion: { include: { user: { select: { username: true, displayName: true } } } },
        customer: { select: { id: true, wechatId: true } },
        reviewer: { select: { username: true, displayName: true } },
      },
    });
  }

  async reviewDeleteRequest(user: AuthUser, id: string, approve: boolean, rejectReason?: string) {
    const request = await this.prisma.customerDeleteRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('删除申请不存在');

    const updated = await this.prisma.customerDeleteRequest.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewedById: user.id,
        reviewedAt: new Date(),
        rejectReason: approve ? null : rejectReason ?? null,
      },
    });

    if (approve) {
      await this.prisma.customer.update({
        where: { id: request.customerId },
        data: { isDeletedByCustomer: true },
      });
    }
    return updated;
  }

  async getKpi(user: AuthUser) {
    const studioWhere: any = user.studioId ? { studioId: user.studioId } : {};
    const [totalCustomers, consumedCustomers, retainedCustomers, trackedRecent, noReply, deletePending, notConsumed, trackedTimelyCustomers] =
      await Promise.all([
        this.prisma.customer.count({ where: studioWhere }),
        this.prisma.customer.count({ where: { ...studioWhere, totalSpent: { gt: 0 } } }),
        this.prisma.customer.count({ where: { ...studioWhere, isDeletedByCustomer: false } }),
        this.prisma.customerTrack.count({
          where: { ...studioWhere, createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
        }),
        this.prisma.customerContact.count({ where: { ...studioWhere, result: 'NO_REPLY' } }),
        this.prisma.customerDeleteRequest.count({ where: { ...studioWhere, status: 'PENDING' } }),
        this.prisma.customer.count({ where: { ...studioWhere, totalSpent: { lte: 0 }, isDeletedByCustomer: false } }),
        this.prisma.customerTrack.findMany({
          where: { ...studioWhere, createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
          distinct: ['customerId'],
          select: { customerId: true },
        }),
      ]);

    return {
      totalCustomers,
      consumedCustomers,
      retainedCustomers,
      retentionRate: totalCustomers > 0 ? Math.round((retainedCustomers / totalCustomers) * 100) : 0,
      conversionRate: totalCustomers > 0 ? Math.round((consumedCustomers / totalCustomers) * 100) : 0,
      trackedRecentCount: trackedRecent,
      trackingTimelyRate: notConsumed > 0 ? Math.round((trackedTimelyCustomers.length / notConsumed) * 100) : 0,
      responseRiskCount: noReply + deletePending,
    };
  }

  async listAnomalies(user: AuthUser) {
    const studioWhere: any = user.studioId ? { studioId: user.studioId } : {};
    const keys = ['anomaly.spend_drop_percent', 'anomaly.revenue_drop_percent', 'anomaly.hours_drop_percent'];
    const records = await this.prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const cfg: Record<string, any> = {};
    for (const r of records) cfg[r.key] = r.value;
    const pct = typeof cfg['anomaly.spend_drop_percent'] === 'number' ? cfg['anomaly.spend_drop_percent'] : 50;

    const customers = await this.prisma.customer.findMany({
      where: studioWhere,
      include: {
        companion: { include: { user: { select: { username: true, displayName: true } } } },
        orders: { select: { createdAt: true, amount: true } },
      },
    });

    const now = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;
    const out: any[] = [];

    for (const c of customers) {
      const recent = c.orders.filter((o) => now - new Date(o.createdAt).getTime() <= week);
      const prev = c.orders.filter((o) => {
        const t = new Date(o.createdAt).getTime();
        return now - t > week && now - t <= 5 * week;
      });
      const recentSpend = recent.reduce((s, o) => s + (o.amount || 0), 0);
      const prevAvg = prev.length > 0 ? prev.reduce((s, o) => s + (o.amount || 0), 0) / prev.length : 0;
      if (prevAvg > 0 && recentSpend < prevAvg * (1 - pct / 100)) {
        out.push({
          customerId: c.id,
          wechatId: c.wechatId,
          companion: c.companion,
          recentSpend,
          baselineWeekly: prevAvg,
          dropPercent: Math.round((1 - recentSpend / prevAvg) * 100),
        });
      }
    }

    return out.sort((a, b) => b.dropPercent - a.dropPercent);
  }
}
