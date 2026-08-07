// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DailyStatsItem {
  csUserId: string;
  csName: string;
  csDisplayName?: string | null;
  studioId: string;
  studioName: string;
  studioType: string;
  totalOrders: number;
  totalAmount: number;
  directCount: number;
  directAmount: number;
  bridgeCount: number;
  bridgeAmount: number;
  clubCount: number;
  clubAmount: number;
  unassignedCount: number;
  unassignedAmount: number;
  feePaidCount: number;
  feeUnpaidCount: number;
  wechatCount: number;
  wechatAmount: number;
  alipayCount: number;
  alipayAmount: number;
  studioBreakdown: { studioName: string; studioType: string; isOwn: boolean; count: number; amount: number }[];
}

export interface DailyStatsResponse {
  dateFrom: string;
  dateTo: string;
  summary: {
    totalOrders: number;
    totalAmount: number;
    directCount: number;
    directAmount: number;
    bridgeCount: number;
    bridgeAmount: number;
    clubCount: number;
    clubAmount: number;
    unassignedCount: number;
    unassignedAmount: number;
    feePaidCount: number;
    feeUnpaidCount: number;
    wechatCount: number;
    wechatAmount: number;
    alipayCount: number;
    alipayAmount: number;
  };
  csList: DailyStatsItem[];
  orders: any[];
}

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getDailyStats(
    filters: {
      date?: string;
      dateFrom?: string;
      dateTo?: string;
      csUserId?: string;
      studioId?: string;
      status?: string;
      gameName?: string;
      feeStatus?: string;
    },
    user?: any,
  ): Promise<DailyStatsResponse> {
    // Date range
    let startOfDay: Date;
    let endOfDay: Date;

    if (filters.dateFrom && filters.dateTo) {
      startOfDay = new Date(filters.dateFrom);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(filters.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
    } else if (filters.date) {
      startOfDay = new Date(filters.date);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);
    } else {
      startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);
    }

    // Build where clause
    const where: any = {
      createdAt: { gte: startOfDay, lt: endOfDay },
    };

    if (user) {
      if (user.role === 'CS') {
        where.csUserId = user.id;
      } else if (user.role === 'COMPANION') {
        where.companionId = user.companionId;
      } else if (user.role === 'ADMIN') {
        where.studioId = user.studioId;
      }
    }

    // Apply filters (override role-based if owner/admin explicitly filters)
    if (filters.csUserId && user?.role !== 'CS') where.csUserId = filters.csUserId;
    if (filters.studioId && (user?.role === 'OWNER')) where.studioId = filters.studioId;
    if (filters.status) where.status = filters.status;
    if (filters.gameName) where.gameName = { contains: filters.gameName };
    if (filters.feeStatus) where.companionFeeStatus = filters.feeStatus;

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        csUser: { select: { id: true, username: true, displayName: true } },
        companion: {
          include: {
            studio: { select: { id: true, name: true, type: true } },
            user: { select: { username: true, displayName: true } },
          },
        },
        studio: { select: { id: true, name: true, type: true } },
        paymentAccount: { select: { id: true, accountName: true, accountNumber: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by CS user
    const csMap = new Map<string, DailyStatsItem>();

    for (const order of orders) {
      const csId = order.csUserId;
      if (!csMap.has(csId)) {
        csMap.set(csId, {
          csUserId: csId,
          csName: order.csUser?.username || '未知',
          csDisplayName: order.csUser?.displayName,
          studioId: order.studioId,
          studioName: (order.studio as any)?.name || '',
          studioType: (order.studio as any)?.type || '',
          totalOrders: 0,
          totalAmount: 0,
          directCount: 0,
          directAmount: 0,
          bridgeCount: 0,
          bridgeAmount: 0,
          clubCount: 0,
          clubAmount: 0,
          unassignedCount: 0,
          unassignedAmount: 0,
          feePaidCount: 0,
          feeUnpaidCount: 0,
          wechatCount: 0,
          wechatAmount: 0,
          alipayCount: 0,
          alipayAmount: 0,
          studioBreakdown: [],
        });
      }

      const item = csMap.get(csId)!;
      item.totalOrders++;
      item.totalAmount += order.amount;

      if (!order.companionId) {
        item.unassignedCount++;
        item.unassignedAmount += order.amount;
      } else {
        const compStudio = (order.companion as any)?.studio;
        const compStudioName = compStudio?.name || '未知';
        const compStudioType = compStudio?.type || '';
        const compStudioId = compStudio?.id || '';

        // Legacy counts
        if (compStudioId === order.studioId) {
          item.directCount++;
          item.directAmount += order.amount;
        } else if (compStudioType === 'RENTAL') {
          item.clubCount++;
          item.clubAmount += order.amount;
        } else {
          item.bridgeCount++;
          item.bridgeAmount += order.amount;
        }

        // Per-studio breakdown
        const key = compStudioName;
        const existing = item.studioBreakdown.find(b => b.studioName === key);
        if (existing) {
          existing.count++;
          existing.amount += order.amount;
        } else {
          item.studioBreakdown.push({
            studioName: compStudioName,
            studioType: compStudioType,
            isOwn: compStudioId === order.studioId,
            count: 1,
            amount: order.amount,
          });
        }
      }

      if (order.companionFeeStatus === 'PAID') {
        item.feePaidCount++;
      } else {
        item.feeUnpaidCount++;
      }
      if (order.companionFeeMethod === 'WECHAT') {
        item.wechatCount++;
        item.wechatAmount += Math.round((order.companionFeeAmount || 0) * 100) / 100;
      } else if (order.companionFeeMethod === 'ALIPAY') {
        item.alipayCount++;
        item.alipayAmount += Math.round((order.companionFeeAmount || 0) * 100) / 100;
      }
    }

    const csList = Array.from(csMap.values());

    const summary = {
      totalOrders: 0,
      totalAmount: 0,
      directCount: 0, directAmount: 0,
      bridgeCount: 0, bridgeAmount: 0,
      clubCount: 0, clubAmount: 0,
      unassignedCount: 0, unassignedAmount: 0,
      feePaidCount: 0, feeUnpaidCount: 0,
      wechatCount: 0, wechatAmount: 0,
      alipayCount: 0, alipayAmount: 0,
    };

    for (const item of csList) {
      summary.totalOrders += item.totalOrders;
      summary.totalAmount += item.totalAmount;
      summary.directCount += item.directCount;
      summary.directAmount += item.directAmount;
      summary.bridgeCount += item.bridgeCount;
      summary.bridgeAmount += item.bridgeAmount;
      summary.clubCount += item.clubCount;
      summary.clubAmount += item.clubAmount;
      summary.unassignedCount += item.unassignedCount;
      summary.unassignedAmount += item.unassignedAmount;
      summary.feePaidCount += item.feePaidCount;
      summary.feeUnpaidCount += item.feeUnpaidCount;
      summary.wechatCount += item.wechatCount;
      summary.wechatAmount += item.wechatAmount;
      summary.alipayCount += item.alipayCount;
      summary.alipayAmount += item.alipayAmount;
    }

    return {
      dateFrom: startOfDay.toISOString().slice(0, 10),
      dateTo: new Date(endOfDay.getTime() - 1).toISOString().slice(0, 10),
      summary,
      csList,
      orders: orders.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        type: o.type,
        gameName: o.gameName,
        amount: o.amount,
        status: o.status,
        dispatchType: o.dispatchType,
        createdAt: o.createdAt,
        csUserId: o.csUserId,
        csName: o.csUser?.username,
        companionId: o.companionId,
        companionName: (o.companion as any)?.user?.username || null,
        companionStudio: (o.companion as any)?.studio?.name || null,
        companionStudioType: (o.companion as any)?.studio?.type || null,
        paymentAccount: o.paymentAccount
          ? `${o.paymentAccount.accountName}(${o.paymentAccount.type === 'WECHAT' ? '微信' : '支付宝'})`
          : null,
        companionFeeStatus: o.companionFeeStatus,
        companionFeeMethod: o.companionFeeMethod,
        companionFeeAccount: o.companionFeeAccount,
        companionFeeAmount: o.companionFeeAmount,
      })),
    };
  }
}
