// craftsman-ignore: TS001,TS002
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from '../studios/bridge.service';

/**
 * 待处理工作台（老板 2026-10-06）。
 *
 * 老板原话：「能不能把店长 / 老板 / 客服需要处理的集合起来，要不然到处都是，
 * 每天上班先点开待处理看一下」。
 *
 * 以前这些待办散在七八个页面里：成交核对、补单审核、报账、支取、战绩图、工作微信、
 * 实名审核、删除客户、桥接申请、客服该跟进的客户…… 每个都靠自己那一页的红点提醒，
 * 谁也不知道今天到底欠多少事。这里把它们**按角色**汇总成一份清单 ——
 * 一行一条 + 「去处理」跳转，数量给侧边栏「待处理」用。
 *
 * 只做「读 + 跳转」：真正的同意 / 驳回 / 拍板还在各自的页面上做，
 * 这样每处的权限校验、留痕、实时通知都不用重写一遍。
 */

export interface TodoItem {
  id: string;
  title: string;
  sub?: string;
  at?: string | null;
  href: string;
}

export interface TodoGroup {
  key: string;
  label: string;
  hint: string;
  count: number;
  href: string;
  items: TodoItem[];
}

/** 每组最多列几条（清单本身只用来「一眼扫 + 点进去」，不在这儿翻页） */
const TAKE = 5;

@Injectable()
export class TodosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: BridgeService,
  ) {}

  private nameOf(u: any): string {
    return (u?.displayName || u?.username || '').toString().trim();
  }

  async get(user: any): Promise<{ total: number; groups: TodoGroup[]; generatedAt: string }> {
    const role = user?.role ?? '';
    const studioId = user?.studioId ?? '';
    const isOwner = role === 'OWNER';
    const isAdmin = role === 'ADMIN';
    const isCs = role === 'CS';
    if (!isOwner && !isAdmin && !isCs) {
      return { total: 0, groups: [], generatedAt: new Date().toISOString() };
    }

    // 店长看本店 + 桥接工作室（跟补单申请 / 成交核对同一套口径）；老板不限。
    const visible =
      isOwner || !studioId
        ? null
        : await this.bridge.getVisibleStudioIds(studioId).catch(() => [studioId]);
    const studioWhere: any = visible ? { studioId: { in: visible } } : {};
    const companionScope: any = visible ? { companion: { studioId: { in: visible } } } : {};

    const orderReviewHref = isOwner ? '/owner/order-review' : isAdmin ? '/admin/order-review' : '/cs/order-review';
    const ordersHref = isOwner ? '/owner/orders' : isAdmin ? '/admin/orders' : '/cs/orders';
    const customersHref = isOwner ? '/owner/customers' : isAdmin ? '/admin/customers' : '/cs/customers';
    const now = Date.now();

    const groups: TodoGroup[] = [];

    const push = (g: TodoGroup) => {
      groups.push(g);
    };

    // ── 店长 / 老板：待拍板（发单客服已跟接单方核对完） ───────────────────
    if (isAdmin || isOwner) {
      const rows = await this.prisma.order
        .findMany({
          where: { ...studioWhere, outcome: 'FAILED', reviewStatus: 'CS_CONFIRMED' },
          orderBy: { outcomeAt: 'asc' },
          take: 300,
          select: {
            id: true,
            orderCode: true,
            gameName: true,
            amount: true,
            outcomeReason: true,
            outcomeNote: true,
            outcomeAt: true,
            reviewStatus: true,
            companion: { select: { user: { select: { displayName: true, username: true } } } },
            csUser: { select: { displayName: true, username: true } },
          },
        })
        .catch(() => [] as any[]);
      const list = rows as any[];
      push({
        key: 'outcome_decide',
        label: '待拍板：接单方报了「不成功」',
        hint: '发单客服已经跟接单方核完，等你拍板定责（谁的问题找谁）；写得不清楚可以打回重写',
        count: list.length,
        href: orderReviewHref,
        items: list.slice(0, TAKE).map((o) => ({
          id: o.id,
          title: `${o.orderCode || o.id}｜${o.gameName || ''}`,
          sub: `接单方 ${this.nameOf(o.companion?.user) || '—'}｜发单 ${this.nameOf(o.csUser) || '—'}｜报不成功：${(
            o.outcomeReason || o.outcomeNote || '（没写）'
          ).slice(0, 40)}`,
          at: o.outcomeAt,
          href: orderReviewHref,
        })),
      });
    }

    // ── 客服：等我核对的不成功单 ────────────────────────────────────────
    if (isCs) {
      const rows = await this.prisma.order
        .findMany({
          where: {
            ...studioWhere,
            outcome: 'FAILED',
            reviewStatus: 'CS_CONFIRMING',
            csUserId: user?.id ?? '',
          },
          orderBy: { outcomeAt: 'asc' },
          take: 300,
          select: {
            id: true,
            orderCode: true,
            gameName: true,
            outcomeReason: true,
            outcomeNote: true,
            outcomeAt: true,
            companion: { select: { user: { select: { displayName: true, username: true } } } },
          },
        })
        .catch(() => [] as any[]);
      const list = rows as any[];
      push({
        key: 'outcome_confirm',
        label: '等我核对：我发的单报了「不成功」',
        hint: '先跟接单方把这事掰扯明白，双方都没异议了再点「已跟接单方确认」，然后才轮到店长拍板',
        count: list.length,
        href: orderReviewHref,
        items: list.slice(0, TAKE).map((o) => ({
          id: o.id,
          title: `${o.orderCode || o.id}｜${o.gameName || ''}`,
          sub: `接单方 ${this.nameOf(o.companion?.user) || '—'}｜报不成功：${(
            o.outcomeReason || o.outcomeNote || '（没写）'
          ).slice(0, 40)}`,
          at: o.outcomeAt,
          href: orderReviewHref,
        })),
      });
    }

    // ── 客服：我发的单「抢了没结果」（抢走 30 分钟以上、7 天以内） ────────
    if (isCs) {
      const since = new Date(now - 7 * 24 * 3600 * 1000);
      const before = new Date(now - 30 * 60 * 1000);
      const rows = await this.prisma.order
        .findMany({
          where: {
            ...studioWhere,
            csUserId: user?.id ?? '',
            companionId: { not: null },
            outcome: null,
            refundedAt: null,
            status: { notIn: ['CANCELLED', 'DONE'] },
            sessions: { none: { startedAt: { not: null } } },
            OR: [
              { grabbedAt: { gte: since, lte: before } },
              { grabbedAt: null, createdAt: { gte: since, lte: before } },
            ],
          },
          orderBy: { grabbedAt: 'asc' },
          take: 300,
          select: {
            id: true,
            orderCode: true,
            gameName: true,
            grabbedAt: true,
            createdAt: true,
            companion: { select: { user: { select: { displayName: true, username: true } } } },
          },
        })
        .catch(() => [] as any[]);
      const list = rows as any[];
      push({
        key: 'cs_recheck',
        label: '抢了没结果：我发的单',
        hint: '抢走半小时以上、既没点「开始首单」也没报结果的单，去催接单方给个说法',
        count: list.length,
        href: orderReviewHref,
        items: list.slice(0, TAKE).map((o) => ({
          id: o.id,
          title: `${o.orderCode || o.id}｜${o.gameName || ''}`,
          sub: `接单方 ${this.nameOf(o.companion?.user) || '—'}｜还没点「开始首单」也没报结果`,
          at: o.grabbedAt || o.createdAt,
          href: orderReviewHref,
        })),
      });
    }

    // ── 客服：到点该跟进的客户（最近一条跟进写的「下次跟进」已经过了） ────
    if (isCs || isAdmin || isOwner) {
      const rows = await this.prisma.customerFollowUp
        .findMany({
          where: {
            nextFollowUpAt: { lte: new Date() },
            customer: { ...(visible ? { studioId: { in: visible } } : {}), archivedAt: null },
          },
          orderBy: { createdAt: 'desc' },
          take: 400,
          select: {
            id: true,
            customerId: true,
            nextFollowUpAt: true,
            content: true,
            customer: { select: { customerCode: true, wechatId: true } },
          },
        })
        .catch(() => [] as any[]);
      // 只认「客户最近一条跟进」：按 createdAt 倒序取每个客户的第一条，再看它到点没有。
      const seen = new Set<string>();
      const due: any[] = [];
      for (const f of rows as any[]) {
        if (seen.has(f.customerId)) continue;
        seen.add(f.customerId);
        if (f.nextFollowUpAt && new Date(f.nextFollowUpAt).getTime() <= now) due.push(f);
      }
      due.sort((a, b) => new Date(a.nextFollowUpAt).getTime() - new Date(b.nextFollowUpAt).getTime());
      push({
        key: 'followup_due',
        label: '到点该跟进的客户',
        hint: '「记跟进」时填的下次跟进时间已经过了，该去聊一聊了',
        count: due.length,
        href: customersHref,
        items: due.slice(0, TAKE).map((f) => ({
          id: f.id,
          title: `${f.customer?.wechatId || (f.customer?.customerCode ? '#' + f.customer.customerCode : '') || '客户'}`,
          sub: `上次跟进：${(f.content || '').slice(0, 30) || '（没写）'}`,
          at: f.nextFollowUpAt,
          href: customersHref,
        })),
      });
    }

    // ── 补单审核（客服 / 店长 / 老板都能审） ──────────────────────────────
    {
      const rows = await this.prisma.supplementRequest
        .findMany({
          where: { ...studioWhere, status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          take: 300,
          // SupplementRequest 上没有配关系字段，陪玩名 / 订单号单独查一次补上。
          select: {
            id: true,
            orderId: true,
            companionId: true,
            reason: true,
            evidenceUrl: true,
            createdAt: true,
          },
        })
        .catch(() => [] as any[]);
      const list = rows as any[];
      const supCompanionIds = Array.from(new Set(list.map((r) => r.companionId).filter(Boolean)));
      const supOrderIds = Array.from(new Set(list.map((r) => r.orderId).filter(Boolean)));
      const [supCompanions, supOrders] = await Promise.all([
        supCompanionIds.length
          ? this.prisma.companion.findMany({
              where: { id: { in: supCompanionIds as string[] } },
              select: { id: true, user: { select: { displayName: true, username: true } } },
            })
          : [],
        supOrderIds.length
          ? this.prisma.order.findMany({
              where: { id: { in: supOrderIds as string[] } },
              select: { id: true, orderCode: true, gameName: true },
            })
          : [],
      ]);
      const supCompanionMap = new Map((supCompanions as any[]).map((c) => [c.id, c.user]));
      const supOrderMap = new Map((supOrders as any[]).map((o) => [o.id, o]));
      push({
        key: 'supplement',
        label: '补单申请待审',
        hint: '陪玩点了「添加失败」自动开一条：同意 = 他的抢单次数 +1，不同意就驳回',
        count: list.length,
        href: ordersHref,
        items: list.slice(0, TAKE).map((r) => ({
          id: r.id,
          title: `${supOrderMap.get(r.orderId)?.orderCode || r.orderId}｜${supOrderMap.get(r.orderId)?.gameName || ''}`,
          sub: `${this.nameOf(supCompanionMap.get(r.companionId)) || '陪玩'}：${(r.reason || '（没写原因）').slice(0, 40)}`,
          at: r.createdAt,
          href: ordersHref,
        })),
      });
    }

    // ── 下面是店长 / 老板专属的审批 ──────────────────────────────────────
    if (isAdmin || isOwner) {
      const [expenseReports, withdraws, txPending, shots, wechats, companions, deletes] = await Promise.all([
        this.prisma.expenseReport
          .findMany({
            where: { ...studioWhere, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
            take: 300,
            select: { id: true, type: true, amount: true, description: true, createdAt: true, companion: { select: { user: { select: { displayName: true, username: true } } } } },
          })
          .catch(() => [] as any[]),
        this.prisma.walletTransaction
          .findMany({
            where: { ...companionScope, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
            take: 300,
            select: { id: true, type: true, amount: true, note: true, createdAt: true, companion: { select: { user: { select: { displayName: true, username: true } } } } },
          })
          .catch(() => [] as any[]),
        this.prisma.transaction
          .findMany({
            where: { ...companionScope, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
            take: 300,
            select: { id: true, amount: true, paymentMethod: true, createdAt: true, companion: { select: { user: { select: { displayName: true, username: true } } } } },
          })
          .catch(() => [] as any[]),
        this.prisma.battleScreenshot
          .findMany({
            where: { ...studioWhere, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
            take: 300,
            select: { id: true, createdAt: true, companion: { select: { user: { select: { displayName: true, username: true } } } } },
          })
          .catch(() => [] as any[]),
        this.prisma.workWechatRequest
          .findMany({
            where: { ...studioWhere, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
            take: 300,
            select: { id: true, wechatId: true, createdAt: true, companion: { select: { user: { select: { displayName: true, username: true } } } } },
          })
          .catch(() => [] as any[]),
        this.prisma.companion
          .findMany({
            where: { ...studioWhere, reviewStatus: 'PENDING', isResigned: false },
            orderBy: { createdAt: 'asc' },
            take: 300,
            select: { id: true, realName: true, createdAt: true, user: { select: { displayName: true, username: true } } },
          })
          .catch(() => [] as any[]),
        this.prisma.customerDeleteRequest
          .findMany({
            where: { ...studioWhere, status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
            take: 300,
            select: { id: true, reason: true, createdAt: true, companion: { select: { user: { select: { displayName: true, username: true } } } }, customer: { select: { customerCode: true, wechatId: true } } },
          })
          .catch(() => [] as any[]),
      ]);

      const expenseHref = '/admin/finance/expenses';
      const expenses = (expenseReports as any[]).filter((r) => r.type !== 'WITHDRAW');
      const reportWithdraws = (expenseReports as any[]).filter((r) => r.type === 'WITHDRAW');
      push({
        key: 'expense_report',
        label: '陪玩报账待审',
        hint: '陪玩提交的支出 / 报销单，去「陪玩审核 + 支取」通过或驳回',
        count: expenses.length,
        href: expenseHref,
        items: expenses.slice(0, TAKE).map((r) => ({
          id: r.id,
          title: `${this.nameOf(r.companion?.user) || '陪玩'}｜¥${Number(r.amount || 0)}`,
          sub: (r.description || '（没写说明）').slice(0, 40),
          at: r.createdAt,
          href: expenseHref,
        })),
      });
      push({
        key: 'withdraw',
        label: '支取 / 提现待审',
        hint: '陪玩申请提现或支取，去「陪玩审核 + 支取」处理',
        count: (withdraws as any[]).length + reportWithdraws.length,
        href: expenseHref,
        items: [...(withdraws as any[]), ...reportWithdraws]
          .slice(0, TAKE)
          .map((r: any) => ({
            id: r.id,
            title: `${this.nameOf(r.companion?.user) || '陪玩'}｜¥${Number(r.amount || 0)}`,
            sub: r.type === 'WITHDRAW' ? '提现申请' : r.note || '支取申请',
            at: r.createdAt,
            href: expenseHref,
          })),
      });
      push({
        key: 'transaction',
        label: '陪玩流水待审',
        hint: '陪玩报的收款流水，去「陪玩审核 + 支取」核对金额',
        count: (txPending as any[]).length,
        href: expenseHref,
        items: (txPending as any[]).slice(0, TAKE).map((r: any) => ({
          id: r.id,
          title: `${this.nameOf(r.companion?.user) || '陪玩'}｜¥${Number(r.amount || 0)}`,
          sub: `收款方式：${r.paymentMethod || '—'}`,
          at: r.createdAt,
          href: expenseHref,
        })),
      });
      push({
        key: 'battle_screenshot',
        label: '战绩图待审',
        hint: '陪玩上传的战绩图，采纳会加分 / 驳回',
        count: (shots as any[]).length,
        href: '/admin/battle-screenshots',
        items: (shots as any[]).slice(0, TAKE).map((r: any) => ({
          id: r.id,
          title: this.nameOf(r.companion?.user) || '陪玩',
          sub: '上传了一组战绩图',
          at: r.createdAt,
          href: '/admin/battle-screenshots',
        })),
      });
      push({
        key: 'work_wechat',
        label: '工作微信申请待审',
        hint: '陪玩提交的工作微信号，通过后才会生效',
        count: (wechats as any[]).length,
        href: isOwner ? '/owner/work-wechats?type=COMPANION' : '/admin/work-wechats?type=COMPANION',
        items: (wechats as any[]).slice(0, TAKE).map((r: any) => ({
          id: r.id,
          title: `${this.nameOf(r.companion?.user) || '陪玩'}｜${r.wechatId || ''}`,
          sub: '提交了新的工作微信号',
          at: r.createdAt,
          href: isOwner ? '/owner/work-wechats?type=COMPANION' : '/admin/work-wechats?type=COMPANION',
        })),
      });
      push({
        key: 'realname',
        label: '实名审核待办',
        hint: '新注册的陪玩等实名 / 资质审核，过了才能接单',
        count: (companions as any[]).length,
        href: isOwner ? '/owner/review' : '/admin/review',
        items: (companions as any[]).slice(0, TAKE).map((r: any) => ({
          id: r.id,
          title: this.nameOf(r.user) || r.realName || '新注册陪玩',
          sub: `实名：${r.realName || '（没填）'}`,
          at: r.createdAt,
          href: isOwner ? '/owner/review' : '/admin/review',
        })),
      });
      push({
        key: 'customer_delete',
        label: '删除客户申请待审',
        hint: '陪玩申请删掉某个客户（删了档案就不在了），要点开看清再定',
        count: (deletes as any[]).length,
        href: customersHref,
        items: (deletes as any[]).slice(0, TAKE).map((r: any) => ({
          id: r.id,
          title: `${this.nameOf(r.companion?.user) || '陪玩'} → ${r.customer?.wechatId || (r.customer?.customerCode ? '#' + r.customer.customerCode : '客户')}`,
          sub: (r.reason || '（没写原因）').slice(0, 40),
          at: r.createdAt,
          href: customersHref,
        })),
      });
    }

    // ── 老板专属：工作室桥接申请 ─────────────────────────────────────────
    if (isOwner) {
      const rows = await this.prisma.studioBridge
        .findMany({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          take: 300,
          select: { id: true, createdAt: true },
        })
        .catch(() => [] as any[]);
      push({
        key: 'bridge',
        label: '工作室桥接申请待审',
        hint: '别家工作室申请跟你家桥接，通过后两边单子互通',
        count: (rows as any[]).length,
        href: '/owner/bridges',
        items: (rows as any[]).slice(0, TAKE).map((r: any) => ({
          id: r.id,
          title: '桥接申请',
          sub: '等你同意',
          at: r.createdAt,
          href: '/owner/bridges',
        })),
      });
    }

    // 空组不展示（今天没事的那一类不占地方）
    const filled = groups.filter((g) => g.count > 0);
    return {
      total: filled.reduce((s, g) => s + g.count, 0),
      groups: filled,
      generatedAt: new Date().toISOString(),
    };
  }
}
