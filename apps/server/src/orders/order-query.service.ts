// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from '../studios/bridge.service';
import { CompanionQuotaService } from './companion-quota.service';
import { ExcellenceService } from '../companions/excellence.service';
import { maskCustomerWechat, maskPartnerContactView, stripPoolCustomerContact } from '../common/order-privacy';
import { currentBusinessDayRange, currentBusinessDayStartCn } from '../common/business-day';
import { resolveConfigsRaw } from '../common/studio-config';
import { PoolScope } from '@chunlv/shared';
import { visibleToOwnOffline, outsideViewerVisible } from '../common/order-outcome';
import { DEFAULT_BRIDGE_DELAY_SECONDS, TRANSFER_REQUEST_TTL_SEC, SUPPLEMENT_TYPE } from './order.constants';

/**
 * 订单只读查询：抢单池 / 列表 / 详情 / 汇总 / 催单池 / 待开始等。
 *
 * 从 OrdersService 拆出，方法体原样搬运，行为与拆分前一致。
 */
@Injectable()
export class OrderQueryService {
  constructor(
    private prisma: PrismaService,
    private bridgeService: BridgeService,
    private excellence: ExcellenceService,
    private quota: CompanionQuotaService,
  ) {}

  async findPool(companionId?: string, studioId?: string) {
    const where: any = {
      status: 'PENDING',
      dispatchType: 'POOL',
      // 客服「指定」给某个陪玩的单不再出现在可抢列表里（老板 2026-10-06）：
      // 指定单发布那一刻就是 GRABBED + dispatchType=DIRECT，本来也进不来；
      // 这里再钉一道「companionId 必须为空」，保证任何已经带陪玩的单都不会被人再点一次「抢单」。
      companionId: null,
    };
    if (studioId) {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      where.studioId = { in: [studioId, ...bridgedIds] };
    }

    // 等待时长按「本店店长填的 → 老板全局默认」解析，各店互不影响
    const [poolCfg, studio] = await Promise.all([
      resolveConfigsRaw(this.prisma, studioId ?? null, [
        'pool.priority_delay_seconds',
        'pool.bridge_delay_seconds',
        'pool.middle_delay_seconds',
        'pool.low_delay_seconds',
        'pool.online_delay_seconds',
        'pool.online_first_release_minutes',
        'pool.offline_first_bridge_minutes',
      ]),
      studioId
        ? this.prisma.studio.findUnique({ where: { id: studioId }, select: { type: true } })
        : null,
    ]);
    const priorityDelay = Number(poolCfg['pool.priority_delay_seconds'] ?? 0) * 1000;
    const bridgeDelay = Number(poolCfg['pool.bridge_delay_seconds'] ?? DEFAULT_BRIDGE_DELAY_SECONDS) * 1000;
    const middleDelay = Number(poolCfg['pool.middle_delay_seconds'] ?? 60) * 1000;
    const lowDelay = Number(poolCfg['pool.low_delay_seconds'] ?? 120) * 1000;
    const onlineDelay = Number(poolCfg['pool.online_delay_seconds'] ?? 180) * 1000;
    // 「线上→线下流转」的单没人管时，多久自动放给本店线下陪玩（分钟）
    const onlineFirstReleaseMinutes = Number(poolCfg['pool.online_first_release_minutes'] ?? 5);
    // 「线下→线上流转」的单：本店线下先抢这么久，没人接才轮到桥接 / 线上俱乐部（分钟）
    const offlineFirstBridgeMinutes = Number(poolCfg['pool.offline_first_bridge_minutes'] ?? 3);
    const offlineFirstBridgeDelay = Math.max(0, offlineFirstBridgeMinutes) * 60_000;
    const studioType = studio?.type ?? 'DIRECT';

    // 当前陪玩的段位（只对自家工作室订单生效）
    let tier = 'MIDDLE';
    if (companionId) {
      const ex = await this.excellence.computeOne(companionId);
      tier = ex?.tier || 'MIDDLE';
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        csUser: { select: { username: true, avatar: true, displayName: true, role: true } },
        studio: { select: { name: true } },
      },
      // 抢单池统一按发布时间倒序：新单排在最上面。
      // 之前这里是 asc，接口返回最老的单在前，凡是没在前端再排一次的页面
      // （派单工作台的订单池）就会出现「新发布的单跑到最底部」。
      orderBy: { createdAt: 'desc' },
    });

    // 已过消失时间、标记为待客服处理的订单不再出现在抢单池；
    // 按「上等马 → 桥接 → 中等马 → 下等马 → 线上」分别延迟可见。
    const now = Date.now();
    const isCompanion = !!companionId;
    const available = orders.filter((o) => {
      const cf = (o.customFields as any) || {};
      // 客服已经处理过的单子不再回到抢单池。
      if (cf.poolHandled) return false;
      // 超时未处理的订单只进入客服/管理端的“流转失败明细”，不再出现在陪玩订单池。
      if (cf.poolExpired) return false;
      // 「线上→线下流转」的单（老板 2026-10-01）：本店线下陪玩先看不见，客服/店长手动放了、
      // 或过了自动放行时间才出现；一旦放行立即可见，不再排段位。
      // （客服 / 店长的派单工作台一直看得见，只是这一列会带「线上→线下」的标记。）
      const onlineFirstOrder = o.poolScope === PoolScope.ONLINE_FIRST;
      const ownOfflineOrder = !!studioId && o.studioId === studioId && studioType !== 'RENTAL';
      if (onlineFirstOrder && ownOfflineOrder) {
        if (isCompanion && !visibleToOwnOffline(o, onlineFirstReleaseMinutes, now)) return false;
        return true;
      }
      const waited = now - new Date(o.createdAt).getTime();
      let delay: number;
      if (!studioId) {
        delay = 0; // 老板（无工作室）看全部订单，立即可见
      } else if (ownOfflineOrder) {
        // 本店自己的单：按段位等待（管理端 / 客服不受段位限制）。
        // 2026-10-18 老板：「刚发单陪玩端就能收到弹窗，上等马/中等马/下等马的延迟呢？」
        // 原来自家广播单（cf.broadcast=true）走 0 秒、绕过了段位 —— 弹窗也立即发；现在统一按段位：
        // 上等马 priority（默认 0）、中等马 middle（默认 60 秒）、下等马 low（默认 120 秒）。
        // 弹窗的同一份等待在 WsEmitterService.broadcastNewOrder 里按同样配置延迟。
        delay = !isCompanion
          ? 0
          : tier === 'TOP' ? priorityDelay : tier === 'MIDDLE' ? middleDelay : lowDelay;
      } else {
        // 别家看本店的单：桥接工作室 / 线上俱乐部。
        // 「线上→线下流转」= 桥接工作室 + 线上俱乐部秒看到（等待时间 0），没人接再放给本店线下；
        // 「线下→线上流转」= 本店线下先抢 offlineFirstBridgeDelay 分钟，没人接才轮到桥接 / 线上
        //（老板 2026-09-29：「线下没人接，几分钟后到桥接，桥接没人接直接到线上俱乐部」——
        //  所以这里桥接和线上用同一个下限，桥接没人接线上马上能接）。
        return outsideViewerVisible(
          o,
          {
            bridgeDelayMs: bridgeDelay,
            onlineDelayMs: onlineDelay,
            offlineFirstBridgeMs: offlineFirstBridgeDelay,
            isRentalViewer: studioType === 'RENTAL',
          },
          now,
        );
      }
      return waited >= delay;
    });

    // 老板 2026-09-21：订单池里只看得到「还没被抢走」的单，陪玩一忙、一看视频就以为
    // 工作室没单，其实是被人抢走了。现在把今天（营业日 12:00 起）已经被抢的单也一起
    // 返回，前端灰掉显示，让大家看得到「今天发过这些单」。
    // 只对陪玩端（有 companionId）返回；管理端/客服在「全部订单」里本来就看得见。
    if (!companionId) return available;

    const taken = await this.findTakenPoolOrders(companionId, studioId);
    // 陪玩端**看不到别人单的客户联系方式**（老板 2026-10-01：「还没抢就显示微信 那还抢什么？」）。
    // 客服指定给自己的单、以及自己已经抢到的单照常看得见 —— 抢单池那一行只是给人挑单用的。
    return [...available, ...taken].map((o) =>
      o.companionId === companionId || o.coCompanionId === companionId
        ? o
        : stripPoolCustomerContact(o),
    );
  }

  /**
   * 今天（营业日 12:00 起）已经被抢走 / 已在服务的订单池订单 —— 陪玩端的灰色记录。
   * 刻意不带客户微信号、来源账号、二维码：只是让陪玩看到「今天有这些单、被谁抢了」，
   * 别人的客户信息一条都不给。
   */
  private async findTakenPoolOrders(companionId: string, studioId?: string) {
    const { start } = currentBusinessDayRange();
    // 陪玩端「已被抢」灰色记录现在也带上客服「指定」单（老板 2026-10-06）：
    // 指定单不走抢单池，以前一条都不显示 —— 陪玩在池子里既找不到自己那张被指定的单，
    // 也看不到「这单已经指定给谁了」。带上 DIRECT 之后，指定单会像被抢走的单一样灰色列出来，
    // 写清「🎯 客服指定给 XX 接」，且永远没有「抢单」按钮。
    const where: any = {
      dispatchType: { in: ['POOL', 'DIRECT'] },
      status: { in: ['GRABBED', 'CONFIRMED', 'DONE', 'CANCELLED', 'CLAIMED'] },
      OR: [{ createdAt: { gte: start } }, { grabbedAt: { gte: start } }],
    };
    if (studioId) {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      where.studioId = { in: [studioId, ...bridgedIds] };
    }

    const rows = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        orderCode: true,
        type: true,
        status: true,
        dispatchType: true,
        amount: true,
        gameName: true,
        serviceType: true,
        duration: true,
        customFields: true,
        createdAt: true,
        grabbedAt: true,
        updatedAt: true,
        companionId: true,
        coCompanionId: true,
        studioId: true,
        csUserId: true,
        companion: { select: { user: { select: { displayName: true, username: true } } } },
        coCompanion: { select: { user: { select: { displayName: true, username: true } } } },
        csUser: { select: { username: true, avatar: true, displayName: true, role: true } },
        studio: { select: { name: true } },
      },
      orderBy: [{ grabbedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return rows
      .filter((o) => {
        const cf = (o.customFields as any) || {};
        // 客服已经处理过、或判定流转失败的单不再展示（和上面的可抢列表口径一致）。
        return !cf.poolHandled && !cf.poolExpired;
      })
      .map((o) => ({
        ...o,
        customer: null,
        _taken: true,
        _direct: o.dispatchType === 'DIRECT',
        _takenByMe: o.companionId === companionId || o.coCompanionId === companionId,
        _takenByName:
          o.companion?.user?.displayName ||
          o.companion?.user?.username ||
          o.coCompanion?.user?.displayName ||
          o.coCompanion?.user?.username ||
          '其他陪玩',
        _takenAt: o.grabbedAt ?? o.updatedAt,
      }));
  }

  /**
   * 订单列表的「看得见范围」——订单管理列表、派单工作台的「今日概览」共用这一份口径。
   *
   * 以前只有 `findAll` 里那一份。2026-10-17 查「孙可馨那台打开派单管理一直没反应」时发现：
   * 派单工作台为了数「今日新增 / 已抢」两个数字，把整份订单列表拉了下来（全店 606 张单、
   * 原始 2.5MB），而这是她那条宽带上唯一会跑到 25 秒以上超时的请求。现在把口径抽出来，
   * 列表和计数同源 —— 不会再出现「列表按 A 口径、数字按 B 口径」。
   *
   * `scope` 只有客服端和陪玩端用得上：
   * - 客服：「只看我的」传 `mine`，要看全店传 `all`（不传按原来的全店口径）
   * - 陪玩：「我抢到的」传 `taken`（默认），「我服务的」传 `served`，「我发的」传 `published`
   * 店长 / 老板传什么都不受影响，各自走下面的本店 / 全部工作室分支。
   *
   * 返回 null = 这个账号本来就看不到任何单（异常陪玩账号没挂 Companion 档案）。
   */
  private async buildOrderVisibilityWhere(
    user: any,
    opts: { status?: string; scope?: string } = {},
  ): Promise<{
    where: any;
    pendingIncoming: Array<{
      id: string;
      orderId: string;
      fromCompanionId: string;
      reason: string | null;
      createdAt: Date;
    }>;
  } | null> {
    const { status, scope } = opts;
    const where: any = {};
    // 别人正想转给我、还没点同意的单（老板 2026-10-03）：它们现在还不挂在我名下，
    // 但老板要的是「在订单列表那一行点接手」——所以先查出来，等下一并按 id 捞进本次查询。
    let pendingIncoming: Array<{
      id: string;
      orderId: string;
      fromCompanionId: string;
      reason: string | null;
      createdAt: Date;
    }> = [];
    if (status) where.status = status;
    // Role-based filtering (showAll only bypasses for OWNER — security fix C4)
    if (user.role === 'COMPANION') {
      if (scope === 'published') {
        // 「我发的单」：陪玩端的首单 / 续费 / 复购是陪玩自己发起，发布人就是他本人。
        // 这里不再排除 PENDING+POOL —— 自己发出去还没人抢的单也是「我发的单」。
        where.csUserId = user.id;
      } else {
          // 陪玩一定挂着 Companion 档案。万一没挂（异常账号），宁可给空列表 ——
          // 否则 `{ companionId: undefined }` 会被 Prisma 当成空条件，等于把全站订单漏给他。
          if (!user.companionId) return null;
        if (scope === 'served') {
          // 「我服务的单」（老板 2026-10-03）：别人抢到、我当搭档（副陪）跟着一起打的单。
          // 以前这类单混在「我接的单」里，跟主陪自己的单分不清；现在单独一栏，
          // 并且这一栏里客户微信对副陪隐藏（见函数结尾的 maskPartnerContactView）。
          // 带上 sessions 那一层：搭档关系换过手、只有会话上还是我的，也别漏。
          where.OR = [
            { coCompanionId: user.companionId },
            { sessions: { some: { coCompanionId: user.companionId } } },
          ];
          if (!status) where.NOT = { status: 'PENDING', dispatchType: 'POOL' };
        } else {
        // 默认「我抢到的」：挂在我名下的单（抢到的 / 派给我的）。
        // 自己发的单只要也挂在我名下，这里照样留着 —— 老板 2026-09-27 明确
        // 「自己发的单两个栏都显示」，所以这里不排除自己发布的那些。
          where.OR = [{ companionId: user.companionId }];
          // 转让出去的订单也要留在转出方的接单记录里（老板 2026-09-29：抢单超时
          // 自动回收整条删掉，改由陪玩自己转让；转给谁、什么时候转的都得看得到）。
          where.OR.push({ transfers: { some: { fromCompanionId: user.companionId } } });
          // 别人要转给我的单也进「我抢到的」：那一行会长出「接手 / 拒绝」
          // （老板 2026-10-03：「放在订单列表那一行点转让或者点接受不行么」）。
          // 以前只靠顶栏铃铛 / 弹窗提醒，单子压根不在列表里，陪玩想点都没地方点。
          pendingIncoming = await this.prisma.orderTransferRequest.findMany({
            // 只看还没过期的：过期的申请不能再把单子拉进我的列表
            // （实测过：只看 status 的话，超时那条会把一张跟我无关的单留在列表里，
            //  只是按钮不显示 —— 列表里多一行莫名其妙的东西同样是错）。
            where: {
              toCompanionId: user.companionId,
              status: 'PENDING',
              createdAt: { gt: new Date(Date.now() - TRANSFER_REQUEST_TTL_SEC * 1000) },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, orderId: true, fromCompanionId: true, reason: true, createdAt: true },
          });
          if (pendingIncoming.length) {
            where.OR.push({ id: { in: pendingIncoming.map((r) => r.orderId) } });
          }
          if (!status) where.NOT = { status: 'PENDING', dispatchType: 'POOL' };
        }
      }
    } else if (user.role === 'CS') {
      if (scope === 'mine') {
        // 「我的单」= 自己发布的 + 自己认领的池子单：认领也是客服自己在跟的单，
        // 漏掉它会出现「刚认领完就从列表里消失」。这个口径与 updatePayment /
        // updateOrderInfo 里对客服的权限判断保持一致。
        where.OR = [{ csUserId: user.id }, { claimedCsUserId: user.id }];
      } else {
        const bridgedIds = await this.bridgeService.getBridgedStudioIds(user.studioId);
        where.studioId = { in: [user.studioId, ...bridgedIds] };
      }
    } else if (user.role === 'ADMIN') {
      // 店长只显示本店，不跨桥接工作室
      where.studioId = user.studioId;
    }
    // OWNER: 不添加过滤条件，可以看到所有订单
    return { where, pendingIncoming };
  }

  /**
   * 派单工作台的「今日概览」：只要「今日新增 / 已抢」两个数字。
   *
   * 2026-10-17：以前这两个数字是前端把整份订单列表拉下来自己数的（`GET /orders`
   * 不带筛选 = 全店全量，606 张单原始 2.5MB）。老板报「孙可馨的电脑店派单管理怎么没反应」，
   * 翻服务端日志对下来：那条宽带上传得动的接口都是几十毫秒，只有这个整份列表会跑到
   * 5～63 秒、直接顶掉客户端 25 秒的超时。改成服务端 count，响应体几百字节。
   *
   * 口径跟订单列表严格一致（同一个 `buildOrderVisibilityWhere`）；营业日按「每日 12:00 为界」，
   * 边界取北京时间 —— 服务器的本地时区是 UTC，用进程本地时区会跟客服的浏览器差 8 小时。
   */
  async dispatchSummary(user: any) {
    const visibility = await this.buildOrderVisibilityWhere(user, {});
    if (!visibility) return { todayNew: 0, todayGrabbed: 0 };
    const { where } = visibility;
    const bizStart = currentBusinessDayStartCn();
    const [todayNew, todayGrabbed] = await Promise.all([
      this.prisma.order.count({
        where: { AND: [where, { createdAt: { gte: bizStart } }] },
      }),
      this.prisma.order.count({
        where: {
          AND: [
            where,
            { status: { in: ['GRABBED', 'CONFIRMED'] } },
            // 跟原来前端 `grabbedAt || createdAt` 的算法对齐：没记抢单时间的单按创建时间算。
            {
              OR: [
                { grabbedAt: { gte: bizStart } },
                { grabbedAt: null, createdAt: { gte: bizStart } },
              ],
            },
          ],
        },
      }),
    ]);
    return { todayNew, todayGrabbed };
  }

  /**
   * 订单管理列表（全量下发，前端自己筛）。
   *
   * 注意响应体是跟着订单总量一起长的：606 张单已经 2.5MB（gzip 后约 130KB）。
   * 派单工作台只用它数两个数字，2026-10-17 起改走 `dispatchSummary`，不再拉整份列表；
   * 订单管理页确实要看全部，暂时仍走这里。
   */
  async findAll(user: any, status?: string, scope?: string) {
    const visibility = await this.buildOrderVisibilityWhere(user, { status, scope });
    if (!visibility) return [];
    const { where, pendingIncoming } = visibility;
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: true,
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, avatar: true, displayName: true } },
        // 发布方工作室：和接单陪玩的工作室对照，能看出是不是桥接工作室接的单
        studio: { select: { id: true, name: true } },
        // 接单陪玩所属工作室：桥接工作室接单时，订单上的 studioId 仍是发布方，
        // 客服要靠这一层才能看出「这单是谁家接的」。
        companion: {
          include: {
            user: { select: { id: true, username: true, avatar: true, displayName: true } },
            // type 也要带上：前端靠它区分「桥接别家店」和「线上俱乐部（租赁）」，
            // 好决定这张线上 / 桥接单要不要让接单方反馈「成功 / 不成功」。
            studio: { select: { id: true, name: true, type: true } },
          },
        },
        coCompanion: { include: { user: { select: { username: true } } } },
        // 转让留痕（老板 2026-09-29）：订单管理 / 接单记录 / 客户管理都要能写出
        // 「已于某时由某人转让给某人」，所以列表里一并带上。
        transfers: {
          orderBy: { createdAt: 'desc' },
          // 只要「谁转给谁 + 时间 + 原因」，别把两个陪玩实体整套塞进每一行
          // （订单列表是高频接口，留痕每条多带 30 来个字段纯属浪费）。
          select: {
            id: true,
            createdAt: true,
            reason: true,
            fromCompanion: { select: { id: true, user: { select: { id: true, username: true, displayName: true } } } },
            toCompanion: { select: { id: true, user: { select: { id: true, username: true, displayName: true } } } },
          },
        },
        sessions: {
          orderBy: { seq: 'desc' },
          take: 1,
          select: { id: true, startedAt: true, endedAt: true, duration: true, totalPausedSec: true, seq: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 逐行挂上「别人要转给我、等我点接手」的申请（老板 2026-10-03），并丢掉已经不成立的：
    // 单已经不在对方名下、状态不再是已抢单/已确认、申请已过期 —— 这些一律不下发，
    // 免得陪玩在列表里看到一个点了会报错的「接手」。
    const pendingTransferMap = new Map<string, any>();
    if (pendingIncoming.length) {
      const byId = new Map(orders.map((o) => [o.id, o]));
      const fromIds = Array.from(new Set(pendingIncoming.map((r) => r.fromCompanionId)));
      const fromCompanions = await this.prisma.companion.findMany({
        where: { id: { in: fromIds } },
        select: { id: true, user: { select: { username: true, displayName: true } } },
      });
      const fromNameMap = new Map(
        fromCompanions.map((c) => [c.id, c.user?.displayName || c.user?.username || '']),
      );
      const nowMs = Date.now();
      for (const r of pendingIncoming) {
        const o: any = byId.get(r.orderId);
        if (!o) continue;
        if (o.companionId !== r.fromCompanionId) continue;
        if (o.status !== 'GRABBED' && o.status !== 'CONFIRMED') continue;
        const expiresAt = new Date(r.createdAt).getTime() + TRANSFER_REQUEST_TTL_SEC * 1000;
        if (expiresAt <= nowMs) continue;
        pendingTransferMap.set(r.orderId, {
          requestId: r.id,
          fromCompanionId: r.fromCompanionId,
          fromName: fromNameMap.get(r.fromCompanionId) || '',
          reason: r.reason || '',
          expiresAt,
        });
      }
    }
    // 隐私：副陪（搭档）看不到主陪的客户微信。
    // 引流账号（来源账号）**不再按角色抹成 `***`**（老板 2026-09-30「管理端的 订单管理
    // 引流账号 怎么是 *？」）：陪玩端那一列本来就被 CustomerSourceMaskInterceptor 整列摘掉了，
    // 管理端（客服 / 店长 / 老板）一律显示完整账号 —— 和「客户管理」那一格同一口径。
    // 补单状态（老板 2026-10-08）：管理端订单行那颗「补单」按钮要知道两件事 ——
    //   ① 这张单的陪玩已经提交了补单申请（待审）→ 按钮上挂提示，点一下就是核对 / 同意；
    //   ② 这张单已经补过名额 → 显示「已补」，不能再点。
    // 补单是管理端的事（陪玩看不到这个动作），所以只给客服 / 店长 / 老板查这一下。
    const supplementPendingMap = new Map<string, any>();
    const supplementApprovedSet = new Set<string>();
    // 「陪玩申请补单的单」也要能在订单列表里筛出来（老板 2026-10-11：
    // 「这些添加失败的 / 当时不打的 / 陪玩申请补单的，管理端能筛出来么」），
    // 所以这里把**两种申请一起**查回来挂到行上（`supplementRequests`）：
    //   SUPPLEMENT = 陪玩点「添加失败」自动要名额的那条；
    //   REFUND     = 陪玩点「申请补单」（原「退单」）的那条。
    // 下面那两个 flag 的口径一个字没改，仍然是「补单（SUPPLEMENT）」那一条 —— 订单行那颗
    // 「补单」按钮靠它判断（陪玩端本来就不看这个动作，照旧不下发这两个 flag）。
    const supplementReqMap = new Map<string, any[]>();
    // 陪玩没挂档案（异常账号）时直接跳过这次查询 —— 否则 `companionId: undefined` 会被
    // Prisma 当成「没有条件」，等于把全站的补单申请漏给他。
    const supplementQueryable = user.role !== 'COMPANION' || !!user.companionId;
    if (orders.length && supplementQueryable) {
      const reqs = await this.prisma.supplementRequest.findMany({
        where: {
          orderId: { in: orders.map((o) => o.id) },
          // 陪玩只看自己提的那些申请（「我服务的单」那一栏里主陪提的申请不下发给他）
          ...(user.role === 'COMPANION' ? { companionId: user.companionId } : {}),
        },
        select: {
          id: true,
          orderId: true,
          type: true,
          status: true,
          reason: true,
          evidenceUrl: true,
          createdAt: true,
          decidedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      for (const r of reqs) {
        const list = supplementReqMap.get(r.orderId) ?? [];
        list.push({
          id: r.id,
          type: r.type,
          status: r.status,
          reason: r.reason,
          createdAt: r.createdAt,
          decidedAt: r.decidedAt,
        });
        supplementReqMap.set(r.orderId, list);
        if (user.role === 'COMPANION' || r.type !== SUPPLEMENT_TYPE) continue;
        if (r.status === 'PENDING') {
          supplementPendingMap.set(r.orderId, {
            id: r.id,
            reason: r.reason,
            evidenceUrl: r.evidenceUrl,
          });
        } else if (r.status === 'APPROVED') {
          supplementApprovedSet.add(r.orderId);
        }
      }
    }
    const rows = orders.map((o) => {
      const cf = (o.customFields as any) || {};
      return maskCustomerWechat(
        {
          ...o,
          pendingTransferForMe: pendingTransferMap.get(o.id) || null,
          supplementPending: supplementPendingMap.has(o.id),
          supplementPendingRequest: supplementPendingMap.get(o.id) || null,
          supplementApproved: supplementApprovedSet.has(o.id) || !!cf.supplementApproved,
          supplementRequests: supplementReqMap.get(o.id) || [],
        },
        user,
      );
    });
    if (user.role === 'COMPANION' && scope === 'served') {
      // 「我服务的单」里主陪不是我的，一律按副陪视角遮客户微信：这一栏是我跟着别人打的单，
      // 客户资源是主陪的（老板 2026-10-03：「这个订单可以隐藏掉客户的微信信息，保护王昊的权益」）。
      return rows.map((o: any) =>
        o.companionId === user.companionId ? o : maskPartnerContactView(o),
      );
    }
    return rows;
  }

  /** 陪玩待开始的订单：已抢单/已确认，但还没有真正开始计时的会话。 */
  async findPendingStart(companionId: string) {
    if (!companionId) return [];
    return this.prisma.order.findMany({
      where: {
        companionId,
        status: { in: ['GRABBED', 'CONFIRMED'] },
        sessions: { none: { status: 'ACTIVE', startedAt: { not: null } } },
      },
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        sessions: { orderBy: { seq: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findUrgent(studioId: string, user?: { id: string; role: string }) {
    const now = Date.now();
    const disappearScoped = await resolveConfigsRaw(this.prisma, studioId ?? null, [
      'pool.immediate_disappear_minutes',
    ]);
    const disappearSeconds = Number(disappearScoped['pool.immediate_disappear_minutes'] ?? 10) * 60;
    const where: any = { status: 'PENDING', dispatchType: 'POOL' };
    if (studioId) where.studioId = studioId;
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
      },
      // 新的在前。原来是 asc（最老的排最前面），结果「刚流转失败」的那条被压在几十行旧单下面，
      // 老板 2026-09-27 就因此以为「这单没进流转失败明细」（线上实测：客户 229 那张单排在第 29/29 条）。
      orderBy: { createdAt: 'desc' },
    });

    const list = await Promise.all(
      orders
        .filter((o) => {
          const cf = (o.customFields as any) || {};
          if (cf.poolHandled) return false;
          if (o.contactStatus === 'not_accepted') return false;
          // 立即打：全部显示（加急+待处理）；预约：只显示已过期的待处理
          return cf.urgency === 'now' || (cf.urgency === 'later' && cf.poolExpired);
        })
        .map(async (o) => {
          const cf = (o.customFields as any) || {};
          // 老板/店长可处理所有单；客服只能处理自己发布的单。
          const canProcess = user?.role !== 'CS' || user?.id === o.csUserId;
          const maskedCf = canProcess
            ? cf
            : {
                ...cf,
                customerSourceAccount: undefined,
                customerNickname: undefined,
                customerAccountId: undefined,
                customerWechat: undefined,
                customerWechatQr: undefined,
                customerYy: undefined,
                customerPlatformAccount: undefined,
                customerRoomCode: undefined,
              };
          const isScheduled = cf.urgency === 'later';
          const waitingSeconds = Math.max(0, Math.floor((now - o.createdAt.getTime()) / 1000));
          const poolExpired = !!cf.poolExpired;
          const availableCompanions =
            !isScheduled && waitingSeconds >= 300
              ? await this.getSoonEndingCompanions(studioId)
              : [];
          return {
            ...o,
            customer: canProcess ? o.customer : null,
            waitingSeconds,
            urgent: !isScheduled,
            poolExpired,
            poolExpiredAt: cf.poolExpiredAt || '',
            dispatchCount: cf.dispatchCount || 1,
            firstDispatchedAt: cf.firstDispatchedAt || '',
            dispatchHistory: cf.dispatchHistory || [],
            isScheduled,
            requireCsContact: poolExpired || (!isScheduled && waitingSeconds >= disappearSeconds),
            csContactStatus: o.contactStatus || '',
            csContactEvidenceUrl: cf.csContactEvidenceUrl || '',
            customFields: maskedCf,
            availableCompanions,
            canProcess,
          };
        }),
    );

    // 已消失（待客服处理）的订单排最前；同一组里保持上面查出来的「新的在前」（Array.sort 稳定）。
    return list.sort((a, b) => Number(b.poolExpired) - Number(a.poolExpired));
  }

  private async getSoonEndingCompanions(studioId: string) {
    if (!studioId) return [];
    const companions = await this.prisma.companion.findMany({
      where: { studioId, status: 'BUSY' },
      include: {
        user: { select: { username: true } },
        sessions: {
          where: { endedAt: null },
          include: { parentOrder: { select: { duration: true, amount: true } } },
        },
      },
    });
    const list = await Promise.all(
      companions.map(async (c) => {
        const excellent = await this.excellence.isExcellent(c.id);
        const remainingMinutes = c.sessions
          .map((s) => {
            if (!s.startedAt) return 999;
            const durationMs = (s.parentOrder?.duration || 1) * 3600_000;
            return Math.max(0, Math.round((durationMs - (Date.now() - s.startedAt.getTime())) / 60000));
          })
          .sort((a, b) => a - b)[0] ?? 999;
        return { id: c.id, name: c.user?.username || c.id, excellent, remainingMinutes };
      }),
    );
    return list.sort((a, b) => Number(b.excellent) - Number(a.excellent) || a.remainingMinutes - b.remainingMinutes);
  }

  /**
   * 抢单池状态（老板 2026-09-20 起：只返回「每日立即打名额」，不再有业绩门槛）。
   */
  async getPoolStatus(companionId: string) {
    const quota = await this.quota.status(companionId);
    // 没绑工作微信 = 抢不了单（老板 2026-10-02 方案 B）：这里把绑定状态一并下发，让订单池提前提醒。
    const boundWechat = companionId
      ? await this.prisma.workWechat
          .findUnique({ where: { companionId }, select: { wechatId: true } })
          .catch(() => null)
      : null;
    const workWechatId = String(boundWechat?.wechatId || '').trim();
    return {
      tier: quota.tier,
      dailyLimit: quota.dailyLimit,
      balance: quota.balance,
      usedToday: quota.usedToday,
      remaining: quota.remaining,
      todayGranted: (quota as any).todayGranted ?? 0,
      days: (quota as any).days ?? [],
      recentLogs: (quota as any).recentLogs ?? [],
      hasWorkWechat: !!workWechatId,
      workWechatId,
    };
  }

  async countPendingContact(studioId: string) {
    if (!studioId) {
      // 老板（无工作室）看全部待联系订单
      return this.prisma.order.count({
        where: {
          contactStatus: 'not_accepted',
          status: { not: 'CANCELLED' },
        },
      });
    }
    const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
    const studioIds = [studioId, ...bridgedIds];
    return this.prisma.order.count({
      where: {
        studioId: { in: studioIds },
        contactStatus: 'not_accepted',
        status: { not: 'CANCELLED' },
      },
    });
  }

  async findOne(orderId: string, user?: any) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
        // 转让留痕（老板 2026-10-03「400 订单转给王甲振，怎么没看到转让记录」）：
        // findAll 一直带着 transfers，详情这里却漏了 —— 从「订单详情」按 id 取回来的单
        // 看不到「谁什么时候转给谁」。补齐，口径与 findAll 完全一致。
        transfers: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            reason: true,
            fromCompanion: { select: { id: true, user: { select: { id: true, username: true, displayName: true } } } },
            toCompanion: { select: { id: true, user: { select: { id: true, username: true, displayName: true } } } },
          },
        },
      },
    });
    if (!order) return null;
    if (user) {
      if (user.role === 'COMPANION') {
        const involved = order.companionId === user.companionId || order.coCompanionId === user.companionId;
        if (!involved) throw new ForbiddenException('无权查看该订单');
      } else if ((user.role === 'CS' || user.role === 'ADMIN') && order.studioId !== user.studioId) {
        throw new ForbiddenException('无权查看该订单');
      }
    }
    return maskCustomerWechat(order, user);
  }
}
