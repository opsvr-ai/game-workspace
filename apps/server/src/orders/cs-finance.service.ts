// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { resolveConfigsRaw } from '../common/studio-config';
import { settlementMonthRange } from '../common/business-day';
import { PoolScope } from '@chunlv/shared';
import { orderUnits, outcomeOf } from '../common/order-outcome';

/**
 * 客服微信收款 / 资金流水 / 对账（从 OrdersService 拆出的子域服务）。
 *
 * 方法体原样搬运，行为与拆分前完全一致：不改 HTTP 路由、响应字段、数据库 schema、
 * socket 事件名、业务口径与线上配置键。OrdersService 保留同名方法做门面委托，
 * 调用方（OrdersController 等）零改动。
 */
@Injectable()
export class CsFinanceService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
  ) {}

  async listCsFollowup(studioId: string, user?: { id: string; role: string }) {
    const where: any = { status: 'PENDING' };
    if (studioId) where.studioId = studioId;
    // 客服只看自己跟进的单，店长/老板看全工作室
    if (user && user.role === 'CS') where.csUserId = user.id;
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        // 跟进台账要显示「最后跟进（时间 + 聊了啥）」「下次跟进」「客服工作微信」，
        // 所以把客户最近一条跟进记录一起带出来（只取一条，代价很小）
        customer: { include: { followUps: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, avatar: true, displayName: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
        sessions: {
          where: { status: 'ACTIVE', startedAt: { not: null } },
          orderBy: { seq: 'desc' },
          take: 1,
          select: { id: true, startedAt: true, duration: true, seq: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 台账状态：待添加 / 已添加 / 客户已同意 / 添加失败 / 已派单。
    // 「已派单」这一行留着当记录（客服点「处理完成」才从这里消失，见 markPoolHandled）。
    return orders.filter((o) => {
      return (
        o.contactStatus === 'pending' ||
        o.contactStatus === 'added' ||
        o.contactStatus === 'agreed' ||
        o.contactStatus === 'not_accepted' ||
        o.contactStatus === 'dispatched'
      );
    });
  }

  // 客服养好的客户重新派单后，被谁抢走、陪玩用什么微信、最终去了线下/桥接/线上
  async listCsConverted(studioId: string, user?: { id: string; role: string }) {
    const where: any = { companionId: { not: null }, status: { not: 'CANCELLED' } };
    if (studioId) where.studioId = studioId;
    if (user && user.role === 'CS') where.csUserId = user.id;
    const juejuCents = await this.getJuejuReturnCents(studioId);

    const orders = await this.prisma.order.findMany({
        where,
        include: {
          customer: true,
          csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
          claimedCsUser: { select: { id: true, username: true, avatar: true, displayName: true } },
          companion: {
            include: {
              user: { select: { id: true, username: true, avatar: true, displayName: true } },
              studio: { select: { id: true, name: true, type: true } },
            },
          },
          coCompanion: { include: { user: { select: { id: true, username: true } } } },
          moneyFlows: true,
        },
        orderBy: { updatedAt: 'desc' },
      });

    return orders
      .filter((o) => {
        const cf = (o.customFields as any) || {};
        return cf.csCultivated === true;
      })
        .map((o) => {
          const cf = (o.customFields as any) || {};
          const compStudio = o.companion?.studio;
          let destination = '线下工作室';
        if (compStudio) {
          if (compStudio.type === 'RENTAL') destination = '线上俱乐部';
          else if (compStudio.id !== studioId) destination = '桥接工作室';
          else destination = '线下工作室';
        }
        let addStatus = '待结果';
        if (o.contactStatus === 'added') addStatus = '添加成功';
        else if (o.contactStatus === 'not_accepted') addStatus = '添加失败';
        const moneyIn = o.moneyFlows
          .filter((f) => f.direction === 'IN')
          .reduce((s, f) => s + f.amount, 0);
          const moneyOut = o.moneyFlows
            .filter((f) => f.direction === 'OUT')
            .reduce((s, f) => s + f.amount, 0);
          const isDouble = o.coCompanionId || cf.deltaCount === '双';
          const companions = isDouble ? 2 : 1;
          const bridgeReturn =
            cf.deltaMission === '绝密' ? (juejuCents / 100) * (o.duration || 1) * companions : 0;
          return {
            ...o,
            companionUserId: o.companion?.user?.id || '',
            customerPaidAccount: o.customerPaymentAccountName || '',
            moneyIn,
            moneyOut,
            bridgeReturn,
            addStatus,
            destination,
        };
      });
  }

  /**
   * 「线下→线上流转」的单，线下没人接、被桥接工作室 / 线上俱乐部接走 —— 统计 + 标注
   * （老板 2026-09-29：「选择线下+线上入池的时候，线下没人接，被桥接工作室或者线上俱乐部接走
   * 你要做好统计，并做好标注，记录好机密还是绝密、应收多少，钱在哪里等信息并做好汇总」）。
   *
   * 口径：
   *  - 只统计**本店**发的、入池方式 =「线下→线上流转」的单（poolScope 不是 ONLINE_FIRST）；
   *  - 只统计**已经被人抢走**、而且抢的人不是本店线下（桥接工作室 / 线上俱乐部）的单；
   *  - **桥接工作室** = 「首单不结」模式：机密 35 元/人/时、绝密 30 元/人/时是工作室净得的；
   *  - **线上俱乐部** = 「抽成」模式：工作室拿 100 − 陪玩分成（revenue.club_companion_share）；
   *  - 应收 = 客户按业绩（单价 × 时长，双陪算两份）；
   *  - 应返还 = 绝密单返还给接单方（默认 15 元/人/小时，双陪 ×2）；机密首单不结、不返还。
   */
  async listEscalatedPoolOrders(studioId: string, opts?: { month?: string; csUserId?: string }) {
    const now = new Date();
    const month = opts?.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const blankTotals = () => ({
      count: 0,
      bridgeCount: 0,
      onlineCount: 0,
      units: 0,
      jimiUnits: 0,
      juejuUnits: 0,
      grossYuan: 0,
      returnYuan: 0,
      studioNetYuan: 0,
      bridgeGrossYuan: 0,
      onlineGrossYuan: 0,
      bridgeReturnYuan: 0,
      onlineReturnYuan: 0,
      moneyInYuan: 0,
      moneyOutYuan: 0,
    });
    if (!studioId) return { month, totals: blankTotals(), rows: [] as any[] };
    const { start, end } = settlementMonthRange(month);

    const [juejuCents, scopedCfg] = await Promise.all([
      this.getJuejuReturnCents(studioId),
      resolveConfigsRaw(this.prisma, studioId, [
        'bridge.secret_price_yuan',
        'bridge.jueju_net_yuan',
        'revenue.club_companion_share',
      ]),
    ]);
    const secretPrice = Number(scopedCfg['bridge.secret_price_yuan'] ?? 35);
    const juejuNet = Number(scopedCfg['bridge.jueju_net_yuan'] ?? 30);
    const clubCompanionShare = Number(scopedCfg['revenue.club_companion_share'] ?? 80);

    const orders = await this.prisma.order.findMany({
      where: {
        studioId,
        createdAt: { gte: start, lt: end },
        companionId: { not: null },
        status: { not: 'CANCELLED' },
        AND: [
          // 「线下→线上流转」= poolScope 不是 ONLINE_FIRST（含历史 null）。
          // 注意：这里必须显式写 `null OR <>`，不能用 `NOT: { poolScope: ... }` ——
          // SQL 里 `NOT (poolScope = 'x')` 对 NULL 求值还是 NULL，会把所有老单（poolScope 为 null）全过滤掉。
          { OR: [{ poolScope: null }, { poolScope: { not: PoolScope.ONLINE_FIRST } }] },
          ...(opts?.csUserId
            ? [
                {
                  OR: [
                    { attributedCsUserId: opts.csUserId },
                    { claimedCsUserId: opts.csUserId },
                    { csUserId: opts.csUserId },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        customer: { select: { customerCode: true, wechatId: true } },
        csUser: { select: { id: true, username: true, displayName: true } },
        claimedCsUser: { select: { id: true, username: true, displayName: true } },
        companion: {
          include: {
            user: { select: { username: true, displayName: true } },
            studio: { select: { id: true, name: true, type: true } },
          },
        },
        coCompanion: { include: { user: { select: { username: true } } } },
        moneyFlows: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = orders
      .filter((o) => {
        const compStudio = o.companion?.studio;
        // 只留「被别家接走」的：桥接工作室（别的店）或线上俱乐部（租赁店）
        return !!compStudio && (compStudio.id !== studioId || compStudio.type === 'RENTAL');
      })
      .map((o) => {
        const cf = (o.customFields as any) || {};
        const compStudio = o.companion!.studio!;
        const isOnline = compStudio.type === 'RENTAL';
        const mission =
          cf.deltaMission === '绝密' ? '绝密' : cf.deltaMission === '机密' ? '机密' : '';
        const units = orderUnits(o as any);
        const duration = Number(o.duration) || 1;
        const gross = (Number(o.amount || 0) + Number(o.coAmount || 0)) * duration;
        const returnYuan = mission === '绝密' ? (juejuCents / 100) * duration * units : 0;
        const studioNetYuan = isOnline
          ? Number((gross * ((100 - clubCompanionShare) / 100)).toFixed(2))
          : Number(((mission === '绝密' ? juejuNet : secretPrice) * duration * units).toFixed(2));
        const moneyIn = o.moneyFlows
          .filter((f) => f.direction === 'IN')
          .reduce((s, f) => s + Number(f.amount || 0), 0);
        const moneyOut = o.moneyFlows
          .filter((f) => f.direction === 'OUT')
          .reduce((s, f) => s + Number(f.amount || 0), 0);
        const moneyWhere = Array.from(
          new Set(
            [
              cf.csWorkWechatName ? `客服工作微信 ${cf.csWorkWechatName}` : '',
              o.customerPaymentAccountName ? `客户付款到 ${o.customerPaymentAccountName}` : '',
              ...o.moneyFlows.map((f) =>
                f.counterpart ? `${f.direction === 'IN' ? '转入' : '转出'} ${f.counterpart}` : '',
              ),
            ].filter(Boolean),
          ),
        );
        const decision = outcomeOf(o as any, studioId);
        return {
          orderId: o.id,
          orderCode: o.orderCode,
          createdAt: o.createdAt,
          grabbedAt: o.grabbedAt,
          gameName: o.gameName,
          customerCode: o.customer?.customerCode || '',
          customerWechat: o.customer?.wechatId || cf.customerWechat || '',
          csName: o.csUser?.displayName || o.csUser?.username || '',
          csUserId: o.csUser?.id || '',
          mission,
          countText: units === 2 ? '双陪' : '单陪',
          units,
          duration,
          destination: isOnline ? '线上俱乐部' : '桥接工作室',
          destinationStudioName: compStudio.name || '',
          settleMode: isOnline ? '抽成' : '首单不结',
          grossYuan: Number(gross.toFixed(2)),
          returnYuan: Number(returnYuan.toFixed(2)),
          studioNetYuan,
          moneyInYuan: Number(moneyIn.toFixed(2)),
          moneyOutYuan: Number(moneyOut.toFixed(2)),
          moneyWhere,
          state: decision.state,
          stateReason: decision.reason,
        };
      });

    const totals = blankTotals();
    for (const r of rows) {
      totals.count += 1;
      totals.units += r.units;
      if (r.mission === '绝密') totals.juejuUnits += r.units;
      else if (r.mission === '机密') totals.jimiUnits += r.units;
      totals.grossYuan += r.grossYuan;
      totals.returnYuan += r.returnYuan;
      totals.studioNetYuan += r.studioNetYuan;
      totals.moneyInYuan += r.moneyInYuan;
      totals.moneyOutYuan += r.moneyOutYuan;
      if (r.destination === '线上俱乐部') {
        totals.onlineCount += 1;
        totals.onlineGrossYuan += r.grossYuan;
        totals.onlineReturnYuan += r.returnYuan;
      } else {
        totals.bridgeCount += 1;
        totals.bridgeGrossYuan += r.grossYuan;
        totals.bridgeReturnYuan += r.returnYuan;
      }
    }
    const rounded: Record<string, number> = {};
    for (const [k, v] of Object.entries(totals)) {
      rounded[k] = k.endsWith('Yuan') ? Number(v.toFixed(2)) : v;
    }
    return { month, totals: rounded, rows };
  }

  async listMoneyFlows(orderId: string) {
    return this.prisma.orderMoneyFlow.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  async addMoneyFlow(
    orderId: string,
    data: { direction: string; amount: number; counterpart: string; counterpartId?: string; note?: string },
  ) {
    return this.prisma.orderMoneyFlow.create({
      data: {
        orderId,
        direction: data.direction,
        amount: data.amount,
        counterpart: data.counterpart,
        counterpartId: data.counterpartId,
        note: data.note,
      },
      });
  }

  // 客服每个工作微信的余额 = 流入(客户转入) - 流出(转给陪玩/桥接等) - 店长转走的余额
  // 客服角色只看自己绑定的工作微信，店长/老板看本工作室全部。
  async listCsWechatBalances(studioId: string, csUserId?: string) {
    const [wechats, orders, logs] = await Promise.all([
      this.prisma.workWechat.findMany({
        where: { studioId, type: 'STUDIO', ...(csUserId ? { csUserId } : {}) },
      }),
      this.prisma.order.findMany({ where: { studioId }, select: { customFields: true, moneyFlows: true } }),
      this.prisma.workWechatBalanceLog.findMany({ where: { studioId } }),
    ]);

    const withdrawnMap = new Map<string, number>();
    for (const l of logs) {
      withdrawnMap.set(l.workWechatId, (withdrawnMap.get(l.workWechatId) || 0) + l.amount);
    }

    return wechats.map((w) => {
      const related = orders.filter(
        (o) => ((o.customFields as any) || {}).csWorkWechatName === w.wechatId,
      );
      let inTotal = 0;
      let outTotal = 0;
      for (const o of related) {
        for (const f of o.moneyFlows) {
          if (f.direction === 'IN') inTotal += f.amount;
          else if (f.direction === 'OUT') outTotal += f.amount;
        }
      }
      const withdrawn = withdrawnMap.get(w.id) || 0;
      return {
        id: w.id,
        wechatId: w.wechatId,
        csUserId: w.csUserId,
        inTotal,
        outTotal,
        withdrawn,
        balance: inTotal - outTotal - withdrawn,
      };
    });
  }

  // 店长把客服微信里的余额转走，记录一笔清零业绩，让系统余额归零
  async clearCsWechatBalance(studioId: string, workWechatId: string, note?: string) {
    const balances = await this.listCsWechatBalances(studioId);
    const target = balances.find((b) => b.id === workWechatId);
    if (!target) throw new NotFoundException('该客服微信不存在');
    if (target.balance <= 0) throw new BadRequestException('当前余额为 0，无需清零');

    await this.prisma.workWechatBalanceLog.create({
      data: {
        studioId,
        workWechatId,
        amount: target.balance,
        note: note || '店长转走余额清零',
      },
    });

    return this.listCsWechatBalances(studioId);
  }

  // 店长转走余额统计：本月 / 今年 / 累计，跨所有客服工作微信
  async getCsWechatBalanceSummary(studioId: string) {
    const logs = await this.prisma.workWechatBalanceLog.findMany({ where: { studioId } });
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let monthTotal = 0;
    let yearTotal = 0;
    let allTotal = 0;
    for (const l of logs) {
      allTotal += l.amount;
      if (l.createdAt >= yearStart) yearTotal += l.amount;
      if (l.createdAt >= monthStart) monthTotal += l.amount;
    }
    return {
      monthTotal,
      yearTotal,
      allTotal,
      count: logs.length,
    };
  }

  // 客服工作微信收款明细：按微信聚合相关订单的每一笔业绩，并标出问题单。
  async listCsWechatFlow(studioId: string) {
    const [wechats, orders, logs, bridgeCfg] = await Promise.all([
      this.prisma.workWechat.findMany({ where: { studioId, type: 'STUDIO' } }),
      this.prisma.order.findMany({
        where: { studioId, status: { not: 'CANCELLED' } },
        include: {
          moneyFlows: true,
          customer: { select: { wechatId: true } },
          csUser: { select: { username: true, displayName: true } },
          companion: {
            include: {
              user: { select: { username: true, displayName: true } },
              studio: { select: { id: true, type: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workWechatBalanceLog.findMany({ where: { studioId } }),
      this.getJuejuReturnCents(studioId),
    ]);
    const juejuCents = bridgeCfg;

    const withdrawnMap = new Map<string, number>();
    for (const l of logs) {
      withdrawnMap.set(l.workWechatId, (withdrawnMap.get(l.workWechatId) || 0) + l.amount);
    }

    return wechats.map((w) => {
      const related = orders.filter(
        (o) => ((o.customFields as any) || {}).csWorkWechatName === w.wechatId,
      );

      const orderRows = related.map((o) => {
        const cf = (o.customFields as any) || {};
        const inTotal = o.moneyFlows
          .filter((f) => f.direction === 'IN')
          .reduce((s, f) => s + f.amount, 0);
        const outTotal = o.moneyFlows
          .filter((f) => f.direction === 'OUT')
          .reduce((s, f) => s + f.amount, 0);
        const expected = Number(o.amount || 0) * (Number(o.duration) || 1);

        let destination = '线下工作室';
        if (o.companion?.studio) {
          if (o.companion.studio.type === 'RENTAL') destination = '线上俱乐部';
          else if (o.companion.studio.id !== studioId) destination = '桥接工作室';
        }

        const problems = this.evaluateOrderProblems(o, studioId, juejuCents);

        return {
          id: o.id,
          orderCode: o.orderCode,
          gameName: o.gameName,
          status: o.status,
          customerWechat: o.customer?.wechatId || cf.customerWechat || '',
          csName: o.csUser?.displayName || o.csUser?.username || '',
          companionName: o.companion?.user?.displayName || o.companion?.user?.username || '',
          destination,
          expected: Number(expected.toFixed(1)),
          inTotal: Number(inTotal.toFixed(1)),
          outTotal: Number(outTotal.toFixed(1)),
          problems,
        };
      });

      const inTotal = orderRows.reduce((s, r) => s + r.inTotal, 0);
      const outTotal = orderRows.reduce((s, r) => s + r.outTotal, 0);
      const withdrawn = withdrawnMap.get(w.id) || 0;

      return {
        id: w.id,
        wechatId: w.wechatId,
        nickname: w.nickname || '',
        csUserId: w.csUserId,
        inTotal: Number(inTotal.toFixed(1)),
        outTotal: Number(outTotal.toFixed(1)),
        withdrawn: Number(withdrawn.toFixed(1)),
        balance: Number((inTotal - outTotal - withdrawn).toFixed(1)),
        problemCount: orderRows.filter((r) => r.problems.length > 0).length,
        orders: orderRows,
      };
    });
  }

  private evaluateOrderProblems(o: any, studioId?: string, juejuCents = 1500): string[] {
    const moneyFlows = o.moneyFlows || [];
    const inTotal = moneyFlows
      .filter((f: any) => f.direction === 'IN')
      .reduce((s: number, f: any) => s + f.amount, 0);
    const outTotal = moneyFlows
      .filter((f: any) => f.direction === 'OUT')
      .reduce((s: number, f: any) => s + f.amount, 0);
    const expected = Number(o.amount || 0) * (Number(o.duration) || 1);
    const cf = (o.customFields as any) || {};
    const isDouble = o.coCompanionId || cf.deltaCount === '双';
    const companions = isDouble ? 2 : 1;
    const isDone = o.status === 'CONFIRMED' || o.status === 'DONE';

    // 判断去向：本工作室陪玩 / 桥接工作室 / 线上俱乐部
    let isBridgeOrOnline = false;
    if (o.companion?.studio) {
      if (o.companion.studio.type === 'RENTAL') isBridgeOrOnline = true;
      else if (studioId && o.companion.studio.id !== studioId) isBridgeOrOnline = true;
    }

    const problems: string[] = [];
    if (moneyFlows.length === 0) {
      problems.push('未记业绩');
    } else {
      if (inTotal <= 0) problems.push('无客户转入');

      if (isBridgeOrOnline) {
        // 桥接/线上：机密本来就不给钱；绝密按 15 元/人/小时返还。
        if (cf.deltaMission === '绝密') {
          const bridgeReturn = (juejuCents / 100) * (Number(o.duration) || 1) * companions;
          if (isDone && outTotal < bridgeReturn) problems.push('桥接/线上返还不足');
        }
      } else {
        // 本工作室陪玩：客户转入后应转给陪玩。
        if (isDone && inTotal > 0 && outTotal <= 0) problems.push('未转陪玩');
      }

      if (outTotal > inTotal) problems.push('转出超过转入');
      if (inTotal > 0 && Math.abs(inTotal - expected) >= 0.01) problems.push('转入金额与订单不符');
    }
    return problems;
  }

  // 客服记完业绩后，检查这单账是否还有异常；有异常就提醒负责的客服去修改。
  async checkAndNotifyCsAnomaly(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        moneyFlows: true,
        companion: { include: { studio: { select: { id: true, type: true } } } },
      },
    });
    if (!order) return;
    const juejuCents = await this.getJuejuReturnCents(order.studioId);

    const cf = (order.customFields as any) || {};
    const wechatId = cf.csWorkWechatName;
    if (!wechatId) return;

    const workWechat = await this.prisma.workWechat.findUnique({ where: { wechatId } });
    if (!workWechat?.csUserId) return;

    const problems = this.evaluateOrderProblems(order, order.studioId, juejuCents);
    if (problems.length === 0) return;

    this.wsGateway.notifyUser(workWechat.csUserId, 'cs:account_anomaly', {
      orderId: order.id,
      orderCode: order.orderCode,
      gameName: order.gameName,
      wechatId,
      problems,
      message: `你的工作微信 ${wechatId} 订单「${order.gameName}」账目有异常：${problems.join('、')}，请到客服工作台「管理端直添客户流转明细」里修改`,
    });
  }

  /**
   * 绝密单的线上返款（分/小时）：取「设置 → 派单与提成 → 绝密线上返款」，按店解析。
   * 兼容老的隐藏键 `pool.bridge_return_jueju_cents`（历史上只在库里手填过）。
   */
  private async getJuejuReturnCents(studioId?: string | null): Promise<number> {
    const scoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'dispatch.bridge_return_jueju_cents',
      'pool.bridge_return_jueju_cents',
    ]);
    const v =
      scoped['dispatch.bridge_return_jueju_cents'] ?? scoped['pool.bridge_return_jueju_cents'];
    const n = Number(v);
    return Number.isFinite(n) ? n : 1500;
  }

  async listMoneyReconciliation(studioId: string) {
    const [orders, bridgeCfg] = await Promise.all([
      this.prisma.order.findMany({
        where: { studioId, status: { not: 'CANCELLED' } },
        include: {
          moneyFlows: true,
          customer: { select: { wechatId: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.getJuejuReturnCents(studioId),
    ]);
    const juejuCents = bridgeCfg;

    const rows = orders
      .filter((o) => o.moneyFlows.length > 0)
      .map((o) => {
        const cf = (o.customFields as any) || {};
        const inTotal = o.moneyFlows
          .filter((f) => f.direction === 'IN')
          .reduce((s, f) => s + f.amount, 0);
        const outTotal = o.moneyFlows
          .filter((f) => f.direction === 'OUT')
          .reduce((s, f) => s + f.amount, 0);
        const isDouble = o.coCompanionId || cf.deltaCount === '双';
        const companions = isDouble ? 2 : 1;
        const bridgeReturn =
          cf.deltaMission === '绝密' ? (juejuCents / 100) * (o.duration || 1) * companions : 0;
        const profit = inTotal - outTotal;
        return {
          orderId: o.id,
          orderCode: o.orderCode,
          gameName: o.gameName,
          customerWechat: o.customer?.wechatId || cf.customerWechat || '',
          csWorkWechatName: cf.csWorkWechatName || '',
          deltaMission: cf.deltaMission || '',
          inTotal,
          outTotal,
          bridgeReturn,
          profit,
          flagged: profit < 0 || outTotal > inTotal,
        };
      });

    return {
      rows,
      totalIn: rows.reduce((s, r) => s + r.inTotal, 0),
      totalOut: rows.reduce((s, r) => s + r.outTotal, 0),
      totalBridgeReturn: rows.reduce((s, r) => s + r.bridgeReturn, 0),
      totalProfit: rows.reduce((s, r) => s + r.profit, 0),
    };
  }
}
