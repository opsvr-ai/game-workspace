// craftsman-ignore: TS001
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { settlementMonthRange } from '../common/business-day';
import { companionOrderRevenue } from '../common/order-revenue';
import { effectiveTenureMonths, computeSharePct } from '../common/revenue-calculator';
import type { RevenueSplitTier } from '../common/revenue-calculator';
import { resolveConfigs } from '../common/studio-config';
import {
  bridgeDirection,
  groupByPeer,
  roundYuan,
  summarizeBridge,
  type BridgeRowRole,
  type BridgeSettlementRow,
} from './bridge-settlement.util';

const ALL_FUNCTIONS = ['ORDERS', 'POOL', 'CUSTOMERS', 'BILLING', 'KPI'];
const CACHE_TTL = 5000; // 5 seconds

@Injectable()
export class BridgeService {
  constructor(private prisma: PrismaService) {}

  // In-memory caches to avoid repeated DB queries on every pool/broadcast call
  private bridgedCache = new Map<string, { ids: string[]; ts: number }>();
  private visibleCache = new Map<string, { ids: string[]; ts: number }>();

  private cacheGet(map: Map<string, { ids: string[]; ts: number }>, key: string): string[] | null {
    const entry = map.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.ids;
    map.delete(key);
    return null;
  }

  private cacheSet(map: Map<string, { ids: string[]; ts: number }>, key: string, ids: string[]) {
    map.set(key, { ids, ts: Date.now() });
  }

  private invalidateCache(studioAId: string, studioBId: string) {
    this.bridgedCache.delete(studioAId);
    this.bridgedCache.delete(studioBId);
    // Also clear all function-specific visible cache entries
    for (const key of this.visibleCache.keys()) {
      if (key.startsWith(studioAId + ':') || key.startsWith(studioBId + ':')) {
        this.visibleCache.delete(key);
      }
    }
    this.visibleCache.delete(studioAId);
    this.visibleCache.delete(studioBId);
  }

  /** Owner proposes a bridge between two studios. Proposer's side is auto-accepted. */
  async propose(studioAId: string, studioBId: string, ownerId: string) {
    if (studioAId === studioBId) throw new ForbiddenException('不能跟自己桥接');
    const [a, b] = [studioAId, studioBId].sort();
    const proposerIsA = a === studioAId;
    const existing = await this.prisma.studioBridge.findUnique({
      where: { studioAId_studioBId: { studioAId: a, studioBId: b } },
    });
    if (existing) {
      if (existing.status === 'ACTIVE') throw new ForbiddenException('已打通');
      // Re-propose: reset to PENDING and reset permissions
      await this.prisma.studioBridge.update({
        where: { id: existing.id },
        data: { status: 'PENDING', proposedBy: ownerId },
      });
      await this.prisma.studioBridgePermission.updateMany({
        where: { bridgeId: existing.id },
        data: { acceptedA: false, acceptedB: false },
      });
      await this.prisma.studioBridgePermission.updateMany({
        where: { bridgeId: existing.id },
        data: proposerIsA ? { acceptedA: true } : { acceptedB: true },
      });
      this.invalidateCache(a, b);
      return existing;
    }
    const bridge = await this.prisma.studioBridge.create({
      data: {
        studioAId: a,
        studioBId: b,
        proposedBy: ownerId,
        permissions: {
          create: ALL_FUNCTIONS.map((f) => ({
            function: f,
            acceptedA: proposerIsA, // proposer's side is auto-accepted
            acceptedB: !proposerIsA,
          })),
        },
      },
      include: { permissions: true },
    });
    return bridge;
  }

  /** Find a bridge by ID */
  async find(bridgeId: string) {
    return this.prisma.studioBridge.findUnique({ where: { id: bridgeId } });
  }

  /** Admin accepts a bridge for their studio */
  async respond(bridgeId: string, studioId: string, accept: boolean, functionFilter?: string[]) {
    const bridge = await this.prisma.studioBridge.findUnique({
      where: { id: bridgeId },
      include: { permissions: true },
    });
    if (!bridge) throw new NotFoundException('Bridge not found');
    if (bridge.status === 'ACTIVE' || bridge.status === 'REJECTED') throw new ForbiddenException('已处理');

    const isA = bridge.studioAId === studioId;
    const isB = bridge.studioBId === studioId;
    if (!isA && !isB) throw new ForbiddenException('无权操作');

    if (!accept) {
      await this.prisma.studioBridge.update({ where: { id: bridgeId }, data: { status: 'REJECTED' } });
      this.invalidateCache(bridge.studioAId, bridge.studioBId);
      return { status: 'REJECTED' };
    }

    // 被桥接方自己选择愿意共享哪些功能；未勾选的功能直接删除（不共享）。
    const functions = functionFilter && functionFilter.length > 0 ? functionFilter : ALL_FUNCTIONS;
    for (const perm of bridge.permissions) {
      if (functions.includes(perm.function)) {
        await this.prisma.studioBridgePermission.update({
          where: { id: perm.id },
          data: isA ? { acceptedA: true } : { acceptedB: true },
        });
      } else {
        await this.prisma.studioBridgePermission.delete({ where: { id: perm.id } });
      }
    }

    await this.prisma.studioBridge.update({
      where: { id: bridgeId },
      data: { status: 'ACTIVE', acceptedAt: new Date() },
    });
    this.invalidateCache(bridge.studioAId, bridge.studioBId);
    return { status: 'ACTIVE' };
  }

  /** 桥接成功后，任一方可随时修改自己愿意共享的功能。 */
  async updatePermissions(bridgeId: string, studioId: string, functions: string[]) {
    const bridge = await this.prisma.studioBridge.findUnique({
      where: { id: bridgeId },
      include: { permissions: true },
    });
    if (!bridge) throw new NotFoundException('桥接不存在');
    if (bridge.status !== 'ACTIVE') throw new ForbiddenException('桥接未生效');
    const isA = bridge.studioAId === studioId;
    const isB = bridge.studioBId === studioId;
    if (!isA && !isB) throw new ForbiddenException('无权操作');

    const selected = new Set(functions || []);
    const existing = new Map(bridge.permissions.map((p) => [p.function, p]));

    for (const fn of ALL_FUNCTIONS) {
      const perm = existing.get(fn);
      if (perm) {
        await this.prisma.studioBridgePermission.update({
          where: { id: perm.id },
          data: isA ? { acceptedA: selected.has(fn) } : { acceptedB: selected.has(fn) },
        });
      } else if (selected.has(fn)) {
        await this.prisma.studioBridgePermission.create({
          data: {
            bridgeId: bridge.id,
            function: fn,
            acceptedA: isA,
            acceptedB: isB,
          },
        });
      }
    }

    this.invalidateCache(bridge.studioAId, bridge.studioBId);
    return { status: 'ACTIVE' };
  }

  /** Get all active bridge connections for a studio */
  async getActiveBridges(studioId: string | null) {
    if (!studioId) return [];
    return this.prisma.studioBridge.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ studioAId: studioId }, { studioBId: studioId }],
      },
      include: {
        studioA: { select: { id: true, name: true, displayName: true } },
        studioB: { select: { id: true, name: true, displayName: true } },
        permissions: true,
      },
    });
  }

  /** Get all studio IDs that share data with this studio */
  async getBridgedStudioIds(studioId: string): Promise<string[]> {
    if (!studioId) return [];
    const cached = this.cacheGet(this.bridgedCache, studioId);
    if (cached) return cached;
    const bridges = await this.getActiveBridges(studioId);
    const ids = new Set<string>();
    for (const b of bridges) {
      if (b.studioAId === studioId) ids.add(b.studioBId);
      else ids.add(b.studioAId);
    }
    const result = [...ids];
    this.cacheSet(this.bridgedCache, studioId, result);
    return result;
  }

  /**
   * 「曾经桥接过」的工作室（**含已经断开的**）。
   *
   * 对账页用这个，而不是只看生效中的 `getBridgedStudioIds`：断开桥接只是以后不再互相抢单，
   * **以前互相接过的单还得查得到** —— 否则先断桥接就能把旧账赖掉。
   */
  async getEverBridgedStudioIds(studioId: string): Promise<string[]> {
    if (!studioId) return [];
    const bridges = await this.prisma.studioBridge.findMany({
      where: { OR: [{ studioAId: studioId }, { studioBId: studioId }] },
      select: { studioAId: true, studioBId: true },
    });
    const ids = new Set<string>();
    for (const b of bridges) {
      ids.add(b.studioAId === studioId ? b.studioBId : b.studioAId);
    }
    ids.delete(studioId);
    return [...ids];
  }

  /** Get all studio IDs visible to a user (own + bridged), optionally filtered by function */
  async getVisibleStudioIds(studioId: string, fn?: string): Promise<string[]> {
    if (!studioId) return [];
    const cacheKey = fn ? `${studioId}:${fn}` : studioId;
    const cached = this.cacheGet(this.visibleCache, cacheKey);
    if (cached) return cached;
    const own = [studioId];
    if (!fn) {
      const bridged = await this.getBridgedStudioIds(studioId);
      const result = [...own, ...bridged];
      this.cacheSet(this.visibleCache, cacheKey, result);
      return result;
    }
    // Filter bridges by specific function permission
    const bridges = await this.prisma.studioBridge.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ studioAId: studioId }, { studioBId: studioId }],
        permissions: { some: { function: fn, acceptedA: true, acceptedB: true } },
      },
    });
    const ids = new Set(own);
    for (const b of bridges) {
      if (b.studioAId === studioId) ids.add(b.studioBId);
      else ids.add(b.studioAId);
    }
    const result = [...ids];
    this.cacheSet(this.visibleCache, cacheKey, result);
    return result;
  }

  /**
   * 单向共享：返回「把 fn 共享给我」的工作室 ID（含我自己）。
   * 只有对方自己勾选共享给我，我才能看到对方数据；我勾了什么不影响对方。
   */
  async getInboundSharedStudioIds(studioId: string, fn: string): Promise<string[]> {
    if (!studioId) return [];
    const own = [studioId];
    const bridges = await this.prisma.studioBridge.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ studioAId: studioId }, { studioBId: studioId }],
        permissions: { some: { function: fn } },
      },
      include: { permissions: true },
    });
    const ids = new Set(own);
    for (const b of bridges) {
      const perm = b.permissions.find((p) => p.function === fn);
      if (!perm) continue;
      if (b.studioAId === studioId && perm.acceptedB) ids.add(b.studioBId);
      if (b.studioBId === studioId && perm.acceptedA) ids.add(b.studioAId);
    }
    return [...ids];
  }

  /** Terminate/cancel a bridge — any involved studio can cancel at any time */
  async terminate(bridgeId: string, studioId: string) {
    const bridge = await this.prisma.studioBridge.findUnique({ where: { id: bridgeId } });
    if (!bridge) throw new NotFoundException('桥接不存在');
    if (bridge.studioAId !== studioId && bridge.studioBId !== studioId) throw new ForbiddenException('无权操作');
    await this.prisma.studioBridge.update({ where: { id: bridgeId }, data: { status: 'REJECTED' } });
    this.invalidateCache(bridge.studioAId, bridge.studioBId);
    return { status: 'REJECTED' };
  }

  /** List pending proposals */
  async listPending(studioId?: string) {
    const where: any = { status: 'PENDING' };
    if (studioId) where.OR = [{ studioAId: studioId }, { studioBId: studioId }];
    return this.prisma.studioBridge.findMany({
      where,
      include: {
        studioA: { select: { id: true, name: true, displayName: true } },
        studioB: { select: { id: true, name: true, displayName: true } },
        permissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 桥接往来对账（老板 2026-09-21 口径：**只统计，不转账**）。
   *
   * 算两件事，给两个店长拿去微信上互相结账：
   * - **我应付**：我店发的单、被对方店陪玩接走了 → 我收了客户的钱，该把「陪玩那一份」还给对方店；
   * - **我应收**：对方店发的单、被我店陪玩接走了 → 我垫了陪玩提成，该向对方店收回来。
   *
   * 口径刻意与 `billing/settlement.service.ts` 一致（同样的当月业绩、同样的按店阶梯），
   * 否则「统计出来的钱」和「实际发的工资」对不上。月份按营业月（每日 12:00 为界）。
   */
  async settlementStats(studioId: string, month: string, peerStudioId?: string) {
    const { start, end } = settlementMonthRange(month);
    const range = { start: start.toISOString(), end: end.toISOString() };
    const empty = { month, range, peers: [], rows: [], totals: summarizeBridge([]) };
    if (!studioId) return empty;

    // 用「曾经桥接过」的范围：断桥接之后旧账仍然要查得到
    const bridgedIds = (await this.getEverBridgedStudioIds(studioId)).filter(
      (id) => !peerStudioId || id === peerStudioId,
    );
    if (!bridgedIds.length) return empty;

    // 「我店 + 桥接店」当月的已完成单。两种跨店形式都要覆盖：
    // ① 直接抢了对方店的单（陪玩不是发单店的人）；② 本店主陪带对方店陪玩分成（customFields.splits）。
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'DONE',
        createdAt: { gte: start, lt: end },
        studioId: { in: [studioId, ...bridgedIds] },
      },
      select: {
        id: true,
        orderCode: true,
        gameName: true,
        amount: true,
        coAmount: true,
        companionId: true,
        coCompanionId: true,
        customFields: true,
        studioId: true,
        createdAt: true,
        studio: { select: { id: true, name: true } },
        customer: { select: { customerCode: true, wechatId: true } },
        sessions: { select: { endedAt: true }, orderBy: { seq: 'desc' }, take: 1 },
      },
    });

    const involved = new Set<string>();
    const splitsOf = (o: any): Array<{ companionId?: string; amount?: number }> =>
      Array.isArray(o?.customFields?.splits) ? o.customFields.splits : [];
    for (const o of orders) {
      if (o.companionId) involved.add(o.companionId);
      if (o.coCompanionId) involved.add(o.coCompanionId);
      for (const s of splitsOf(o)) if (s?.companionId) involved.add(s.companionId);
    }
    if (!involved.size) return empty;
    const ids = [...involved];

    const [companions, monthOrders] = await Promise.all([
      this.prisma.companion.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          createdAt: true,
          isSeniorStaff: true,
          revenueShare: true,
          user: { select: { username: true, displayName: true } },
          studio: { select: { id: true, name: true, splitMode: true } },
        },
      }),
      // 当月业绩：口径与月度结算一致（主陪 + 搭档都算进同一个人的月流水，用来定分成档位）
      this.prisma.order.findMany({
        where: {
          status: 'DONE',
          createdAt: { gte: start, lt: end },
          OR: [{ companionId: { in: ids } }, { coCompanionId: { in: ids } }],
        },
        select: {
          amount: true,
          coAmount: true,
          companionId: true,
          coCompanionId: true,
          customFields: true,
        },
      }),
    ]);

    const monthRevenue = new Map<string, number>();
    for (const o of monthOrders) {
      for (const cid of new Set([o.companionId, o.coCompanionId])) {
        if (!cid || !involved.has(cid)) continue;
        monthRevenue.set(cid, (monthRevenue.get(cid) || 0) + companionOrderRevenue(o, cid));
      }
    }

    // 分成阶梯按**陪玩自己店**解析（店长填的优先，没填用老板默认）
    const cfgByStudio = new Map<string, { tiers?: RevenueSplitTier[]; clubPct: number }>();
    await Promise.all(
      [...new Set(companions.map((c) => c.studio?.id).filter((v): v is string => !!v))].map(
        async (sid) => {
          const cfg = await resolveConfigs(this.prisma, sid, [
            'revenue.share_tiers',
            'revenue.club_companion_share',
          ]);
          cfgByStudio.set(sid, {
            tiers: (cfg['revenue.share_tiers'] as unknown as RevenueSplitTier[]) ?? undefined,
            clubPct: Number(cfg['revenue.club_companion_share'] ?? 80),
          });
        },
      ),
    );

    const pctById = new Map<string, number>();
    for (const c of companions) {
      const cfg = cfgByStudio.get(c.studio?.id ?? '');
      pctById.set(
        c.id,
        computeSharePct({
          splitMode: c.studio?.splitMode ?? 'TIERED',
          monthlyRevenue: monthRevenue.get(c.id) || 0,
          tenureMonths: effectiveTenureMonths(c.createdAt, c.isSeniorStaff),
          revenueShare: c.revenueShare,
          defaultClubSharePct: cfg?.clubPct ?? 80,
          tiers: cfg?.tiers,
        }),
      );
    }

    const byId = new Map(companions.map((c) => [c.id, c]));
    const rows: BridgeSettlementRow[] = [];
    for (const o of orders) {
      const participants = new Map<string, BridgeRowRole>();
      if (o.companionId) participants.set(o.companionId, 'PRIMARY');
      if (o.coCompanionId && !participants.has(o.coCompanionId)) participants.set(o.coCompanionId, 'CO');
      for (const s of splitsOf(o)) {
        if (s?.companionId && !participants.has(s.companionId)) participants.set(s.companionId, 'SPLIT');
      }
      const finishedAt = o.sessions?.[0]?.endedAt ?? null;
      for (const [cid, role] of participants) {
        const c = byId.get(cid);
        const companionStudioId = c?.studio?.id;
        if (!companionStudioId) continue;
        const direction = bridgeDirection({
          myStudioId: studioId,
          orderStudioId: o.studioId,
          companionStudioId,
        });
        if (!direction) continue;
        const amount = roundYuan(companionOrderRevenue(o, cid));
        if (amount <= 0) continue; // 搭档没填金额、或只挂名没分成
        const pct = pctById.get(cid) ?? 0;
        const companionShare = roundYuan((amount * pct) / 100);
        const peer = direction === 'INBOUND' ? c!.studio! : o.studio;
        rows.push({
          direction,
          role,
          orderId: o.id,
          orderCode: o.orderCode,
          gameName: o.gameName,
          createdAt: o.createdAt ? o.createdAt.toISOString() : null,
          finishedAt: finishedAt ? new Date(finishedAt).toISOString() : null,
          customerCode: o.customer?.customerCode ?? null,
          customerWechat: o.customer?.wechatId ?? null,
          publisherStudioId: o.studio.id,
          publisherStudioName: o.studio.name,
          companionId: cid,
          companionName: c!.user?.displayName || c!.user?.username || cid.slice(0, 8),
          companionStudioId,
          companionStudioName: c!.studio!.name,
          peerStudioId: peer.id,
          peerStudioName: peer.name,
          amount,
          companionPct: pct,
          companionShare,
          studioShare: roundYuan(amount - companionShare),
        });
      }
    }

    rows.sort((a, b) =>
      String(b.finishedAt || b.createdAt).localeCompare(String(a.finishedAt || a.createdAt)),
    );
    return {
      month,
      range,
      peers: groupByPeer(rows),
      rows,
      totals: summarizeBridge(rows),
    };
  }
}
